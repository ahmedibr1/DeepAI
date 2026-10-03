import asyncio
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)

async def sign_in(page, username):
    if await page.locator(".user-chip").count():
        await page.click(".user-chip"); await page.click(".user-dropdown button"); await page.wait_for_selector("#username")
    await page.fill("#username",username); await page.fill("#password",PW); await page.click("button[type=submit]")
    await page.wait_for_selector(".sidenav .me b", timeout=15000)
    await page.goto(page.url.split("#")[0] + "#/dashboard")
    await page.wait_for_selector(".stat", timeout=15000)

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); page=await (await b.new_context(viewport={"width":1900,"height":1000})).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append(str(e)[:150]))
        await page.goto(FILE); await page.evaluate("localStorage.clear()"); await page.reload()
        await page.evaluate("localStorage.setItem('pp-demo-seen','1')"); await page.reload()

        # 1: cards per role
        for user, expected in (("m.alasadi", ["Active Opportunities","RFP | RFI | Non-RFP","AI Recommendations Available","Opportunities Needing Attention"]),
                               ("a.alhaqbani",        ["Active Opportunities","RFP | RFI | Non-RFP","AI Recommendations Available","Opportunities Needing Attention"]),
                               ("a.aloulah",  ["Active Opportunities","RFP | RFI | Non-RFP","Awaiting My Review","Ready for AI","Opportunities Needing Attention"])):
            await sign_in(page, user)
            cards = await page.eval_on_selector_all(".stat","els=>els.map(e=>e.getAttribute('aria-label')||e.querySelector('.l').textContent.trim())")
            assert cards == expected, (user, cards)
            log(f"{user}: {len(cards)} cards — {cards[1:-1]}")

        # 2 + 3: three types, four portfolios, three verticals
        segs = await page.eval_on_selector_all(".stat .segments","els=>els.map(e=>e.innerText.replace(/\\n/g,' '))")
        assert "RFP" in segs[0].upper() and "RFI" in segs[0].upper() and "NON-RFP" in segs[0].upper(), segs
        assert len(segs) == 1, segs
        counts = await page.eval_on_selector_all(".stat .segments b","els=>els.map(e=>e.textContent)")
        log("type mix:", segs[0])
        assert len(counts) == 3, counts

        # 4: the menu is fully visible, not clipped by the table
        await page.wait_for_selector(".monitor-table")
        await page.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".dots").click()
        box = await page.evaluate("""() => {const m=document.querySelector('.row-menu');
            const r=m.getBoundingClientRect();
            const inView = r.right <= window.innerWidth && r.bottom <= window.innerHeight && r.left >= 0;
            const clipped = [...document.elementsFromPoint(r.left+10, r.top+10)].some(e=>e.classList.contains('row-menu'));
            return {inView, clipped, w: Math.round(r.width), h: Math.round(r.height)};}""")
        assert box["inView"] and box["clipped"], box
        texts = await page.eval_on_selector_all(".row-menu button","els=>els.map(e=>e.textContent.trim())")
        assert texts == ["Go to Latest DeepDive","Archive"], texts
        await page.screenshot(path="sx.png", full_page=True)
        await page.click(".row-menu button:has-text('Go to Latest DeepDive')")
        await expect(page.locator(".tabs a.active")).to_have_text("DeepDive", timeout=10000)
        log(f"the menu renders clear of the table ({box['w']}×{box['h']}) and opens the DeepDive")

        # 5 + 6: header wraps and the columns sit close
        await page.go_back(); await page.wait_for_selector(".monitor-table")
        lines_ = await page.evaluate("""() => [...document.querySelectorAll('.monitor-table thead th')]
            .map(t => ({sub: t.querySelector('.sub-head') ? t.querySelector('.sub-head').textContent : null,
                        twoLines: !!t.querySelector('br')}))""")
        assert lines_[9]["sub"] == "(Days Remaining)" and lines_[9]["twoLines"], lines_[9]
        assert lines_[8]["sub"] == "(Days)" and lines_[7]["sub"] == "(SAR)", lines_[7:9]
        gap = await page.evaluate("""() => {const tr=document.querySelector('.monitor-table tbody tr:not(.monitor-detail)');
            const range=document.createRange(); range.selectNodeContents(tr.children[6]);
            const vEnd=range.getBoundingClientRect().right;
            range.selectNodeContents(tr.children[7]);
            return Math.round(range.getBoundingClientRect().left - vEnd);}""")
        assert gap < 120, f"still {gap}px between Vertical and the value"
        log(f"(Days Remaining) on its own line; gap between Vertical and Value is {gap}px")
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
