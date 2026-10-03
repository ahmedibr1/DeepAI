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
        await page.goto(page.url.split("#")[0]+"#/opportunities")
        await page.wait_for_selector(".opp-card")
        await page.locator(".opp-card", has_text="OP-2026-159388").first.click()
        await expect(page.locator(".version-bar")).to_be_visible(timeout=10000)
        await expect(page.locator("#opp-version")).to_contain_text("v1 (current)")
        log("the version selector sits above the tabs")

        await page.click("button.btn.coral:has-text('Submit to Review')")
        await expect(page.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=15000)

        log("signed in as", await sign_in(page,"m.alasadi"))
        await page.goto(page.url.split("#")[0]+"#/opportunities")
        await page.wait_for_selector(".opp-card")
        await page.locator(".opp-card", has_text="OP-2026-159388").first.click()
        await page.click("button:has-text('Start review')"); await page.click(".modal button.primary")
        await page.click(".tabs a:has-text('Review')")
        await page.fill("#c-body","Comment written on v1")
        await page.click("button:has-text('Add comment')")
        await expect(page.locator(".comment")).to_have_count(1, timeout=10000)

        await page.click(".tabs a:has-text('Overview')")
        await page.click("button:has-text('Create new version')")
        await page.fill("#change-notes","Manager revision")
        await page.click(".modal button.primary")
        await expect(page.locator("#opp-version")).to_contain_text("v2 (current)", timeout=15000)
        log("new version created and selected automatically")

        await page.click(".tabs a:has-text('Documents')")
        await expect(page.locator("table.data tbody tr").first).to_be_visible(timeout=10000)
        carried = await page.locator("table.data tbody tr").count()
        await page.click(".tabs a:has-text('Review')")
        assert await page.locator(".comment").count() == 0, "v2 starts with its own empty review"

        v1 = await page.evaluate("""() => [...document.querySelectorAll('#opp-version option')]
            .find(o => o.textContent.trim().startsWith('v1')).value""")
        await page.select_option("#opp-version", v1)
        await expect(page.locator(".comment", has_text="Comment written on v1")).to_be_visible(timeout=10000)
        await page.click(".tabs a:has-text('Documents')")
        await expect(page.locator("table.data tbody tr")).to_have_count(carried, timeout=10000)
        assert await page.locator("button:has-text('Remove')").count() == 0
        assert await page.locator("#opp-version").input_value() == v1, "the tabs keep the selected version"
        log(f"v1 shows its own review and its {carried} document(s); selection follows across tabs")

        await page.click(".tabs a:has-text('Overview')")
        await expect(page.locator(".kv")).to_be_visible()
        log("Overview is shared across versions")
        await page.screenshot(path="v_demo.png", full_page=True)
        print("PAGE ERRORS:", errs[:4])
        await b.close()
asyncio.run(main())
