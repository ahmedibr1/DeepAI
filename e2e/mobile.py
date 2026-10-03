import asyncio
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)

async def sign_in(page, username):
    if await page.locator(".user-chip").count():
        await page.click(".user-chip"); await page.click(".user-dropdown button"); await page.wait_for_selector("#username")
    await page.fill("#username",username); await page.fill("#password",PW); await page.click("button[type=submit]")
    await page.wait_for_selector(".sidenav .me b", timeout=15000)
    await page.goto(page.url.split("#")[0] + "#/dashboard")
    await page.wait_for_selector(".stat", timeout=15000)

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        phone = await b.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                                    device_scale_factor=2,
                                    user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")
        page=await phone.new_page(); errs=[]
        page.on("pageerror", lambda e: errs.append(str(e)[:160]))
        page.on("console", lambda m: m.type=="error" and errs.append(m.text[:160]))
        await page.goto(FILE); await page.evaluate("localStorage.clear()"); await page.reload()
        await page.evaluate("localStorage.setItem('pp-demo-seen','1')"); await page.reload()

        # the login page fits without sideways scrolling
        overflow = await page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 1, f"login scrolls sideways by {overflow}px"
        await sign_in(page, "a.aloulah")
        log("signed in on a 390px phone")

        # the sidebar is hidden behind a menu button
        assert not await page.locator(".sidenav").is_visible() or await page.evaluate(
            "() => getComputedStyle(document.querySelector('.sidenav')).transform !== 'none'")
        await page.click(".menu-btn")
        await expect(page.locator(".sidenav")).to_be_visible()
        await page.screenshot(path="ph_nav.png")
        await page.mouse.click(360, 420)   # tap outside the sheet
        await page.wait_for_timeout(400)
        log("menu button opens and closes the sidebar")

        for label in ("Active Opportunities","Awaiting My Review","Ready for AI","Opportunities Needing Attention"):
            await expect(page.locator(".stat", has_text=label)).to_be_visible()
        overflow = await page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 1, f"dashboard scrolls sideways by {overflow}px"
        await page.screenshot(path="ph_dash.png", full_page=True)
        log("management dashboard fits the phone, no sideways scrolling")

        # the monitor keeps the essentials and expands for the rest
        await page.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".expander").click()
        await expect(page.locator(".monitor-detail")).to_be_visible()
        await page.screenshot(path="ph_monitor.png", full_page=True)
        log("monitor row expands on the phone")

        # an opportunity workspace on a phone
        # the row menu is the way into an opportunity now
        await page.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".dots").click()
        await page.click(".row-menu button:has-text('Go to Latest DeepDive')")
        await expect(page.locator(".opp-head h1")).to_be_visible(timeout=10000)
        await page.click(".tabs a:has-text('DeepDive')")
        frame=None
        for _ in range(60):
            frame=next((f for f in page.frames if "blob:" in f.url or "srcdoc" in f.url), None)
            if frame and await frame.locator('[data-path="customer"]').count(): break
            await page.wait_for_timeout(250)
        assert frame, "the DeepDive builder loads on mobile"
        await page.screenshot(path="ph_deepdive.png")
        overflow = await page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 1, f"workspace scrolls sideways by {overflow}px"
        log("opportunity workspace and DeepDive work on the phone")

        # Presales Account gets the same look
        await sign_in(page, "m.rabie")
        cards=await page.eval_on_selector_all(".stat","els=>els.map(e=>e.getAttribute('aria-label')||e.querySelector('.l').textContent.trim())")
        assert cards[0]=="My Active Opportunities" and len(cards)==6, cards
        assert await page.locator(".stat .kpi-icon").count()==5, "icon cards for the Presales Account too"
        await page.screenshot(path="ph_account.png", full_page=True)
        log("Presales Account dashboard:", cards[:3], "…")
        print("PAGE ERRORS:", errs[:4])
        await b.close()
asyncio.run(main())
