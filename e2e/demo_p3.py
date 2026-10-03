import asyncio, re
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'
PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)

async def sign_in(page, username):
    if await page.locator(".user-chip").count():
        await page.click(".user-chip")
        await page.click(".user-dropdown button")
        await page.wait_for_selector("#username")
    await page.fill("#username", username); await page.fill("#password", PW); await page.click("button[type=submit]")
    await page.wait_for_selector(".sidenav .me b")
    await page.goto(page.url.split("#")[0] + "#/dashboard"); await page.wait_for_selector(".stat")
    return await page.locator(".sidenav .me b").inner_text()

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={"width":1440,"height":1000})
        page=await ctx.new_page(); errs=[]
        page.on("pageerror", lambda e: errs.append(str(e)[:200]))
        page.on("console", lambda m: m.type=="error" and errs.append(m.text[:200]))
        await page.goto(FILE); await page.evaluate("localStorage.clear()"); await page.reload()
        await page.evaluate("localStorage.setItem('pp-demo-seen','1')"); await page.reload()

        log("signed in as", await sign_in(page, "m.rabie"))
        await page.goto(page.url.split("#")[0] + "#/opportunities")
        await page.wait_for_selector(".opp-card", timeout=15000)
        await page.locator(".opp-card").first.click()
        await page.click(".tabs a:has-text('Documents')")
        await expect(page.locator("td", has_text="Red_Sea_Global_RFP_extract.txt").first).to_be_visible(timeout=10000)
        log("sample RFP is attached out of the box")
        await page.click("button.btn.coral:has-text('Submit to Review')")
        await expect(page.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=10000)

        log("signed in as", await sign_in(page, "a.aloulah"))
        await page.goto(page.url.split("#")[0] + "#/opportunities")
        await page.wait_for_selector(".opp-card", timeout=15000)
        await page.locator(".opp-card").first.click()
        await page.click("button:has-text('Start review')"); await page.click(".modal button.primary")
        await page.click(".tabs a:has-text('Review')")
        await page.select_option("#c-type","missing_information")
        await page.fill("#c-body","Confirm the SLA the customer expects for managed services.")
        await page.click("button:has-text('Add comment')")
        await expect(page.locator(".comment")).to_have_count(1, timeout=10000)
        await page.click(".tabs a:has-text('Overview')")
        await page.click("button:has-text('Ready for AI analysis')"); await page.click(".modal button.primary")
        await expect(page.locator(".opp-head .badge").first).to_have_text("Ready for AI")

        await page.click(".tabs a:has-text('AI recommendations')")
        await page.click("button:has-text('Run AI analysis')")
        await expect(page.locator(".readiness-head .badge")).to_be_visible(timeout=40000)
        areas = await page.locator(".area").count()
        findings = await page.locator(".comment").count()
        assert areas == 8 and findings >= 3, (areas, findings)
        log(f"{areas} readiness areas, {findings} findings")
        await page.screenshot(path="d5_ai.png", full_page=True)

        await page.click(".cite >> nth=0")
        await expect(page.locator(".source-text")).to_contain_text(re.compile("SCADA|SLA|Kingdom|budget|integrate"))
        await page.click(".modal button.primary")
        log("citation opens the exact RFP text")

        await expect(page.locator("table.data tbody tr").first).to_be_visible(timeout=15000)
        await page.screenshot(path="d6_ai_rec.png", full_page=True)
        log("recommendations show the required actions")

        log("signed in as", await sign_in(page, "m.rabie"))
        await page.goto(page.url.split("#")[0] + "#/opportunities")
        await page.wait_for_selector(".opp-card", timeout=15000)
        await page.locator(".opp-card").first.click()
        await page.click(".tabs a:has-text('AI recommendations')")
        await expect(page.locator(".readiness-head")).to_be_visible(timeout=15000)
        assert await page.locator("button:has-text('Run AI analysis')").count() == 0
        log("owner can read the results but not run the analysis")
        print("PAGE ERRORS:", errs[:5])
        await b.close()
asyncio.run(main())
