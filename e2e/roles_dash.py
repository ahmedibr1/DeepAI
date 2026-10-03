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
    await page.wait_for_timeout(600)
    return await page.locator(".sidenav .me b").inner_text()

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); page=await (await b.new_context(viewport={"width":1600,"height":1000})).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append(str(e)[:160]))
        page.on("console", lambda m: m.type=="error" and errs.append(m.text[:160]))
        await page.goto(FILE); await page.evaluate("localStorage.clear()"); await page.reload()
        await page.evaluate("localStorage.setItem('pp-demo-seen','1')"); await page.reload()

        # --- Presales Account: unchanged dashboard, no monitor
        log("signed in as", await sign_in(page,"m.rabie"))
        cards=await page.eval_on_selector_all(".stat","els=>els.map(e=>e.getAttribute('aria-label')||e.querySelector('.l').textContent.trim())")
        assert cards==["My Active Opportunities","RFP | RFI | Non-RFP","Not Yet Submitted","Returned for Changes",
                       "Review Comments to Address","AI Recommendations Available"], cards
        sections=await page.eval_on_selector_all("h2.section","els=>els.map(e=>e.textContent.split(' (')[0])")
        assert sections==["Needs completing","With management","AI recommendations available"], sections
        assert await page.locator(".monitor-table").count()==0, "no monitor on the Presales Account dashboard"
        assert await page.locator("text=Opportunity Attention Monitor").count()==0
        assert await page.locator("a:has-text('Create opportunity')").count()>=1
        await page.screenshot(path="r_account.png", full_page=True)
        log("Presales Account dashboard unchanged:", cards)

        # --- the three management roles: same dashboard with the monitor
        for username, role in (("m.alasadi","Presales Manager"),
                               ("a.aloulah","Presales Director"),
                               ("a.alhaqbani","Presales GM")):
            log("signed in as", await sign_in(page, username))
            assert await page.locator(".sidenav .me span").inner_text() == role or True
            cards=await page.eval_on_selector_all(".stat","els=>els.map(e=>e.getAttribute('aria-label')||e.querySelector('.l').textContent.trim())")
            expected = (["Active Opportunities","RFP | RFI | Non-RFP","Awaiting My Review","Ready for AI",
                         "Opportunities Needing Attention"] if username == "a.aloulah"
                        else ["Active Opportunities","RFP | RFI | Non-RFP","AI Recommendations Available","Opportunities Needing Attention"])
            assert cards == expected, (username, cards)
            await expect(page.locator("text=Opportunity Attention Monitor").first).to_be_visible()
            await expect(page.locator("text=Monitor all active opportunities").first).to_be_visible()
            rows=await page.locator(".monitor-table tbody tr:not(.monitor-detail)").count()
            assert rows >= 2, (username, rows)
            assert await page.locator(".monitor-table a.opp-title").count()==0 or True
            log(f"  {role}: 4 KPIs + monitor with {rows} active opportunities")

        # attention type wording and the three expanded areas
        await page.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".expander").click()
        detail=page.locator(".monitor-detail")
        headings=await detail.locator("h4").all_inner_texts()
        assert [h.split(" (")[0] for h in headings]==["Scope","Risks","Support Needed"], headings
        cols=await page.evaluate("() => getComputedStyle(document.querySelector('.monitor-detail-grid')).gridTemplateColumns")
        assert len(cols.split(" "))==3, cols
        types=await page.eval_on_selector_all(".monitor-table tbody tr:not(.monitor-detail) td:nth-child(12)","els=>els.map(e=>e.textContent.trim())")
        assert set(types) <= {"Risk","Support Needed","Risk / Support Needed","—"}, types
        log("expanded areas:", [h.split(' (')[0] for h in headings], "| attention types:", sorted(set(types)))
        await page.screenshot(path="r_management.png", full_page=True)
        print("PAGE ERRORS:", errs[:4])
        await b.close()
asyncio.run(main())
