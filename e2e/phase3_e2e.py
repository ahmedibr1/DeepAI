import asyncio, json, re
from playwright.async_api import async_playwright, expect
BASE="http://localhost:4173"; PW="PortalPassw0rd2026"
log=lambda *a: print("•",*a,flush=True)
RFP = ("4 Requirements\n4.2 Integration\nThe platform shall integrate with the existing SCADA system over OPC-UA.\n"
       "4.3 Data residency\nAll environmental data shall remain inside the Kingdom.\n"
       "4.4 Service levels\nThe supplier shall meet a 99.9% availability SLA with 24/7 support.\n"
       "5 Commercial\nThe ceiling budget for this scope is SAR 28,000,000.\n")

async def login(ctx, username, password, new_password=None):
    page = await ctx.new_page(); errs=[]
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(BASE+"/login")
    await page.fill("#username", username); await page.fill("#password", password); await page.click("button[type=submit]")
    if new_password:
        await page.wait_for_url("**/change-password")
        await page.fill("#cur", password); await page.fill("#new", new_password); await page.fill("#confirm", new_password)
        await page.click("button[type=submit]")
    await page.wait_for_url("**/dashboard")
    return page, errs

async def api(page, method, path, body=None):
    return await page.evaluate("""async ([m,p,b]) => {
        const csrf=document.cookie.split('; ').find(c=>c.startsWith('pp_csrf='))?.slice(8)||'';
        const r=await fetch('/api'+p,{method:m,headers:{'content-type':'application/json','x-csrf-token':decodeURIComponent(csrf)},body:b?JSON.stringify(b):undefined});
        return {status:r.status, body:r.status===204?null:await r.json()};}""",[method,path,body])

async def main():
    open("/tmp/up/RFP.txt","w").write(RFP)
    async with async_playwright() as p:
        b=await p.chromium.launch(); V={"width":1440,"height":1000}; errs_all=[]
        actx=await b.new_context(viewport=V)
        admin,e=await login(actx,"admin","BootstrapAdmin2026","AdminPassw0rd2026"); errs_all+=e
        for u in [("director.rabie","Ahmed AlOulah","portfolio_director"),("a.alhaqbani","Abdulrahman Alhaqbani","presales_gm")]:
            await api(admin,"POST","/admin/users",{"username":u[0],"full_name":u[1],"role":u[2],"temporary_password":PW})
        users=(await api(admin,"GET","/admin/users"))["body"]
        did=next(u["id"] for u in users if u["username"]=="director.rabie")
        await api(admin,"POST","/admin/teams",{"name":"Giga Projects","director_id":did})
        tid=(await api(admin,"GET","/admin/teams"))["body"][0]["id"]
        await api(admin,"POST","/admin/users",{"username":"m.rabie","full_name":"Mohammed Rabie","role":"presales_account","team_id":tid,"temporary_password":PW})

        pctx=await b.new_context(viewport=V)
        pres,e=await login(pctx,"m.rabie",PW,"PresalesPassw0rd1"); errs_all+=e
        opp=(await api(pres,"POST","/opportunities",{"opportunity_number":"OP-2026-159388","title":"Environment and Sustainability Solution","account_name":"Red Sea Global"}))["body"]
        oid=opp["id"]
        data=json.load(open("../presales-portal/backend/tests/complete_deepdive.json"))
        await api(pres,"PUT",f"/opportunities/{oid}/versions/{opp['current_version_id']}/deepdive",{"data":data,"revision":0})
        await pres.goto(f"{BASE}/opportunities/{oid}/documents")
        await pres.select_option("#doc-category","rfp"); await pres.set_input_files("#doc-file","/tmp/up/RFP.txt")
        await expect(pres.locator("td", has_text="RFP.txt").first).to_be_visible(timeout=10000)
        await pres.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pres.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=10000)
        log("opportunity submitted with the RFP attached")

        dctx=await b.new_context(viewport=V)
        director,e=await login(dctx,"director.rabie",PW,"DirectorPassw0rd1"); errs_all+=e
        await director.goto(f"{BASE}/opportunities/{oid}")
        await director.click("button:has-text('Start review')"); await director.click(".modal button.primary")
        await director.click(".tabs a:has-text('Review')")
        await director.select_option("#c-type","missing_information")
        await director.fill("#c-body","Confirm the SLA the customer expects for managed services.")
        await director.click("button:has-text('Add comment')")
        await expect(director.locator(".comment")).to_have_count(1, timeout=10000)
        await director.click(".tabs a:has-text('Overview')")
        await director.click("button:has-text('Ready for AI analysis')"); await director.click(".modal button.primary")
        await expect(director.locator(".opp-head .badge").first).to_have_text("Ready for AI")

        # presales may not trigger
        await pres.goto(f"{BASE}/opportunities/{oid}/ai")
        assert await pres.locator("button:has-text('Run AI analysis')").count() == 0, "owner cannot trigger AI"
        log("owner sees the AI tab but cannot start a run")

        await director.click(".tabs a:has-text('AI recommendations')")
        await director.click("button:has-text('Run AI analysis')")
        # The run can finish before the page refreshes, so accept either state here.
        await expect(director.locator(".opp-head .badge").first).to_have_text(re.compile("AI Analysis|AI Recommendations"), timeout=20000)
        log("analysis queued; opportunity moved out of Ready for AI")
        await expect(director.locator(".readiness-head .badge")).to_be_visible(timeout=60000)
        await director.screenshot(path="p3_analysis.png", full_page=True)
        areas = await director.locator(".area").count()
        findings = await director.locator(".comment").count()
        assert areas == 8, areas
        assert findings >= 1, findings
        log(f"{areas} readiness areas, {findings} findings")

        await director.click(".cite >> nth=0")
        await expect(director.locator(".source-text")).to_contain_text(re.compile("SCADA|SLA|Kingdom|budget"))
        await director.screenshot(path="p3_citation.png")
        await director.click(".modal button.primary")
        log("citation opens the exact source text")

        await expect(director.locator("table.data tbody tr").first).to_be_visible(timeout=15000)
        await director.screenshot(path="p3_recommendations.png", full_page=True)
        detail=(await api(director,"GET",f"/opportunities/{oid}/ai/runs"))["body"]
        run=(await api(director,"GET",f"/opportunities/{oid}/ai/runs/{detail[0]['id']}"))["body"]
        assert run["status"]=="succeeded"
        assert all(f["citations"] for f in run["findings"] if f["evidence_class"]=="fact")
        assert run["input_manifest"]["documents"][0]["file_name"]=="RFP.txt"
        log("every fact carries a citation; inputs recorded in the manifest")

        opp_now=(await api(director,"GET",f"/opportunities/{oid}"))["body"]
        assert opp_now["status"]=="ai_recommendations" and opp_now["ai_readiness"]
        await pres.goto(f"{BASE}/opportunities/{oid}/ai")
        await expect(pres.locator(".readiness-head")).to_be_visible(timeout=15000)
        log("owner can now read the results")

        gctx=await b.new_context(viewport=V)
        gm,e=await login(gctx,"a.alhaqbani",PW,"GmPassw0rd2026x"); errs_all+=e
        await gm.goto(f"{BASE}/opportunities/{oid}/ai")
        await expect(gm.locator(".readiness-head")).to_be_visible(timeout=15000)
        assert await gm.locator("button:has-text('Run AI analysis')").count()==0
        await gm.screenshot(path="p3_gm.png", full_page=True)

        audit=(await api(admin,"GET","/admin/audit-logs?page_size=200"))["body"]
        acts=sorted({a["action"] for a in audit["items"]})
        assert "ai.requested" in acts, acts
        log("audit actions:", acts)
        print("PAGE ERRORS:", errs_all[:4])
        await b.close()
asyncio.run(main())
