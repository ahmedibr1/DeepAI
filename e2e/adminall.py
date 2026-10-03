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

        # the union of everything the other roles can reach
        seen = {}
        for u in ("m.rabie","m.alasadi","a.aloulah","a.alhaqbani","admin"):
            if await pg.locator(".user-chip").count():
                await pg.click(".user-chip"); await pg.click(".user-dropdown button"); await pg.wait_for_selector("#username")
            await pg.fill("#username",u); await pg.fill("#password",PW); await pg.click("button[type=submit]")
            await pg.wait_for_selector(".sidenav .me b", timeout=15000)
            seen[u] = await pg.eval_on_selector_all(".sidenav .nav-link","els=>els.map(e=>e.textContent.trim())")
        others = {item for user, items in seen.items() if user != "admin" for item in items}
        # creating and submitting stay with the Presales Account who owns the work
        missing = others - set(seen["admin"]) - {"Create opportunity"}
        assert not missing, f"the Admin is missing: {missing}"
        log("admin menu:", seen["admin"])
        log("covers every other role's menu:", sorted(others))

        # and the Admin can actually use them
        caps = await pg.evaluate("""async()=>{const l=await (await fetch('/api/opportunities')).json();
            const d=await (await fetch('/api/opportunities/'+l.items[0].id)).json();
            return {edit:d.can_edit, version:d.can_create_version, del:d.can_delete, ai:d.can_view_ai,
                    actions:d.actions.map(a=>a.action)};}""")
        log("admin on an opportunity:", caps)
        assert caps["edit"] and caps["version"] and caps["del"] and caps["ai"], caps
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
