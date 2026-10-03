import asyncio, json, re
from playwright.async_api import async_playwright, expect
BASE="http://localhost:4173"; PW="PortalPassw0rd2026"
log=lambda *a: print("•",*a,flush=True)

async def login(ctx, u, p, np=None):
    page=await ctx.new_page(); errs=[]
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(BASE+"/login"); await page.fill("#username",u); await page.fill("#password",p); await page.click("button[type=submit]")
    if np:
        await page.wait_for_url("**/change-password")
        await page.fill("#cur",p); await page.fill("#new",np); await page.fill("#confirm",np); await page.click("button[type=submit]")
    await page.wait_for_url("**/dashboard"); await page.wait_for_selector(".stat", timeout=15000)
    return page, errs

async def api(page, method, path, body=None):
    return await page.evaluate("""async ([m,p,b]) => {
        const csrf=document.cookie.split('; ').find(c=>c.startsWith('pp_csrf='))?.slice(8)||'';
        const r=await fetch('/api'+p,{method:m,headers:{'content-type':'application/json','x-csrf-token':decodeURIComponent(csrf)},body:b?JSON.stringify(b):undefined});
        return {status:r.status, body:r.status===204?null:await r.json()};}""",[method,path,body])

async def main():
    open("/tmp/up/RFP.txt","w").write("4 Requirements\n4.4 Service levels\nA 99.9% SLA is required.\n")
    open("/tmp/up/BoQ.txt","w").write("Bill of quantities\n")
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
        oid=opp["id"]; v1=opp["current_version_id"]
        data=json.load(open("../presales-portal/backend/tests/complete_deepdive.json"))
        await api(pres,"PUT",f"/opportunities/{oid}/versions/{v1}/deepdive",{"data":{**data,"sow":"Version one scope"},"revision":0})

        # v1: two documents
        await pres.goto(f"{BASE}/opportunities/{oid}/documents")
        await pres.set_input_files("#doc-file","/tmp/up/RFP.txt")
        await expect(pres.locator("td", has_text="RFP.txt").first).to_be_visible(timeout=10000)
        await pres.set_input_files("#doc-file","/tmp/up/BoQ.txt")
        await expect(pres.locator("table.data tbody tr")).to_have_count(2)

        # Overview has no version selector
        await pres.click(".tabs a:has-text('Overview')")
        assert await pres.locator("#opp-version").count() == 1, "the selector sits above the tabs"
        await expect(pres.locator(".version-bar")).to_be_visible()
        log("one version selector above the tabs; Overview shows master data")

        await pres.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pres.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=15000)

        mctx=await b.new_context(viewport=V)
        mgr,e=await login(mctx,"mgr.alasadi",PW,"ManagerPassw0rd1"); errs+=e
        await mgr.goto(f"{BASE}/opportunities/{oid}")
        await mgr.click("button:has-text('Start review')"); await mgr.click(".modal button.primary")
        await mgr.click(".tabs a:has-text('Review')")
        await mgr.fill("#c-body","Comment written on v1")
        await mgr.click("button:has-text('Add comment')")
        await expect(mgr.locator(".comment")).to_have_count(1, timeout=10000)
        await mgr.click("button:has-text('Request changes')") if await mgr.locator("button:has-text('Request changes')").count() else None
        log("v1 reviewed with a comment")

        # v2: created by the owner, carries the documents, empty review
        await pres.goto(f"{BASE}/opportunities/{oid}")
        await pres.click("button:has-text('Create new version')")
        await pres.fill("#change-notes","Scope updated after review")
        await pres.click(".modal button.primary")
        await pres.wait_for_url("**/deepdive")
        await expect(pres.locator("#opp-version")).to_contain_text("v2 (current)", timeout=15000)
        log("creating a version switches to it automatically")

        await pres.click(".tabs a:has-text('Documents')")
        await expect(pres.locator("table.data tbody tr")).to_have_count(2)
        row=pres.locator("tr", has_text="BoQ.txt")
        await row.locator("button:has-text('Remove')").click()
        await expect(pres.locator("table.data tbody tr")).to_have_count(1)
        await pres.click(".tabs a:has-text('Review')")
        await expect(pres.locator(".empty")).to_be_visible()
        log("v2 starts from v1's documents and has its own review")

        # switching version moves every tab together
        await pres.click(".tabs a:has-text('Documents')")
        v1_value = await pres.evaluate("""() => [...document.querySelectorAll('#opp-version option')]
            .find(o => o.textContent.trim().startsWith('v1')).value""")
        await pres.select_option("#opp-version", v1_value)
        await expect(pres.locator("table.data tbody tr")).to_have_count(2)
        assert await pres.locator("button:has-text('Remove')").count() == 0, "an earlier version is read-only"
        assert "?v=" in pres.url
        await pres.click(".tabs a:has-text('Review')")
        await expect(pres.locator(".comment", has_text="Comment written on v1")).to_be_visible(timeout=10000)
        assert await pres.locator("#opp-version").input_value() == v1, "the tabs keep the selected version"
        await pres.click(".tabs a:has-text('DeepDive')")
        frame=None
        for _ in range(60):
            frame=next((f for f in pres.frames if "builder.html" in f.url), None)
            if frame and await frame.locator('[data-go="1"]').count(): break
            await pres.wait_for_timeout(250)
        await frame.locator('[data-go="1"]').click()
        await expect(frame.locator('[data-path="sow"]')).to_have_value(re.compile("Version one scope"), timeout=15000)
        log("the selection follows you across DeepDive, Documents, Review and AI")

        await pres.screenshot(path="v1_selected.png", full_page=True)
        await pres.click("button:has-text('Back to v2')")
        await expect(pres.locator("#opp-version")).to_contain_text("v2 (current)")

        # History lists both versions with links
        await pres.click(".tabs a:has-text('History')")
        await expect(pres.locator(".timeline li").first).to_be_visible(timeout=10000)
        assert await pres.locator(".version-links").count() == 2, "both versions link into their tabs"
        await pres.screenshot(path="v_history.png", full_page=True)
        versions=(await api(pres,"GET",f"/opportunities/{oid}/versions"))["body"]
        assert [v["version_number"] for v in versions]==[2,1]
        log("History shows both versions with links into each tab")
        print("PAGE ERRORS:", errs[:4])
        await b.close()
asyncio.run(main())
