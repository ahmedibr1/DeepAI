import asyncio
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)
async def login(pg,u):
    if await pg.locator(".user-chip").count():
        await pg.click(".user-chip"); await pg.click(".user-dropdown button"); await pg.wait_for_selector("#username")
    await pg.fill("#username",u); await pg.fill("#password",PW); await pg.click("button[type=submit]")
    await pg.wait_for_selector(".sidenav .me b", timeout=15000)
async def open_opp(pg):
    await pg.goto(pg.url.split("#")[0]+"#/opportunities"); await pg.wait_for_selector(".opp-card")
    await pg.locator(".opp-card", has_text="OP-2026-159388").first.click()
    await pg.wait_for_selector(".tabs a", timeout=15000)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={"width":1500,"height":950})).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
        await pg.goto(FILE); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.evaluate("localStorage.setItem('pp-demo-seen','1')"); await pg.reload()

        await login(pg,"m.rabie"); await open_opp(pg)
        cards = await pg.eval_on_selector_all(".stat","els=>els.map(e=>e.getAttribute('aria-label')||'')")
        assert not any("Returned for Changes" in c for c in cards), cards
        await pg.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pg.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=15000)

        await login(pg,"a.aloulah"); await open_opp(pg)
        actions = await pg.eval_on_selector_all(".opp-head button","els=>els.map(e=>e.textContent.trim())")
        log("director actions:", actions)
        assert "Start review" not in actions and "Request changes" not in actions, actions
        assert "Ready for AI analysis" not in actions, actions
        await pg.click(".tabs a:has-text('DeepDive')")
        await pg.locator(".trail-card", has_text="AI Analysis").click()
        await pg.click("button:has-text('Confirm the DeepDive session')")
        await expect(pg.locator(".analysis").first).to_be_visible(timeout=10000)
        log("one action only: confirm the session, then the analyses open")
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
