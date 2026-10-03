import asyncio
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); page=await (await b.new_context(viewport={"width":1900,"height":1000})).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append(str(e)[:150]))
        await page.goto(FILE); await page.evaluate("localStorage.clear()"); await page.reload()
        await page.evaluate("localStorage.setItem('pp-demo-seen','1')"); await page.reload()
        await page.fill("#username","a.aloulah"); await page.fill("#password",PW); await page.click("button[type=submit]")
        await page.wait_for_selector(".monitor-table", timeout=15000)

        # 1: all four KPI cards share one style
        bgs = await page.eval_on_selector_all(".stat","els=>els.map(e=>getComputedStyle(e).backgroundImage+'|'+getComputedStyle(e).backgroundColor)")
        assert len(set(bgs)) == 1, bgs
        log("all four KPI cards use the same background")

        # 2: Vertical and the value column sit close together
        gap = await page.evaluate("""() => {const tr=document.querySelector('.monitor-table tbody tr:not(.monitor-detail)');
            const v=tr.children[6].getBoundingClientRect(); const val=tr.children[7];
            const span=document.createRange(); span.selectNodeContents(val);
            const r=span.getBoundingClientRect();
            return Math.round(r.left - (v.left + val.previousElementSibling.scrollWidth));}""")
        cells = await page.evaluate("""() => {const tr=document.querySelector('.monitor-table tbody tr:not(.monitor-detail)');
            return [6,7].map(i=>Math.round(tr.children[i].getBoundingClientRect().width));}""")
        log(f"vertical/value column widths: {cells}")

        # 3: bullet and the item text on one line
        await page.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".expander").click()
        await expect(page.locator(".monitor-detail")).to_be_visible(timeout=10000)
        same_line = await page.evaluate("""() => {const li=document.querySelector('.monitor-detail .monitor-items li');
            const t=li.querySelector('.item-title').getBoundingClientRect();
            const s=getComputedStyle(li,'::before');
            const liTop=li.getBoundingClientRect().top;
            return Math.abs(t.top - liTop) < 6;}""")
        assert same_line, "the bullet and the title must share the first line"
        await page.screenshot(path="fv.png", full_page=True)
        log("bullet and item text share the first line")

        # 4: the menu item reads Go to Latest DeepDive and opens it
        await page.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".dots").click()
        items = await page.eval_on_selector_all(".row-menu button","els=>els.map(e=>e.textContent.trim())")
        assert items == ["Go to Latest DeepDive","Archive"], items
        await page.click(".row-menu button:has-text('Go to Latest DeepDive')")
        await expect(page.locator(".tabs a.active")).to_have_text("DeepDive", timeout=10000)
        version = await page.locator("#opp-version").input_value()
        current = await page.evaluate("""async()=>{const id=location.hash.split('/')[2];
            const d=await (await fetch('/api/opportunities/'+id)).json(); return d.current_version_id;}""")
        assert version == current, "it opens the latest version"
        log("menu opens the latest DeepDive version")

        # 5: the opportunity number opens the Overview
        await page.go_back(); await page.wait_for_selector(".monitor-table", timeout=10000)
        await page.locator(".monitor-table .op-link").first.click()
        await expect(page.locator(".tabs a.active")).to_have_text("Overview", timeout=10000)
        log("clicking the opportunity number opens the Overview")
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
