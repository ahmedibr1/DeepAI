import asyncio
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'; PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={"width":1700,"height":1000})).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
        pg.on("console", lambda m: m.type=="error" and errs.append(m.text[:150]))
        await pg.goto(FILE); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.evaluate("localStorage.setItem('pp-demo-seen','1')"); await pg.reload()
        await pg.fill("#username","admin"); await pg.fill("#password",PW); await pg.click("button[type=submit]")
        await pg.wait_for_selector(".sidenav .me b", timeout=15000)

        await pg.click(".sidenav a[href*='admin/users']")
        await pg.wait_for_selector("table.data tbody tr", timeout=10000)
        heads = await pg.eval_on_selector_all("table.data thead th","els=>els.map(e=>e.textContent.trim())")
        assert heads[:6] == ["Name","Username","Role","Team","Status","Last sign-in"], heads
        rows = await pg.eval_on_selector_all("table.data tbody tr",
            "els=>els.map(tr=>[...tr.children].slice(0,4).map(td=>td.textContent.trim()))")
        # the name cell also carries the email underneath
        people = {r[0].split("@")[0].rstrip(" ")[:60]: r[2] for r in rows}
        def role_of(name):
            return next((v for k, v in people.items() if k.startswith(name)), None)
        for name, role in [("Abdulrahman Alhaqbani","Presales GM"), ("Ahmed AlOulah","Presales Director"),
                           ("Mohammed Alasadi","Presales Manager"), ("Mohammed Rabie","Presales Lead"),
                           ("Feras Mulla","Sales GM"), ("Mohammed Hani","Sales Director"),
                           ("Mahmoud AlGendi","Account Manager")]:
            assert role_of(name) == role, (name, role_of(name))
        leads = [n.split("e.com")[0] for n, r in people.items() if r == "Presales Lead"]
        ams = [n for n, r in people.items() if r == "Account Manager"]
        log(f"{len(rows)} users · {len(leads)} presales leads · {len(ams)} account managers")
        log("leads:", leads)
        await pg.screenshot(path="org_users.png", full_page=True)

        await pg.click(".sidenav a[href*='portfolios']")
        await pg.wait_for_selector("table.data tbody tr", timeout=10000)
        portfolio = await pg.eval_on_selector_all("table.data tbody tr",
            "els=>els.map(tr=>[...tr.children].map(td=>td.textContent.trim()))")
        log("portfolio row:", portfolio[0][:5])
        assert portfolio[0][0] == "Portfolio 4" and "Feras Mulla" in portfolio[0][1], portfolio[0]
        assert "Ahmed AlOulah" in portfolio[0][2] and "Mohammed Alasadi" in portfolio[0][3], portfolio[0]
        verticals = [r for r in portfolio if r[0] in ("Housing & Construction Services","Mega Accounts","Education")]
        assert len(verticals) == 3, [r[0] for r in portfolio]
        for row in verticals:
            log(f"vertical {row[0]} — Sales Director {row[1]} — AMs: {row[2][:70]}")
        housing = next(r for r in verticals if r[0].startswith("Housing"))
        assert housing[1] == "Mohammed Hani" and "Mahmoud AlGendi" in housing[2] and "Zaid Alarfaj" in housing[2]
        education = next(r for r in verticals if r[0] == "Education")
        assert education[1] == "Talal Al-Hammouri", education
        await pg.screenshot(path="org_portfolio.png", full_page=True)
        print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
