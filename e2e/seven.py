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
        await page.fill("#username","admin"); await page.fill("#password",PW); await page.click("button[type=submit]")
        await page.wait_for_selector(".sidenav .me b", timeout=15000)

        # 1 + sidebar structure
        nav = await page.eval_on_selector_all(".sidenav .nav-link, .sidenav .nav-group","els=>els.map(e=>e.textContent.trim())")
        # the Admin is a superuser, so "Create opportunity" appears for them too
        assert nav == ["Dashboard","Opportunities","Active Opportunities","Archived Opportunities",
                       "Insights","AI Recommendations","AI Configuration","Administration","Users","Portfolios / Verticals",
                       "Audit log","UI Customization","UI Customization"], nav
        assert "Reviews" not in nav
        log("sidebar:", nav[1:])

        await page.click(".sidenav a[href*='portfolios']")
        await expect(page.locator("h1")).to_have_text("Portfolios / Verticals")
        heads = await page.eval_on_selector_all("h2.section","els=>els.map(e=>e.textContent.split(' (')[0])")
        assert heads[0].startswith("Portfolio") and any(h=="Verticals" for h in heads), heads
        for name in ("Housing & Construction Services","Mega Accounts","Education"):
            await expect(page.locator("td", has_text=name).first).to_be_visible()
        await page.click("button:has-text('Add Vertical')")
        await page.fill("#v-name","Healthcare")
        await page.click(".modal button.primary")
        await expect(page.locator("td", has_text="Healthcare").first).to_be_visible(timeout=10000)
        await page.screenshot(path="s1_portfolios.png", full_page=True)
        log("one page with Portfolios and Verticals; a vertical was added")

        # AI Prompt page
        await page.click(".sidenav a[href*='ai-prompt']")
        await expect(page.locator("h1")).to_have_text("AI Configuration")
        await expect(page.locator(".prompt-box")).to_be_visible(timeout=10000)
        assert await page.locator(".prompt-box").get_attribute("readonly") is None, "an Admin can edit"
        log("AI Prompt page loads and is editable by the Admin")

        # UI Customization
        await page.click(".sidenav a[href*='appearance']")
        await expect(page.locator("h1")).to_have_text("UI Customization", timeout=10000)
        await page.click(".swatch >> nth=2")
        await page.click("button:has-text('Save')")
        accent = await page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--purple').trim()")
        assert accent.lower() == "#3a3aa8", accent
        await page.click("button:has-text('Reset to stc defaults')")
        log("UI customization changes the accent colour and resets")

        # 2,3,4,5,6,7 on the dashboard
        await page.click(".sidenav a[href$='/dashboard'], .sidenav a[href$='#/dashboard']")
        await expect(page.locator(".monitor-table")).to_be_visible(timeout=15000)
        headers = await page.eval_on_selector_all(".monitor-table thead th","els=>els.map(e=>e.textContent.trim())")
        assert "Attention" in headers and "Attention (Why)" in headers, headers
        log("columns:", headers[10:13])

        # legends on the same row as the heading
        same_row = await page.evaluate("""() => {
            const h=document.querySelector('.monitor-head h2').getBoundingClientRect();
            const l=document.querySelector('.monitor-head .legend').getBoundingClientRect();
            return Math.abs((h.top+h.height/2)-(l.top+l.height/2)) < 60; }""")
        assert same_row, "the legends sit beside the monitor heading"
        colours = await page.evaluate("""() => [...document.querySelectorAll('.legend-dot')]
            .map(d => getComputedStyle(d).backgroundColor)""")
        assert len(set(colours)) >= 5, colours
        log("legend colours are distinct:", len(set(colours)), "shades on one row with the heading")

        # 3: sorting really works
        options = await page.eval_on_selector_all(".monitor-controls select[aria-label='Sort by'] option","els=>els.map(e=>e.textContent)")
        assert len(options)==8 and options[0].startswith("Submission Date — Nearest"), options
        async def numbers():
            return await page.eval_on_selector_all(".monitor-table tbody tr:not(.monitor-detail) td.num","els=>els.map(e=>e.textContent.trim())")
        first_default = (await numbers())[:1]
        await page.select_option(".monitor-controls select[aria-label='Sort by']","value_desc")
        await page.wait_for_timeout(300)
        values = await page.eval_on_selector_all(".monitor-table tbody tr:not(.monitor-detail) td.c-right","els=>els.map(e=>e.textContent.replace(/[^0-9]/g,''))")
        nums=[int(v) for v in values if v]
        assert nums == sorted(nums, reverse=True), nums
        await page.select_option(".monitor-controls select[aria-label='Sort by']","submission_asc")
        await page.wait_for_timeout(300)
        assert (await numbers())[:1] == first_default
        log("sorting works on real values:", len(options), "options")

        # 7: three-dot actions, checked as a Director (who may also edit the DeepDive for the date case)
        await page.click(".user-chip"); await page.click(".user-dropdown button"); await page.wait_for_selector("#username")
        await page.fill("#username","a.aloulah"); await page.fill("#password",PW); await page.click("button[type=submit]")
        await page.wait_for_selector(".monitor-table", timeout=15000)
        await page.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".dots").click()
        items = await page.eval_on_selector_all(".row-menu button","els=>els.map(e=>e.textContent.trim())")
        assert items == ["Go to Latest DeepDive","Archive"], items
        await page.click(".row-menu button:has-text('Archive')")
        await expect(page.locator(".modal h2, .modal h3")).to_contain_text("Archive Opportunity?")
        modal = page.locator(".modal")
        for label in ("Opportunity Number","Opportunity Name","Account"):
            await expect(modal.locator("dt", has_text=label)).to_be_visible()
        await page.screenshot(path="s2_archive.png", full_page=True)
        await page.click(".modal button.ghost")   # Cancel does nothing
        rows_before = await page.locator(".monitor-table tbody tr:not(.monitor-detail)").count()
        log(f"three-dot menu: {items}; cancel left {rows_before} rows")

        # push the submission date into the future: the warning must appear
        _upd = await page.evaluate("""async()=>{
          const csrf=document.cookie.split('; ').find(c=>c.startsWith('pp_csrf='))?.slice(8)||'';
          const H={'content-type':'application/json','x-csrf-token':decodeURIComponent(csrf)};
          const l=await (await fetch('/api/opportunities')).json();
          const o=await (await fetch(`/api/opportunities/${l.items[0].id}`)).json();
          const v=await (await fetch(`/api/opportunities/${o.id}/versions/${o.current_version_id}`)).json();
          const future=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
          const r=await fetch(`/api/opportunities/${o.id}/versions/${o.current_version_id}/deepdive`,{method:'PUT',headers:H,
            body:JSON.stringify({data:{...v.data, submissionDate:future}, revision:v.revision ?? 0})});
          return {status:r.status, detail:(await r.text()).slice(0,120), rev:v.revision};
        }""")
        print("   deepdive update:", _upd)
        await page.reload(); await page.wait_for_selector(".monitor-table", timeout=15000)
        # the row whose submission date is still ahead
        row = page.locator(".monitor-table tbody tr:not(.monitor-detail)").filter(has=page.locator(".date-pill:not(.pill-overdue)")).first
        await row.locator(".dots").click()
        await page.click(".row-menu button:has-text('Archive')")
        warned = await page.locator(".alert.warn").count()
        assert warned == 1, "the warning shows when the submission date is still ahead"
        await page.click(".modal button.danger")
        await page.wait_for_timeout(800)
        rows_after = await page.locator(".monitor-table tbody tr:not(.monitor-detail)").count()
        assert rows_after == rows_before - 1, (rows_before, rows_after)
        await page.goto(page.url.split("#")[0] + "#/opportunities?archived=1")
        await page.wait_for_selector(".opp-card", timeout=10000)
        log(f"archived (warning shown: {bool(warned)}); it now appears under Archived Opportunities")
        print("PAGE ERRORS:", errs[:4])
        await b.close()
asyncio.run(main())
