import asyncio
from playwright.async_api import async_playwright
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={"width":1500,"height":950})).new_page()
        await pg.goto(FILE); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.evaluate("localStorage.setItem('pp-demo-seen','1')"); await pg.reload()
        for u in ("a.aloulah","m.alasadi","a.alhaqbani","admin","m.rabie"):
            if await pg.locator(".user-chip").count():
                await pg.click(".user-chip"); await pg.click(".user-dropdown button"); await pg.wait_for_selector("#username")
            await pg.fill("#username",u); await pg.fill("#password",PW); await pg.click("button[type=submit]")
            await pg.wait_for_selector(".sidenav .me b", timeout=15000)
            await pg.goto(pg.url.split("#")[0]+"#/dashboard"); await pg.wait_for_selector(".stat")
            await pg.wait_for_timeout(400)
            cards = await pg.eval_on_selector_all(".stat","els=>els.map(e=>e.getAttribute('aria-label')||e.querySelector('.l').textContent.trim())")
            role = await pg.locator(".sidenav .me span").inner_text()
            print(f"{u:18} ({role}) -> {cards}")
        await b.close()
asyncio.run(main())
