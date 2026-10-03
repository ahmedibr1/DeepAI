import asyncio, re
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)

async def login(pg, u):
    if await pg.locator(".user-chip").count():
        await pg.click(".user-chip"); await pg.click(".user-dropdown button"); await pg.wait_for_selector("#username")
    await pg.fill("#username",u); await pg.fill("#password",PW); await pg.click("button[type=submit]")
    await pg.wait_for_selector(".sidenav .me b", timeout=15000)

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={"width":1600,"height":1000})).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
        pg.on("console", lambda m: m.type=="error" and errs.append(m.text[:160]))
        await pg.goto(FILE); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.evaluate("localStorage.setItem('pp-demo-seen','1')"); await pg.reload()

        await login(pg,"m.rabie")
        await pg.goto(pg.url.split("#")[0]+"#/opportunities"); await pg.wait_for_selector(".opp-card")
        await pg.locator(".opp-card", has_text="OP-2026-159388").first.click()
        await pg.wait_for_selector(".tabs a", timeout=15000)
        tabs = await pg.eval_on_selector_all(".tabs a","els=>els.map(e=>e.textContent.trim().replace(/ \\(\\d+\\)/,''))")
        assert tabs == ["Overview","DeepDive","Review & Governance","AI Accepted Tracker","Readiness Checklist","Versions"], tabs
        log("sections:", tabs)
        body = await pg.locator(".content").inner_text()
        assert "AI analysis reads this DeepDive" not in body
        log("the removed sentence is gone from the Overview")

        await pg.click(".tabs a:has-text('DeepDive')")
        await expect(pg.locator(".step-trail li").first).to_be_visible(timeout=10000)
        steps = await pg.eval_on_selector_all(".step-trail li","els=>els.map(e=>e.innerText.replace(/\\n/g,' | '))")
        log("steps:", [x[:46] for x in steps])
        cards = await pg.eval_on_selector_all(".trail-card b","els=>els.map(e=>e.textContent.trim())")
        assert cards == ["DeepDive Builder","AI Analysis"], cards
        await pg.locator(".trail-card", has_text="AI Analysis").click()
        await pg.wait_for_timeout(400)
        assert "step=ai" in pg.url, pg.url
        await pg.locator(".trail-card", has_text="DeepDive Builder").click()
        await pg.wait_for_timeout(400)
        # documents are step 8 of the builder: open them from the form's step list
        frame = None
        for _ in range(40):
            frame = next((f for f in pg.frames if "blob:" in f.url or "srcdoc" in f.url), None)
            if frame and await frame.locator("#stepList li button").count(): break
            await pg.wait_for_timeout(250)
        await frame.locator("#stepList li button", has_text="Documents").click()
        await frame.wait_for_selector(".doc-snapshot li", timeout=10000)

        # upload the documents of this version: customer + CP (no TP yet)
        open("/tmp/up/RFP.txt","w").write("4 Requirements\n4.4 Service levels\n99.9% SLA required.\n")
        open("/tmp/up/CP.txt","w").write("Commercial proposal. Total price SAR 35,000,000.\n")
        await frame.select_option("#docCategory","rfp")
        await frame.set_input_files("#docFiles","/tmp/up/RFP.txt")
        await expect(frame.locator("td", has_text="RFP.txt")).to_be_visible(timeout=15000)
        await frame.select_option("#docCategory","cp")
        await frame.set_input_files("#docFiles","/tmp/up/CP.txt")
        await expect(frame.locator("td", has_text="CP.txt")).to_be_visible(timeout=15000)
        log("documents uploaded into the version")

        await pg.click(".opp-head button:has-text('Submit to Review'), .opp-head button.coral")
        await expect(pg.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=15000)

        # Director reviews and completes
        await login(pg,"a.aloulah")
        await pg.goto(pg.url.split("#")[0]+"#/opportunities"); await pg.wait_for_selector(".opp-card")
        await pg.locator(".opp-card", has_text="OP-2026-159388").first.click()
        await pg.click(".tabs a:has-text('Review & Governance')")
        await pg.fill("#c-body","Confirm the SLA commitment before pricing.")
        await pg.click("button:has-text('Add comment')")
        await expect(pg.locator(".comment").first).to_be_visible(timeout=10000)
        log("director added a governance comment")

        # AI analysis: eligibility computed automatically
        await pg.click(".tabs a:has-text('DeepDive')")
        # AI Analysis opens once the Presales Director confirms the DeepDive session
        await pg.locator(".trail-card", has_text="AI Analysis").click()
        await pg.click("button:has-text('Confirm the DeepDive session')")
        await expect(pg.locator(".analysis").first).to_be_visible(timeout=10000)
        print("   ws:", await pg.evaluate("""async()=>{const id=location.hash.split('/')[2];
            const w=await (await fetch('/api/opportunities/'+id+'/workspace')).json();
            return w.analyses.map(a=>a.kind+':'+a.status+' ('+a.reason+')');}"""))
        cards = await pg.eval_on_selector_all(".analysis","els=>els.map(e=>e.innerText.split('\\n').slice(0,2).join(' — '))")
        for c in cards: log("  ", c[:70])
        assert any("Technical Analysis" in c and "Not Eligible" in c for c in cards), cards
        assert any("Commercial Analysis" in c and "Ready for AI" in c for c in cards), cards
        await pg.screenshot(path="ws_ai.png", full_page=True)

        await pg.locator(".analysis", has_text="Early Analysis").locator("button").click()
        await expect(pg.locator(".finding").first).to_be_visible(timeout=20000)
        n = await pg.locator(".finding").count()
        log(f"early analysis produced {n} findings")
        await pg.locator(".finding").first.locator("button:has-text('Accept')").first.click()
        await pg.wait_for_timeout(700)
        await pg.click(".tabs a:has-text('AI Accepted Tracker')")
        await expect(pg.locator("table.data tbody tr").first).to_be_visible(timeout=10000)
        log("accepted item appears in the tracker")
        await pg.screenshot(path="ws_tracker.png", full_page=True)

        await pg.click(".tabs a:has-text('Readiness Checklist')")
        await expect(pg.locator("table.data tbody tr").first).to_be_visible(timeout=10000)
        rows = await pg.locator("table.data tbody tr").count()
        log(f"readiness checklist: {rows} rows")
        await pg.screenshot(path="ws_readiness.png", full_page=True)
        print("PAGE ERRORS:", errs[:4])
        await b.close()
asyncio.run(main())
