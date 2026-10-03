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
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={"width":1500,"height":950})).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
        await pg.goto(FILE); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.evaluate("localStorage.setItem('pp-demo-seen','1')"); await pg.reload()

        await login(pg,"m.rabie"); await open_opp(pg)
        await pg.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pg.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=15000)

        await login(pg,"a.aloulah"); await open_opp(pg)
        await pg.click(".tabs a:has-text('DeepDive')")
        await pg.locator(".trail-card", has_text="AI Analysis").click()
        await pg.click("button:has-text('Confirm the DeepDive session')")
        await expect(pg.locator(".analysis").first).to_be_visible(timeout=10000)
        await pg.locator(".analysis", has_text="Early Analysis").locator("button").click()
        await expect(pg.locator(".finding").first).to_be_visible(timeout=20000)
        log("v1: session confirmed and the early analysis ran")

        # the owner opens v2 and submits it
        await login(pg,"m.rabie"); await open_opp(pg)
        await pg.click("button:has-text('Create new version')")
        await pg.fill("#change-notes","Updated after the session")
        await pg.click(".modal button.primary")
        await expect(pg.locator("#opp-version")).to_contain_text("v2 (current)", timeout=15000)
        await pg.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pg.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=15000)
        log("v2 submitted")

        # AI is locked again until the session for v2 is confirmed
        await pg.click(".tabs a:has-text('DeepDive')")
        await pg.locator(".trail-card", has_text="AI Analysis").click()
        await expect(pg.locator(".session-gate")).to_be_visible(timeout=10000)
        gate = await pg.locator(".session-gate .section").inner_text()
        assert "v2" in gate, gate
        log("locked again:", gate.strip())
        assert await pg.locator("button:has-text('Confirm the DeepDive session')").count() == 0, "the Lead cannot confirm"

        await login(pg,"m.alasadi"); await open_opp(pg)
        await pg.click(".tabs a:has-text('DeepDive')")
        await pg.locator(".trail-card", has_text="AI Analysis").click()
        await pg.click("button:has-text('Confirm the DeepDive session for v2')")
        await expect(pg.locator(".analysis").first).to_be_visible(timeout=10000)
        states = await pg.eval_on_selector_all(".analysis","els=>els.map(e=>e.innerText.split('\\n').slice(0,2).join(' — '))")
        log("after confirming v2:", [s[:48] for s in states[:2]])
        assert any("Re-analysis Required" in s for s in states), states
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
