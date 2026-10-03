import asyncio
from playwright.async_api import async_playwright
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={"width":1500,"height":950})).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
        await pg.goto(FILE); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.evaluate("localStorage.setItem('pp-demo-seen','1')"); await pg.reload()
        await pg.fill("#username","m.rabie"); await pg.fill("#password","Demo2026pass"); await pg.click("button[type=submit]")
        await pg.wait_for_selector(".sidenav .me b", timeout=15000)
        await pg.goto(pg.url.split("#")[0]+"#/opportunities"); await pg.wait_for_selector(".opp-card")
        await pg.locator(".opp-card").first.click()
        await pg.click(".tabs a:has-text('DeepDive')")
        await pg.wait_for_timeout(3000)
        f = pg.frames[-1]
        info = await f.evaluate("""() => {const bar=document.querySelector('.bar');const panel=document.querySelector('#panel');
            const b=bar.getBoundingClientRect(); const p=panel.getBoundingClientRect();
            return {pos:getComputedStyle(bar).position, gap: Math.round(b.top - p.bottom),
                    doc: Math.round(document.documentElement.scrollHeight)};}""")
        print("bar:", info)
        assert info["pos"] == "static" and info["gap"] < 120, info
        h = await pg.evaluate("() => Math.round(document.querySelector('.builder-frame').getBoundingClientRect().height)")
        print("frame height:", h, "| doc height:", info["doc"])
        await pg.screenshot(path="bar.png", full_page=True)
        print("errors:", errs[:3])
        await b.close()
asyncio.run(main())
