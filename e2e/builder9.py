import asyncio
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={"width":1500,"height":950})).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
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
            if frame and await frame.locator(".step-kicker").count(): break
            await pg.wait_for_timeout(250)
        kicker = await frame.locator(".step-kicker").first.inner_text()
        assert kicker == "Step 1 of 9", kicker
        nav = await frame.eval_on_selector_all("nav li button .label","els=>els.map(e=>e.textContent.trim())")
        assert nav == ["Opportunity","Scope","Stakeholders","Winning strategy","Risks","Readiness checklist",
                       "Support needed","Documents","Review & download"], nav
        log("builder steps:", nav)
        # the documents step jumps to the panel in the portal
        assert await pg.locator("#deepdive-documents").count() == 0, "documents open only when asked"
        width = await frame.evaluate("() => document.querySelector('.shell').getBoundingClientRect().width")
        inner = await frame.evaluate("() => innerWidth")
        assert width > inner - 40, f"the builder should fill the frame: {width} of {inner}"
        log(f"builder fills the frame: {int(width)}px of {int(inner)}px")
        await frame.click("#goDocs")
        await pg.wait_for_timeout(900)
        assert "step=documents" in pg.url, pg.url
        assert await pg.locator(".builder-frame").count() == 0, "the form is replaced, not scrolled past"
        head = await pg.locator("#deepdive-documents h2.section").first.inner_text()
        assert head.upper().startswith("STEP 8 OF 9"), head
        log("documents panel:", head.replace("\\n", " "))
        await pg.click("button:has-text('Back to the DeepDive form')")
        await pg.wait_for_timeout(600)
        box = await pg.evaluate("""() => {const f=document.querySelector('.builder-frame');
            const r=f.getBoundingClientRect(); return Math.round(r.height);}""")
        log(f"back on the form — builder height: {box}px of a 950px window")
        assert box >= 700, box
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
