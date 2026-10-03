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
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={"width":1600,"height":1000})).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
        pg.on("console", lambda m: m.type=="error" and errs.append(m.text[:150]))
        await pg.goto(FILE); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.evaluate("localStorage.setItem('pp-demo-seen','1')"); await pg.reload()

        await login(pg,"m.rabie"); await open_opp(pg)
        tabs = await pg.eval_on_selector_all(".tabs a","els=>els.map(e=>e.textContent.trim().replace(/ \\(\\d+\\)/,''))")
        assert tabs == ["Overview","DeepDive","Review & Governance","AI Accepted Tracker","Readiness Checklist","Versions"], tabs
        log("sections:", tabs)

        # the version selector belongs to DeepDive only
        assert await pg.locator("#opp-version").count() == 0, "no version bar on Overview"
        await pg.click(".tabs a:has-text('DeepDive')")
        await expect(pg.locator("#opp-version")).to_be_visible(timeout=10000)
        sub = await pg.eval_on_selector_all(".trail-card b","els=>els.map(e=>e.textContent.trim())")
        assert sub == ["DeepDive Builder","AI Analysis"], sub
        log("DeepDive steps:", sub, "— version selector shown here only")
        await pg.click(".tabs a:has-text('Review & Governance')")
        assert await pg.locator("#opp-version").count() == 0, "no version bar on Review & Governance"
        assert await pg.locator("#g-kind").count() == 0, "a Presales Lead does not raise governance items"
        log("Presales Lead sees the governance history, read-only")

        # a Sales Director raises a risk and a support need
        await login(pg,"m.hani"); await open_opp(pg)
        await pg.click(".tabs a:has-text('Review & Governance')")
        await expect(pg.locator("#g-kind")).to_be_visible(timeout=10000)
        await pg.fill("#g-title","Customer may require in-Kingdom hosting certification")
        await pg.fill("#g-detail","Confirm the certificate with the hosting partner before submission.")
        await pg.fill("#g-owner","Solution Architect")
        await pg.click("button:has-text('Add risk')")
        await expect(pg.locator(".timeline li").first).to_be_visible(timeout=10000)
        await pg.select_option("#g-kind","support")
        await pg.fill("#g-title","Pricing approval for the 28M target")
        await pg.fill("#g-owner","VP Sales")
        await pg.click("button:has-text('Add support need')")
        await expect(pg.locator(".timeline li")).to_have_count(2, timeout=10000)
        items = await pg.eval_on_selector_all(".timeline li","els=>els.map(e=>e.innerText.replace(/\\n/g,' | ')[:140])") if False else \
                await pg.eval_on_selector_all(".timeline li","els=>els.map(e=>e.innerText.replace(/\\n/g,' | '))")
        for i in items: log("  ", i[:110])
        await pg.screenshot(path="gov.png", full_page=True)

        # both land in the DeepDive the Presales Lead is working on
        data = await pg.evaluate("""async()=>{const id=location.hash.split('/')[2];
            const d=await (await fetch('/api/opportunities/'+id)).json();
            const v=await (await fetch(`/api/opportunities/${id}/versions/${d.current_version_id}`)).json();
            return {risks:(v.data.riskTech||[]).map(r=>r.risk), support:(v.data.support||[]).map(s=>s.need)};}""")
        assert any("in-Kingdom hosting" in r for r in data["risks"]), data
        assert any("Pricing approval" in s for s in data["support"]), data
        log("landed in the DeepDive:", data["risks"][-1][:48], "|", data["support"][-1][:40])

        # a Presales GM can raise one too
        await login(pg,"a.alhaqbani"); await open_opp(pg)
        await pg.click(".tabs a:has-text('Review & Governance')")
        await expect(pg.locator("#g-kind")).to_be_visible(timeout=10000)
        log("Presales GM can raise items as well")
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
