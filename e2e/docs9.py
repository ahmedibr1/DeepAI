import asyncio
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={"width":1500,"height":950})).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
        pg.on("console", lambda m: m.type=="error" and errs.append(m.text[:150]))
        await pg.goto(FILE); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.evaluate("localStorage.setItem('pp-demo-seen','1')"); await pg.reload()
        await pg.fill("#username","m.rabie"); await pg.fill("#password",PW); await pg.click("button[type=submit]")
        await pg.wait_for_selector(".sidenav .me b", timeout=15000)
        await pg.goto(pg.url.split("#")[0]+"#/opportunities"); await pg.wait_for_selector(".opp-card")
        await pg.locator(".opp-card", has_text="OP-2026-159388").first.click()
        await pg.click(".tabs a:has-text('DeepDive')")
        frame=None
        for _ in range(60):
            frame=next((f for f in pg.frames if "blob:" in f.url or "srcdoc" in f.url), None)
            if frame and await frame.locator("#stepList li button .label").count(): break
            await pg.wait_for_timeout(250)
        nav = await frame.eval_on_selector_all("#stepList li button .label","els=>els.map(e=>e.textContent.trim())")
        print("   nav:", nav)
        assert nav[7] == "Documents" and len(nav) == 9, nav
        log("builder steps:", nav)

        # the Documents step lives inside the form
        await frame.locator("#stepList li button", has_text="Documents").click()
        await expect(frame.locator(".doc-table")).to_be_visible(timeout=10000)
        kicker = await frame.locator(".step-kicker").inner_text()
        assert kicker == "Step 8 of 9", kicker
        assert await pg.locator("#deepdive-documents").count() == 0, "no separate documents panel in the page"
        await frame.wait_for_selector(".doc-snapshot li", timeout=10000)
        rows = await frame.locator(".doc-table tbody tr").count()
        snap = await frame.eval_on_selector_all(".doc-snapshot li","els=>els.map(e=>e.innerText.replace(/\\n/g,' '))")
        log(f"inside the form: {rows} document row(s); snapshot: {snap[0]} / {snap[1]}")

        # upload from inside the form
        open("/tmp/up/TP.txt","w").write("Technical proposal draft\n")
        await frame.select_option("#docCategory","tp")
        await frame.set_input_files("#docFiles","/tmp/up/TP.txt")
        await expect(frame.locator("td", has_text="TP.txt")).to_be_visible(timeout=15000)
        snap = await frame.eval_on_selector_all(".doc-snapshot li","els=>els.map(e=>e.innerText.replace(/\\n/g,' '))")
        assert "v1" in snap[1], snap
        log("uploaded from inside the form; snapshot now:", snap[1])
        await pg.screenshot(path="docs_in_form.png")
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
