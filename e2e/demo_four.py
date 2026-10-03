import asyncio, re
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)

async def sign_in(page, username):
    if await page.locator(".user-chip").count():
        await page.click(".user-chip")
        await page.click(".user-dropdown button")
        await page.wait_for_selector("#username")
    await page.fill("#username",username); await page.fill("#password",PW); await page.click("button[type=submit]")
    await page.wait_for_selector(".sidenav .me b")
    await page.goto(page.url.split("#")[0]+"#/dashboard"); await page.wait_for_selector(".stat")
    return await page.locator(".sidenav .me b").inner_text()

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); page=await (await b.new_context(viewport={"width":1440,"height":1000})).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append(str(e)[:160]))
        page.on("console", lambda m: m.type=="error" and errs.append(m.text[:160]))
        await page.goto(FILE); await page.evaluate("localStorage.clear()"); await page.reload()
        await page.evaluate("localStorage.setItem('pp-demo-seen','1')"); await page.reload()

        log("signed in as", await sign_in(page,"m.rabie"))
        await page.click("nav >> text=Active opportunities")
        await expect(page.locator("h1")).to_have_text("Active opportunities")
        await page.wait_for_selector(".opp-card", timeout=15000)
        count_active = await page.locator(".opp-card").count()
        log(f"Active opportunities view shows {count_active}")

        await page.locator(".opp-card", has_text="OP-2026-159388").first.click()
        await page.click("button.btn.coral:has-text('Submit to Review')")
        await expect(page.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=15000)

        log("signed in as", await sign_in(page,"a.aloulah"))
        await page.goto(page.url.split("#")[0]+"#/opportunities")
        await page.wait_for_selector(".opp-card", timeout=15000)
        await page.locator(".opp-card", has_text="OP-2026-159388").first.click()
        await expect(page.locator(".alert.info").first).to_contain_text("can no longer be edited")
        await page.click("button:has-text('Create new version')")
        await page.fill("#change-notes","Director corrections")
        await page.click(".modal button.primary")
        await page.wait_for_timeout(1500)
        if await page.locator(".modal .alert.error").count():
            print("   DIALOG ERROR:", await page.locator(".modal .alert.error").inner_text())
        print("   badge:", await page.locator(".opp-head .badge").first.inner_text(),
              "| url:", page.url.split("#")[-1],
              "| api:", await page.evaluate("""async()=>{const l=await (await fetch('/api/opportunities')).json();
                  const o=l.items.find(x=>x.opportunity_number==='OP-2026-159388');return o && o.status;}"""))
        await page.reload(); await page.wait_for_timeout(1500)
        await expect(page.locator(".opp-head .badge").first).to_have_text("Draft", timeout=15000)
        log("the Director opened a new version and the opportunity returned to Draft")

        frame=None
        for _ in range(60):
            frame=next((f for f in page.frames if "blob:" in f.url or "srcdoc" in f.url), None)
            if frame and await frame.locator('[data-go="1"]').count(): break
            await page.wait_for_timeout(250)
        await frame.locator('[data-go="1"]').click()
        sow=frame.locator('[data-path="sow"]')
        await expect(sow).to_be_visible(timeout=15000)
        assert await sow.get_attribute("readonly") is None, "the Director can edit"
        await sow.click(); await sow.press("End"); await sow.type("\nDirector addition")
        await expect(page.locator(".save-state")).to_have_text(re.compile("Saved"), timeout=15000)
        log("the Director edited the DeepDive directly")

        log("signed in as", await sign_in(page,"m.alasadi"))
        await expect(page.locator(".monitor-table")).to_be_visible(timeout=15000)
        await page.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".expander").click()
        detail = page.locator(".monitor-detail")
        await expect(detail.locator("h4", has_text=re.compile(r"Support Needed \("))).to_be_visible(timeout=10000)
        await expect(detail.locator("h4", has_text=re.compile(r"Risks \("))).to_be_visible()
        await page.screenshot(path="f2_demo_attention.png", full_page=True)
        log("Support Needed and Risks both listed")

        await page.goto(page.url.split("#")[0]+"#/opportunities")
        await page.wait_for_selector(".opp-card", timeout=15000)
        await page.locator(".opp-card", has_text="OP-2026-159388").first.click()
        await page.click("button:has-text('Close opportunity')"); await page.click(".modal button.primary")
        await expect(page.locator(".opp-head .badge").first).to_have_text("Completed", timeout=15000)
        totals = await page.evaluate("""async()=>{const a=await (await fetch('/api/opportunities?active=1')).json();
            const b=await (await fetch('/api/opportunities')).json(); return {active:a.total, all:b.total};}""")
        assert totals["active"] == totals["all"] - 1, totals
        log("closing moved it out of Active but not out of All:", totals)
        print("PAGE ERRORS:", errs[:4])
        await b.close()
asyncio.run(main())
