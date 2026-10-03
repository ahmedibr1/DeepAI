import asyncio
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={"width":1600,"height":1000})).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
        await pg.goto(FILE); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.evaluate("localStorage.setItem('pp-demo-seen','1')"); await pg.reload()

        # Presales Account can still create an opportunity
        await pg.fill("#username","m.rabie"); await pg.fill("#password",PW); await pg.click("button[type=submit]")
        await pg.wait_for_selector(".sidenav .me b", timeout=15000)
        await pg.goto(pg.url.split("#")[0]+"#/opportunities/new")
        await pg.fill("#num","OP-2026-777001"); await pg.fill("#acc","ACME Industrial")
        await pg.fill("#title","New build test"); await pg.select_option("#type","RFI")
        await pg.click("button[type=submit]")
        await pg.wait_for_url(lambda u: "/deepdive" in u, timeout=15000)
        log("Presales Account creates an opportunity:", pg.url.split("#")[-1][:46])

        # Admin: no Create opportunity in the menu
        await pg.click(".user-chip"); await pg.click(".user-dropdown button"); await pg.wait_for_selector("#username")
        await pg.fill("#username","admin"); await pg.fill("#password",PW); await pg.click("button[type=submit]")
        await pg.wait_for_selector(".sidenav .me b", timeout=15000)
        nav = await pg.eval_on_selector_all(".sidenav .nav-link","els=>els.map(e=>e.textContent.trim())")
        assert "Create opportunity" not in nav, nav
        log("admin menu:", nav)

        # AI Configuration: four sections, editable, saves
        await pg.click(".sidenav a[href*='ai-prompt']")
        await expect(pg.locator("h1")).to_have_text("AI Configuration", timeout=10000)
        await pg.wait_for_selector(".tabs button", timeout=10000)
        tabs = await pg.eval_on_selector_all(".tabs button","els=>els.map(e=>e.textContent.trim())")
        assert tabs == ["System prompt","Generation","Retrieval","Fine-tuning"], tabs
        await pg.click(".tabs button:has-text('Generation')")
        await pg.fill("#temp","0.35")
        await pg.click(".tabs button:has-text('Fine-tuning')")
        await pg.fill("#base","Qwen3-27B"); await pg.fill("#adapter","presales-lora-v3")
        await pg.select_option("#ftstatus","training")
        await pg.fill("#dataset","120 reviewed DeepDives")
        await pg.click("button:has-text('Save configuration')")
        await pg.wait_for_timeout(800)
        saved = await pg.evaluate("""async()=>{const r=await (await fetch('/api/admin/ai-settings')).json();
            return {temp:r.generation.temperature, ft:r.fine_tuning};}""")
        assert saved["temp"] == 0.35 and saved["ft"]["adapter"] == "presales-lora-v3" and saved["ft"]["status"] == "training", saved
        log("saved:", saved)
        await pg.screenshot(path="aicfg.png", full_page=True)

        # a Director can read it but not edit
        await pg.click(".user-chip"); await pg.click(".user-dropdown button"); await pg.wait_for_selector("#username")
        await pg.fill("#username","a.aloulah"); await pg.fill("#password",PW); await pg.click("button[type=submit]")
        await pg.wait_for_selector(".sidenav .me b", timeout=15000)
        await pg.click(".sidenav a[href*='ai-prompt']")
        await expect(pg.locator(".prompt-box")).to_be_visible(timeout=10000)
        assert await pg.locator(".prompt-box").get_attribute("readonly") is not None
        assert await pg.locator("button:has-text('Save configuration')").count() == 0
        log("director sees it read-only")
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
