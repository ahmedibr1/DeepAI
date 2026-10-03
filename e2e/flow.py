import asyncio
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)
async def login(pg,u):
    if await pg.locator(".user-chip").count():
        await pg.click(".user-chip"); await pg.click(".user-dropdown button"); await pg.wait_for_selector("#username")
    await pg.fill("#username",u); await pg.fill("#password",PW); await pg.click("button[type=submit]")
    await pg.wait_for_selector(".sidenav .me b", timeout=15000)
async def open_opp(pg):
    await pg.goto(pg.url.split("#")[0]+"#/opportunities"); await pg.wait_for_selector(".opp-card")
    await pg.locator(".opp-card", has_text="OP-2026-159388").first.click()
    await pg.wait_for_selector(".tabs a", timeout=15000)
async def builder(pg):
    for _ in range(60):
        f = next((x for x in pg.frames if "blob:" in x.url or "srcdoc" in x.url), None)
        if f and await f.locator("#stepList li button").count(): return f
        await pg.wait_for_timeout(250)
    return None
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={"width":1500,"height":950})).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
        await pg.goto(FILE); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.evaluate("localStorage.setItem('pp-demo-seen','1')"); await pg.reload()

        await login(pg,"m.rabie"); await open_opp(pg)
        await pg.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pg.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=15000)
        log("presales submitted v1")

        # the Director opens the DeepDive and reads the content
        await login(pg,"a.aloulah"); await open_opp(pg)
        await pg.click(".tabs a:has-text('DeepDive')")
        f = await builder(pg)
        assert f, "the builder did not load for the Director"
        value = await f.locator('[data-path="customer"]').input_value()
        readonly = await f.locator('[data-path="customer"]').get_attribute("readonly")
        steps = await f.eval_on_selector_all("#stepList li button .label","els=>els.map(e=>e.textContent.trim())")
        log(f"director reads the DeepDive: customer='{value}' · read-only={readonly is not None} · {len(steps)} steps")
        assert value, "the Director must see the submitted content"
        await f.locator("#stepList li button", has_text="Documents").click()
        await f.wait_for_selector(".doc-table", timeout=10000)
        docs = await f.locator(".doc-table tbody tr").count()
        log(f"director sees {docs} document row(s) in this version")

        # one gate only: confirm the session, AI opens immediately
        await pg.locator(".trail-card", has_text="AI Analysis").click()
        await pg.click("button:has-text('Confirm the DeepDive session')")
        await expect(pg.locator(".analysis").first).to_be_visible(timeout=10000)
        cards = await pg.eval_on_selector_all(".analysis","els=>els.map(e=>e.innerText.split('\\n').slice(0,2).join(' — '))")
        for c in cards: log("  ", c[:60])
        status = await pg.locator(".opp-head .badge").first.inner_text()
        log("opportunity status after confirming:", status)
        assert status == "Ready for AI", status
        assert any("Ready for AI" in c for c in cards), cards
        await pg.locator(".analysis", has_text="Early Analysis").locator("button").click()
        await expect(pg.locator(".finding").first).to_be_visible(timeout=20000)
        log("analysis ran straight after the session — no review transitions needed")
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
