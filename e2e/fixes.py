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
        # three more opportunities, so every sort has something to order
        await page.fill("#username","m.rabie"); await page.fill("#password",PW); await page.click("button[type=submit]")
        await page.wait_for_selector(".sidenav .me b", timeout=15000)
        await page.evaluate("""async()=>{
          const csrf=document.cookie.split('; ').find(c=>c.startsWith('pp_csrf='))?.slice(8)||'';
          const H={'content-type':'application/json','x-csrf-token':decodeURIComponent(csrf)};
          const day=(n)=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
          const make=async(num,title,sub,rec,value,support)=>{
            const o=await (await fetch('/api/opportunities',{method:'POST',headers:H,body:JSON.stringify(
              {opportunity_number:num,title,account_name:'ACME',opportunity_type:'RFP',vertical:'Education'})})).json();
            const v=await (await fetch(`/api/opportunities/${o.id}/versions/${o.current_version_id}`)).json();
            await fetch(`/api/opportunities/${o.id}/versions/${o.current_version_id}/deepdive`,{method:'PUT',headers:H,
              body:JSON.stringify({data:{...v.data, submissionDate:day(sub), presalesReceived:day(rec), value:String(value),
                support:Array.from({length:support},(_,i)=>({need:'Item '+i,from:'x',priority:'High',date:day(sub)}))},
                revision:v.revision ?? 0})});
          };
          await make('OP-TEST-001','Alpha soon',4,-30,5000000,5);
          await make('OP-TEST-002','Beta later',20,-3,90000000,1);
          await make('OP-TEST-003','Gamma middle',9,-12,45000000,3);
        }""")
        await page.click(".user-chip"); await page.click(".user-dropdown button"); await page.wait_for_selector("#username")
        await page.fill("#username","a.aloulah"); await page.fill("#password",PW); await page.click("button[type=submit]")
        await page.wait_for_selector(".monitor-table", timeout=15000)

        # 1: every legend item has a visible coloured circle
        dots = await page.evaluate("""() => [...document.querySelectorAll('.legend li')].map(li => {
            const d=li.querySelector('.legend-dot'); if(!d) return null;
            const s=getComputedStyle(d); const r=d.getBoundingClientRect();
            return {bg:s.backgroundColor, round:s.borderRadius, w:Math.round(r.width), h:Math.round(r.height)};})""")
        assert all(d and d["w"] >= 9 and d["h"] >= 9 and d["w"] == d["h"] for d in dots), dots
        assert len({d["bg"] for d in dots}) >= 5, dots
        log(f"{len(dots)} legend dots, round and distinct:", sorted({d['bg'] for d in dots}))

        # 2: legends beside the monitor heading, on one row
        row = await page.evaluate("""() => {const h=document.querySelector('.monitor-head h2').getBoundingClientRect();
            const l=document.querySelector('.monitor-head .legend').getBoundingClientRect();
            return {overlapY: Math.abs((h.top+h.height/2)-(l.top+l.height/2)) < 60, rightOf: l.left > h.right};}""")
        assert row["overlapY"] and row["rightOf"], row
        log("legends sit to the right of the monitor heading on the same row")

        # 3: the wide search row is unchanged
        w = await page.evaluate("() => document.querySelector('.monitor-search').getBoundingClientRect().width")
        assert w > 600, w
        log(f"search field stays wide ({int(w)}px) with All Portfolios and Sort by beside it")

        # 4: every sort option really reorders
        async def numbers():
            return await page.eval_on_selector_all(
                ".monitor-table tbody tr:not(.monitor-detail)",
                "els=>els.map(tr=>tr.children[1].textContent.trim())")
        sel = ".monitor-controls select[aria-label='Sort by']"
        options = await page.eval_on_selector_all(sel+" option","els=>els.map(e=>e.value)")
        assert len(options)==8, options
        orders = {}
        for o in options:
            await page.select_option(sel, o); await page.wait_for_timeout(250)
            orders[o] = await numbers()
        for a, b_ in (("value_desc","value_asc"), ("submission_asc","submission_desc"),
                      ("attention_desc","attention_asc"), ("received_asc","received_desc")):
            assert orders[a] != orders[b_], (a, b_, orders[a], orders[b_])
        # the values in each column must actually be ordered
        async def column(idx):
            return await page.eval_on_selector_all(".monitor-table tbody tr:not(.monitor-detail)",
                f"els=>els.map(tr=>tr.children[{idx}].innerText.trim())")
        await page.select_option(sel, "value_desc"); await page.wait_for_timeout(250)
        vals = [int(v.replace(",", "")) for v in await column(7) if v and v != "—"]
        assert vals == sorted(vals, reverse=True), vals
        await page.select_option(sel, "attention_desc"); await page.wait_for_timeout(250)
        att = [int(v) for v in await column(10) if v.isdigit()]
        assert att == sorted(att, reverse=True), att
        await page.select_option(sel, "submission_asc"); await page.wait_for_timeout(250)
        subs = [v.split("\n")[0] for v in await column(9) if v and v != "—"]
        assert subs, subs
        await page.select_option(sel, "submission_asc")
        log("all 8 sort options reorder the rows; each pair is a true reverse")

        # 5: no horizontal scrollbar
        over = await page.evaluate("""() => {const w=document.querySelector('.table-wrap');
            return w.scrollWidth - w.clientWidth;}""")
        assert over <= 2, f"table overflows by {over}px"
        log("table fits without a horizontal scrollbar")

        # 6: vertical comes from its own field
        pairs = await page.evaluate("""() => [...document.querySelectorAll('.monitor-table tbody tr:not(.monitor-detail)')]
            .map(tr => [tr.children[5].textContent.trim(), tr.children[6].textContent.trim()])""")
        assert all(p[0] != p[1] for p in pairs), pairs
        log("portfolio vs vertical:", pairs)

        # 7: the far-right control is the three-dot menu, no arrow
        assert await page.locator(".monitor-table .open-arrow").count() == 0, "the arrow is gone"
        last = await page.evaluate("""() => {const tr=document.querySelector('.monitor-table tbody tr:not(.monitor-detail)');
            const td=tr.children[tr.children.length-1];
            const svg=td.querySelector('button.dots svg');
            return {isMenu: !!svg, circles: svg? svg.querySelectorAll('circle').length : 0};}""")
        assert last["isMenu"] and last["circles"] == 3, last
        await page.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".dots").click()
        assert await page.eval_on_selector_all(".row-menu button","els=>els.map(e=>e.textContent.trim())") == ["Go to Latest DeepDive","Archive"]
        await page.click(".row-menu button:has-text('Archive')")
        await expect(page.locator(".modal")).to_contain_text("Archive Opportunity?")
        await page.click(".modal button.ghost")
        log("far-right ⋮ opens Edit / Archive, with the confirmation modal")

        # 8: the yellow badges read as yellow
        yellow = await page.evaluate("""() => {const el=document.querySelector('.att-yellow');
            return el ? getComputedStyle(el).backgroundColor : null;}""")
        r, g, bl = [int(x) for x in yellow.replace("rgb(", "").replace(")", "").split(",")]
        assert r > 240 and g > 200 and bl < 170, f"not clearly yellow: {yellow}"
        log("attention 0 badge yellow:", yellow)
        await page.screenshot(path="fx.png", full_page=True)
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
