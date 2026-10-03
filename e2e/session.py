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
        # a session is confirmed against a submitted version
        await pg.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pg.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=15000)
        await pg.click(".tabs a:has-text('DeepDive')")
        await expect(pg.locator(".trail-card", has_text="AI Analysis")).to_contain_text(
            "Locked until the DeepDive session", timeout=10000)
        # the builder grows with its content: one scrollbar, not two
        await pg.wait_for_timeout(2500)
        h = await pg.evaluate("() => Math.round(document.querySelector('.builder-frame').getBoundingClientRect().height)")
        inner = await pg.frames[-1].evaluate("() => Math.round(document.documentElement.scrollHeight)")
        log(f"builder frame {h}px for content {inner}px — no inner scrollbar: {h >= inner - 30}")
        assert h >= inner - 30, (h, inner)
        docs_state = await pg.frames[-1].eval_on_selector_all("#stepList li button .state","els=>els.map(e=>e.textContent.trim())")
        assert "In this version" not in docs_state, docs_state
        log("documents step shows:", docs_state[7])

        await pg.locator(".trail-card", has_text="AI Analysis").click()
        await expect(pg.locator(".session-gate")).to_be_visible(timeout=10000)
        assert await pg.locator("button:has-text('Confirm the DeepDive session')").count() == 0, "the Lead cannot confirm"
        log("Presales Lead sees the gate, without the confirm button")

        await login(pg,"m.alasadi"); await open_opp(pg)
        await pg.click(".tabs a:has-text('DeepDive')")
        await pg.locator(".trail-card", has_text="AI Analysis").click()
        await pg.click("button:has-text('Confirm the DeepDive session')")
        await expect(pg.locator(".analysis").first).to_be_visible(timeout=10000)
        log("Presales Manager confirmed the session; the analyses opened")
        await pg.screenshot(path="session.png", full_page=True)
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
