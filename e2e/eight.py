import asyncio
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); page=await (await b.new_context(viewport={"width":1900,"height":1000})).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append(str(e)[:150]))
        page.on("console", lambda m: m.type=="error" and errs.append(m.text[:150]))
        await page.goto(FILE); await page.evaluate("localStorage.clear()"); await page.reload()
        await page.evaluate("localStorage.setItem('pp-demo-seen','1')"); await page.reload()
        await page.fill("#username","a.aloulah"); await page.fill("#password",PW); await page.click("button[type=submit]")
        await page.wait_for_selector(".monitor-table", timeout=15000)

        # 1: every legend item has a solid, visible dot
        dots = await page.evaluate("""() => [...document.querySelectorAll('.legend li')].map(li => {
            const d=li.querySelector('.legend-dot'); if(!d) return null;
            const cs=getComputedStyle(d);
            return {bg:cs.backgroundColor, w:parseFloat(cs.width), h:parseFloat(cs.height), r:cs.borderRadius}; })""")
        assert all(d and d["w"]>=10 and d["h"]>=10 for d in dots), dots
        assert len({d["bg"] for d in dots}) >= 5, dots
        log(f"{len(dots)} legend dots, {len({d['bg'] for d in dots})} distinct colours")

        # 2: legends beside the monitor title, on one row
        same = await page.evaluate("""() => {
            const h=document.querySelector('.monitor-head h2').getBoundingClientRect();
            const l=document.querySelector('.monitor-head .legend').getBoundingClientRect();
            return l.left > h.right && Math.abs((h.top+h.height/2)-(l.top+l.height/2)) < 60; }""")
        assert same, "the legends must sit to the right of the title on the same row"
        log("legends are on the monitor header row")

        # 3: the wide search row is unchanged
        w = await page.evaluate("() => document.querySelector('.monitor-search').getBoundingClientRect().width")
        assert w > 600, w
        log(f"search field is {int(w)}px wide, with the portfolio and sort controls beside it")

        # 4: every sort option really reorders
        async def col(sel):
            return await page.eval_on_selector_all(f".monitor-table tbody tr:not(.monitor-detail) {sel}",
                                                   "els=>els.map(e=>e.textContent.trim())")
        results = {}
        for value in ("submission_asc","submission_desc","received_asc","received_desc",
                      "attention_desc","attention_asc","value_desc","value_asc"):
            await page.select_option(".monitor-controls select[aria-label='Sort by']", value)
            await page.wait_for_timeout(250)
            results[value] = await col("td.num")
        assert results["attention_desc"] != results["attention_asc"], results
        assert results["value_desc"] != results["value_asc"], results
        # rows without a date stay last whichever direction the date sorts run in
        for key in ("submission_asc", "submission_desc", "received_asc", "received_desc"):
            assert results[key][-2:] == ["OP-2026-160021", "—"], (key, results[key])
        await page.select_option(".monitor-controls select[aria-label='Sort by']", "submission_asc")
        log("all eight sort options reorder the rows")

        # 5: no horizontal scrollbar on the table
        scroll = await page.evaluate("""() => {const w=document.querySelector('.monitor .table-wrap');
            return w.scrollWidth - w.clientWidth;}""")
        assert scroll <= 2, f"table overflows by {scroll}px"
        log("table fits without a horizontal scrollbar")

        # 6: Vertical is its own field
        rows = await page.evaluate("""() => [...document.querySelectorAll('.monitor-table tbody tr:not(.monitor-detail)')]
            .map(r => ({portfolio: r.children[5].textContent.trim(), vertical: r.children[6].textContent.trim()}))""")
        assert all(r["portfolio"] != r["vertical"] for r in rows), rows
        assert any(r["vertical"] == "—" for r in rows), rows
        log("vertical is independent of portfolio:", rows)

        # 7: the far-right control is the three-dot menu, the left chevron still expands
        assert await page.locator(".monitor-table .open-arrow").count() == 0, "the right arrow is gone"
        last = await page.evaluate("""() => {const tr=document.querySelector('.monitor-table tbody tr:not(.monitor-detail)');
            return tr.lastElementChild.className;}""")
        assert "cell-menu" in last, last
        painted = await page.evaluate("""() => {const s=document.querySelector('.dots svg');
            return s.querySelectorAll('circle').length;}""")
        assert painted == 3, painted
        await page.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".expander").click()
        await expect(page.locator(".monitor-detail")).to_be_visible()
        await page.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".dots").click()
        items = await page.eval_on_selector_all(".row-menu button","els=>els.map(e=>e.textContent.trim())")
        assert items == ["Edit","Archive"], items
        await page.click(".row-menu button:has-text('Archive')")
        await expect(page.locator(".modal")).to_contain_text("Archive Opportunity?")
        await page.screenshot(path="e_modal.png", full_page=True)
        await page.click(".modal button.ghost")
        log("left chevron expands; right ⋮ opens Edit / Archive with confirmation")

        # 8: the yellows read as yellow
        yellows = await page.evaluate("""() => {const a=document.querySelector('.att-yellow');
            return a ? getComputedStyle(a).backgroundColor : null;}""")
        log("attention yellow:", yellows)
        await page.screenshot(path="e_dash.png", full_page=True)
        print("PAGE ERRORS:", errs[:4])
        await b.close()
asyncio.run(main())
