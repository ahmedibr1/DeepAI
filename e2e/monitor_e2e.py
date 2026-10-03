import asyncio, re
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); page=await (await b.new_context(viewport={"width":1600,"height":1000})).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append(str(e)[:160]))
        page.on("console", lambda m: m.type=="error" and errs.append(m.text[:160]))
        await page.goto(FILE); await page.evaluate("localStorage.clear()"); await page.reload()
        await page.evaluate("localStorage.setItem('pp-demo-seen','1')"); await page.reload()
        await page.fill("#username","a.aloulah"); await page.fill("#password",PW); await page.click("button[type=submit]")
        await page.wait_for_selector(".monitor-table", timeout=15000)

        rows = page.locator(".monitor-table tbody tr").filter(has_not=page.locator(".monitor-detail"))
        count = await page.locator(".monitor-table tbody tr:not(.monitor-detail)").count()
        assert count >= 2, count
        log(f"monitor lists {count} active opportunities, including ones with no attention items")

        headers = await page.eval_on_selector_all(".monitor-table thead th", "els => els.map(e => e.textContent.trim())")
        assert headers[:13] == ["#","Opportunity Number","Account","Opportunity Name","Type","Portfolio","Vertical",
                                "Estimated Solution Value(SAR)","Presales Received Date(Days)",
                                "Customer Submission Date(Days Remaining)","Attention","Attention (Why)","Owner"], headers
        log("columns:", ", ".join(headers[1:8]), "…")

        first = page.locator(".monitor-table tbody tr:not(.monitor-detail)").first
        assert await first.locator(".date-pill").count() == 1, "submission date pill with the countdown underneath"
        assert await first.locator("td .attention-count").count() == 1
        assert await page.locator(".legend").count() == 2, "both colour legends are shown"
        assert await page.locator(".monitor-footer").count() == 1, "row count and pagination"
        await expect(page.locator(".monitor-search input")).to_have_attribute("placeholder", "Search opportunities, account, or OP number...")
        await expect(page.locator(".monitor-controls select[aria-label='Portfolio']")).to_contain_text("All Portfolios")
        await expect(page.locator(".monitor-controls select[aria-label='Sort by']")).to_contain_text("Submission Date")
        log("search, portfolio filter and sort note are in one control row")

        # left arrow expands, right arrow opens
        await first.locator(".expander").click()
        await expect(page.locator(".monitor-detail")).to_be_visible(timeout=10000)
        detail = page.locator(".monitor-detail")
        await expect(detail.locator("h4", has_text="Scope")).to_be_visible()
        await expect(detail.locator("h4", has_text=re.compile(r"Risks \("))).to_be_visible()
        await expect(detail.locator("h4", has_text=re.compile(r"Support Needed \("))).to_be_visible()
        await expect(detail.locator("text=Internal")).to_be_visible()
        await expect(detail.locator("text=Partner & Vendor")).to_be_visible()
        for label in ("Add Risk", "Add Support", "Edit"):
            assert await detail.locator(f"text={label}").count() == 0, label
        assert await detail.locator("button").count() == 0, "the monitor is read-only"
        await page.screenshot(path="m1_monitor.png", full_page=True)
        log("expanded view: Scope + compact stakeholders, high risks and support, no editing controls")

        # the far-right control is the actions menu; Edit opens the existing opportunity page
        await first.locator(".dots").click()
        await page.click(".row-menu button:has-text('Go to Latest DeepDive')")
        await expect(page.locator(".opp-head h1")).to_be_visible(timeout=10000)
        log("the ⋮ menu opens the full opportunity through Edit")

        await page.go_back(); await page.wait_for_selector(".monitor-table")
        await page.fill(".monitor-search input", "Ministry")
        await expect(page.locator(".monitor-table tbody tr:not(.monitor-detail)")).to_have_count(1)
        await page.fill(".monitor-search input", "")
        log("search filters the monitor")

        colors = await page.eval_on_selector_all(".monitor-table .date-pill", "els => els.map(e => e.className)")
        assert all("pill-" in c for c in colors), colors
        log("submission colours:", sorted({c.split("pill-")[1] for c in colors}))
        print("PAGE ERRORS:", errs[:4])
        await b.close()
asyncio.run(main())
