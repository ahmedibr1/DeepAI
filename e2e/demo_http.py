import asyncio, re
from playwright.async_api import async_playwright, expect
FILE = 'http://localhost:4180/Presales_Portal_Phase1_Demo.html'
PW = "Demo2026pass"
log = lambda *a: print("•", *a, flush=True)

async def sign_in(page, username, password=PW):
    if await page.locator("button[aria-label='Sign out']").count():
        await page.click("button[aria-label='Sign out']")
        await page.wait_for_selector("#username")
    await page.fill("#username", username); await page.fill("#password", password)
    await page.click("button[type=submit]")
    await page.wait_for_selector(".sidenav .me b")
    await page.goto(page.url.split("#")[0] + "#/dashboard")   # sign-in returns you to the page you were on
    await page.wait_for_selector(".stat")
    return await page.locator(".sidenav .me b").inner_text()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1440, "height": 950}, accept_downloads=True)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errs.append(m.text[:200]))
        await page.goto(FILE)
        await page.evaluate("localStorage.setItem('pp-demo-seen','1')")
        await page.reload()

        log("signed in as", await sign_in(page, "m.rabie"))
        await expect(page.locator(".stat.hero .v")).to_have_text("1")
        await page.locator(".opp-card, a.opp-title").first.click()
        await page.click("a:has-text('DeepDive')")
        frame = None
        for _ in range(60):
            frame = next((f for f in page.frames if "blob:" in f.url), None)
            if frame and await frame.locator('[data-path="customer"]').count(): break
            await page.wait_for_timeout(250)
        await expect(frame.locator('[data-path="customer"]')).to_have_value("Red Sea Global")
        assert await frame.locator('[data-path="oppNumber"]').get_attribute("readonly") is not None
        log("builder loaded inside the demo with the Red Sea Global DeepDive")

        # edit → autosave through the in-browser API
        await frame.locator('[data-go="1"]').click()
        sow = frame.locator('[data-path="sow"]')
        await sow.click(); await sow.press("End"); await sow.type("\nDeliver an RFP compliance matrix")
        await expect(page.locator(".save-state")).to_have_text(re.compile("Saved"), timeout=15000)
        log("edit autosaved")

        # PowerPoint generation still works
        await frame.locator('[data-go="7"]').click()
        async with page.expect_download() as dl:
            await frame.locator("#btnDownload").click()
        log("downloaded", (await dl.value).suggested_filename)

        await page.click("button.btn.coral:has-text('Submit to Review')")
        await expect(page.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=10000)
        log("submitted")

        log("signed in as", await sign_in(page, "a.aloulah"))
        await expect(page.locator(".stat", has_text="Awaiting my review").locator(".v")).to_have_text("1")
        await page.locator(".opp-card, a.opp-title").first.click()
        await page.click("button:has-text('Start review')"); await page.click(".modal button.primary")
        await page.click("button:has-text('Request changes')")
        await page.fill("#action-comment", "Add the RFP compliance matrix and confirm SenseTime deal registration.")
        await page.click(".modal button.primary")
        await expect(page.locator(".opp-head .badge").first).to_have_text("Changes Requested")
        log("director requested changes")

        log("signed in as", await sign_in(page, "m.rabie"))
        await page.click("button[aria-label^='Notifications']")
        await page.click(".notif >> text=Changes requested")
        await expect(page.locator(".alert.info", has_text="requested changes")).to_contain_text("compliance matrix")
        await page.click("button:has-text('Create new version')")
        await page.fill("#change-notes", "Added compliance matrix")
        await page.click(".modal button.primary")
        await expect(page.locator("#version-select")).to_contain_text("v2 (current) · editing", timeout=10000)
        await page.click("button.btn.coral:has-text('Submit to Review')")
        await expect(page.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=10000)
        log("v2 created and resubmitted")

        log("signed in as", await sign_in(page, "a.aloulah"))
        await page.locator(".opp-card, a.opp-title").first.click()
        await page.click("button:has-text('Start review')"); await page.click(".modal button.primary")
        await page.click("button:has-text('Ready for AI analysis')"); await page.click(".modal button.primary")
        await expect(page.locator(".opp-head .badge").first).to_have_text("Ready for AI")
        assert await page.locator(".opp-head button:has-text('Run AI analysis')").count() == 0, \
            "AI analysis is started from the AI tab, not the workflow header"
        log("ready for AI; the run is started from the AI tab")

        log("signed in as", await sign_in(page, "a.alhaqbani"))
        await expect(page.locator(".stat.hero .v")).to_have_text("2")   # sees both teams
        await page.screenshot(path="d1_gm.png")

        log("signed in as", await sign_in(page, "s.otaibi"))
        assert await page.locator("table.data tbody tr").count() == 0, "other presales sees nothing"

        log("signed in as", await sign_in(page, "admin"))
        await page.goto(FILE + "#/admin/audit")
        await expect(page.locator("code", has_text="opportunity.status_changed").first).to_be_visible()
        await page.screenshot(path="d2_audit.png")
        actions = await page.eval_on_selector_all("table.data td code", "els => els.map(e => e.textContent)")
        log("audit actions:", sorted(set(a for a in actions if a and "." in a)))
        print("PAGE ERRORS:", errs[:5])
        await b.close()

asyncio.run(main())
