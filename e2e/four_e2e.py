import asyncio, json, re
from playwright.async_api import async_playwright, expect
BASE="http://localhost:4173"; PW="PortalPassw0rd2026"
log=lambda *a: print("•",*a,flush=True)

async def login(ctx, username, password, new_password=None):
    page=await ctx.new_page(); errs=[]
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(BASE+"/login")
    await page.fill("#username",username); await page.fill("#password",password); await page.click("button[type=submit]")
    if new_password:
        await page.wait_for_url("**/change-password")
        await page.fill("#cur",password); await page.fill("#new",new_password); await page.fill("#confirm",new_password)
        await page.click("button[type=submit]")
    await page.wait_for_url("**/dashboard"); await page.wait_for_selector(".stat", timeout=15000)
    return page, errs

async def api(page, method, path, body=None):
    return await page.evaluate("""async ([m,p,b]) => {
        const csrf=document.cookie.split('; ').find(c=>c.startsWith('pp_csrf='))?.slice(8)||'';
        const r=await fetch('/api'+p,{method:m,headers:{'content-type':'application/json','x-csrf-token':decodeURIComponent(csrf)},body:b?JSON.stringify(b):undefined});
        return {status:r.status, body:r.status===204?null:await r.json()};}""",[method,path,body])

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(); V={"width":1440,"height":1000}; errs=[]
        actx=await b.new_context(viewport=V)
        admin,e=await login(actx,"admin","BootstrapAdmin2026","AdminPassw0rd2026"); errs+=e
        for u in [("a.alhaqbani","Abdulrahman Alhaqbani","presales_gm"),("dir.ahmed","Ahmed AlOulah","portfolio_director"),
                  ("mgr.alasadi","Mohammed Alasadi","portfolio_manager")]:
            await api(admin,"POST","/admin/users",{"username":u[0],"full_name":u[1],"role":u[2],"temporary_password":PW})
        ids={u["username"]:u["id"] for u in (await api(admin,"GET","/admin/users"))["body"]}
        await api(admin,"POST","/admin/teams",{"name":"Giga Projects","director_id":ids["dir.ahmed"],"manager_id":ids["mgr.alasadi"]})
        tid=(await api(admin,"GET","/admin/teams"))["body"][0]["id"]
        await api(admin,"POST","/admin/users",{"username":"m.rabie","full_name":"Mohammed Rabie","role":"presales_account","team_id":tid,"temporary_password":PW})

        pctx=await b.new_context(viewport=V)
        pres,e=await login(pctx,"m.rabie",PW,"PresalesPassw0rd1"); errs+=e
        opp=(await api(pres,"POST","/opportunities",{"opportunity_number":"OP-2026-159388","title":"Environment and Sustainability Solution","account_name":"Red Sea Global"}))["body"]
        oid=opp["id"]
        data=json.load(open("../presales-portal/backend/tests/complete_deepdive.json"))
        await api(pres,"PUT",f"/opportunities/{oid}/versions/{opp['current_version_id']}/deepdive",{"data":data,"revision":0})

        # 1: Active Opportunities in the left panel
        await pres.goto(BASE+"/dashboard")
        await pres.click("nav >> text=Active opportunities")
        await expect(pres.locator("h1")).to_have_text("Active opportunities")
        await expect(pres.locator(".opp-card")).to_have_count(1)
        log("Active opportunities is its own view in the left panel")

        await pres.goto(f"{BASE}/opportunities/{oid}")
        await pres.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pres.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=15000)

        # 2 + 4: a submitted version is locked for everyone; any of the three can open a new one
        dctx=await b.new_context(viewport=V)
        director,e=await login(dctx,"dir.ahmed",PW,"DirectorPassw0rd1"); errs+=e
        await director.goto(f"{BASE}/opportunities/{oid}")
        await expect(director.locator(".alert.info").first).to_contain_text("can no longer be edited")
        await expect(director.locator("button:has-text('Create new version')")).to_be_visible()
        log("the Director sees why it is locked and can open a new version")

        await director.click("button:has-text('Create new version')")
        await director.fill("#change-notes","Director corrections to the scope")
        await director.click(".modal button.primary")
        await director.wait_for_url("**/deepdive")
        await expect(director.locator(".opp-head .badge").first).to_have_text("Draft", timeout=15000)
        frame=None
        for _ in range(60):
            frame=next((f for f in director.frames if "builder.html" in f.url), None)
            if frame and await frame.locator('[data-go="1"]').count(): break
            await director.wait_for_timeout(250)
        await frame.locator('[data-go="1"]').click()          # Scope step
        sow=frame.locator('[data-path="sow"]')
        await expect(sow).to_be_visible(timeout=15000)
        assert await sow.get_attribute("readonly") is None, "the Director can edit the new version"
        await sow.click(); await sow.press("End"); await sow.type("\nDirector addition")
        await expect(director.locator(".save-state")).to_have_text(re.compile("Saved"), timeout=15000)
        log("the Director edited the new version; v1 stayed as reviewed")
        v1=[v for v in (await api(pres,"GET",f"/opportunities/{oid}/versions"))["body"] if v["version_number"]==1][0]
        assert "Director addition" not in (await api(pres,"GET",f"/opportunities/{oid}/versions/{v1['id']}"))["body"]["data"]["sow"]

        # 3: Support Needed and Risks both listed
        mctx=await b.new_context(viewport=V)
        mgr,e=await login(mctx,"mgr.alasadi",PW,"ManagerPassw0rd1"); errs+=e
        await expect(mgr.locator(".monitor-table")).to_be_visible(timeout=15000)
        await mgr.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".expander").click()
        detail = mgr.locator(".monitor-detail")
        await expect(detail.locator("h4", has_text=re.compile(r"Support Needed \("))).to_be_visible(timeout=10000)
        await expect(detail.locator("h4", has_text=re.compile(r"Risks \("))).to_be_visible()
        await mgr.screenshot(path="f1_attention.png", full_page=True)
        row=next(r for r in (await api(mgr,"GET","/dashboard/attention"))["body"]["rows"] if r["attention_count"])
        assert row["support_count"] >= 2 and row["risk_count"] >= 1, row
        log(f"Support Needed ({row['support_count']}) and Risks ({row['risk_count']}) both shown")

        # 1 again: closing moves it out of Active, and it stays under All
        await mgr.goto(f"{BASE}/opportunities/{oid}")
        await mgr.click("button:has-text('Close opportunity')"); await mgr.click(".modal button.primary")
        await expect(mgr.locator(".opp-head .badge").first).to_have_text("Completed", timeout=15000)
        assert (await api(mgr,"GET","/opportunities?active=1"))["body"]["total"]==0
        assert (await api(mgr,"GET","/opportunities"))["body"]["total"]==1
        log("closing removes it from Active, and it remains under All opportunities")
        print("PAGE ERRORS:", errs[:4])
        await b.close()
asyncio.run(main())
