import asyncio, os
from playwright.async_api import async_playwright, expect
FILE = 'http://localhost:4180/Presales_Portal_Phase1_Demo.html'
PW = "Demo2026pass"
log = lambda *a: print("•", *a, flush=True)

async def sign_in(page, username):
    if await page.locator(".user-chip").count():
        await page.click(".user-chip")
        await page.click(".user-dropdown button")
        await page.wait_for_selector("#username")
    await page.fill("#username", username); await page.fill("#password", PW)
    await page.click("button[type=submit]")
    await page.wait_for_selector(".sidenav .me b")
    await page.goto(page.url.split("#")[0] + "#/dashboard")
    await page.wait_for_selector(".stat")
    return await page.locator(".sidenav .me b").inner_text()

async def main():
    os.makedirs("/tmp/up", exist_ok=True)
    open("/tmp/up/RFP.pdf","wb").write(b"%PDF-1.7\n" + b"Red Sea Global RFP " * 500)
    open("/tmp/up/Requirements.txt","w").write("Mandatory: In-Kingdom data residency\nSLA 99.9%\n")
    open("/tmp/up/fake.pdf","wb").write(b"MZ\x90\x00 not a pdf")
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={"width":1440,"height":950}, accept_downloads=True)
        page = await ctx.new_page(); errs=[]
        page.on("pageerror", lambda e: errs.append(str(e)[:200]))
        page.on("console", lambda m: m.type=="error" and errs.append(m.text[:200]))
        await page.goto(FILE)
        await page.evaluate("localStorage.clear()"); await page.reload()
        await page.evaluate("localStorage.setItem('pp-demo-seen','1')"); await page.reload()

        log("signed in as", await sign_in(page, "m.rabie"))
        await page.goto(page.url.split("#")[0] + "#/opportunities")
        await page.wait_for_selector(".opp-card", timeout=15000)
        await page.locator(".opp-card").first.click()
        await page.click(".tabs a:has-text('Documents')")
        await page.select_option("#doc-category", "rfp")
        await page.set_input_files("#doc-file", "/tmp/up/RFP.pdf")
        await expect(page.locator("td", has_text="RFP.pdf").first).to_be_visible(timeout=10000)
        await page.select_option("#doc-category", "customer_requirements")
        await page.set_input_files("#doc-file", "/tmp/up/Requirements.txt")
        await expect(page.locator("table.data tbody tr")).to_have_count(3)   # + the seeded sample RFP
        log("two documents uploaded alongside the seeded sample RFP")
        await page.set_input_files("#doc-file", "/tmp/up/fake.pdf")
        await expect(page.locator(".alert.error")).to_contain_text("do not match", timeout=10000)
        log("renamed non-PDF rejected in the demo too")
        async with page.expect_download() as dl:
            await page.click("a.btn:has-text('Download')")
        log("downloaded", (await dl.value).suggested_filename)
        await page.screenshot(path="d3_documents.png", full_page=True)

        await page.click("button.btn.coral:has-text('Submit to Review')")
        await expect(page.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=10000)
        await page.click(".tabs a:has-text('Documents')")
        assert await page.locator("#doc-file").count() == 0, "upload box hidden after submission"

        log("signed in as", await sign_in(page, "a.aloulah"))
        await page.goto(page.url.split("#")[0] + "#/opportunities")
        await page.wait_for_selector(".opp-card", timeout=15000)
        await page.locator(".opp-card").first.click()
        await page.click("button:has-text('Start review')"); await page.click(".modal button.primary")
        await page.click(".tabs a:has-text('Documents')")
        await expect(page.locator("table.data tbody tr")).to_have_count(3)
        assert await page.locator("button:has-text('Remove')").count() == 0
        await page.click(".tabs a:has-text('Review')")
        await page.select_option("#c-type", "critical_issue")
        await page.select_option("#c-section", "scope")
        await page.fill("#c-body", "The RFP compliance matrix is missing from the scope of work.")
        await page.select_option("#c-priority", "critical")
        await page.fill("#c-owner", "Mohammed Rabie")
        await page.click("button:has-text('Add comment')")
        await expect(page.locator(".comment")).to_have_count(1, timeout=10000)
        await page.select_option("#c-type", "missing_information")
        await page.fill("#c-body", "SLA targets are not stated anywhere in the DeepDive.")
        await page.click("button:has-text('Add comment')")
        await expect(page.locator(".comment")).to_have_count(2, timeout=10000)
        await page.screenshot(path="d4_review.png", full_page=True)
        log("director added two structured comments")
        await page.click(".tabs a:has-text('Overview')")
        await page.click("button:has-text('Request changes')")
        await page.fill("#action-comment", "See the two comments on the Review tab.")
        await page.click(".modal button.primary")
        await expect(page.locator(".opp-head .badge").first).to_have_text("Changes Requested")

        log("signed in as", await sign_in(page, "m.rabie"))
        await page.goto(page.url.split("#")[0] + "#/opportunities")
        await page.wait_for_selector(".opp-card", timeout=15000)
        await page.locator(".opp-card").first.click()
        await page.click(".tabs a:has-text('Review')")
        await expect(page.locator(".comment")).to_have_count(3, timeout=10000)
        assert await page.locator("#c-body").count() == 0, "owner cannot comment"
        assert await page.locator("button:has-text('Mark addressed')").count() == 0
        log("owner sees comments read-only")

        await page.click(".tabs a:has-text('Documents')")
        await page.set_input_files("#doc-file", "/tmp/up/Requirements.txt")
        await expect(page.locator("td", has_text="file version 2").first).to_be_visible(timeout=10000)
        log("re-upload recorded as file version 2")

        log("signed in as", await sign_in(page, "a.alhaqbani"))
        await page.goto(page.url.split("#")[0] + "#/opportunities")
        await page.goto(page.url.split("#")[0] + "#/opportunities")
        await page.wait_for_selector(".opp-card", timeout=15000)
        await page.locator(".opp-card").first.click()
        await page.click(".tabs a:has-text('Documents')")
        await expect(page.locator("table.data tbody tr")).to_have_count(3)
        assert await page.locator("#doc-file").count() == 0 and await page.locator("button:has-text('Remove')").count() == 0
        log("GM reads documents, cannot change them")
        print("PAGE ERRORS:", errs[:5])
        await b.close()

asyncio.run(main())
