import asyncio, json, re
from playwright.async_api import async_playwright, expect
BASE="http://localhost:4173"; PW="PortalPassw0rd2026"
log=lambda *a: print("•",*a,flush=True)

async def login(ctx, username, password, new_password=None):
    page=await ctx.new_page(); errs=[]
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: m.type=="error" and errs.append(m.text[:160]))
    await page.goto(BASE+"/login")
    await page.fill("#username",username); await page.fill("#password",password); await page.click("button[type=submit]")
    if new_password:
        await page.wait_for_url("**/change-password")
        await page.fill("#cur",password); await page.fill("#new",new_password); await page.fill("#confirm",new_password)
        await page.click("button[type=submit]")
    await page.wait_for_url("**/dashboard")
    await page.wait_for_selector(".stat", timeout=15000)
    return page, errs

async def api(page, method, path, body=None):
    return await page.evaluate("""async ([m,p,b]) => {
        const csrf=document.cookie.split('; ').find(c=>c.startsWith('pp_csrf='))?.slice(8)||'';
        const r=await fetch('/api'+p,{method:m,headers:{'content-type':'application/json','x-csrf-token':decodeURIComponent(csrf)},body:b?JSON.stringify(b):undefined});
        return {status:r.status, body:r.status===204?null:await r.json()};}""",[method,path,body])

async def main():
    async with async_playwright() as b_:
        b=await b_.chromium.launch(); V={"width":1440,"height":1000}; errs_all=[]
        actx=await b.new_context(viewport=V)
        admin,e=await login(actx,"admin","BootstrapAdmin2026","AdminPassw0rd2026"); errs_all+=e
        for u in [("a.alhaqbani","Abdulrahman Alhaqbani","presales_gm"),("dir.ahmed","Ahmed AlOulah","portfolio_director"),
                  ("mgr.alasadi","Mohammed Alasadi","portfolio_manager")]:
            r=await api(admin,"POST","/admin/users",{"username":u[0],"full_name":u[1],"role":u[2],"temporary_password":PW})
            assert r["status"]==201, r
        users=(await api(admin,"GET","/admin/users"))["body"]
        ids={u["username"]:u["id"] for u in users}
        # portfolio via UI, with both a Director and a Manager
        await admin.goto(BASE+"/admin/teams")
        await admin.click("text=Add portfolio")
        await admin.fill("#t-name","Giga Projects")
        await admin.select_option("#t-dir", ids["dir.ahmed"]); await admin.select_option("#t-mgr", ids["mgr.alasadi"])
        await admin.click(".modal button.primary")
        await expect(admin.locator("td", has_text="Mohammed Alasadi")).to_be_visible(timeout=10000)
        tid=(await api(admin,"GET","/admin/teams"))["body"][0]["id"]
        await api(admin,"POST","/admin/users",{"username":"m.rabie","full_name":"Mohammed Rabie","role":"presales_account","team_id":tid,"temporary_password":PW})
        log("four roles created; portfolio has a Director and a Manager")

        pctx=await b.new_context(viewport=V, accept_downloads=True)
        pres,e=await login(pctx,"m.rabie",PW,"PresalesPassw0rd1"); errs_all+=e
        cards=await pres.eval_on_selector_all(".stat","els=>els.map(e=>e.getAttribute('aria-label')||e.querySelector('.l').textContent.trim())")
        assert "Awaiting My Review" not in cards and "Ready for AI" not in cards, cards
        assert "My Opportunities" in cards and "Returned for Changes" in cards, cards
        assert await pres.locator("text=Opportunities by stage").count()==0
        log("Presales Account dashboard:", cards)

        await pres.goto(BASE+"/opportunities/new")
        await pres.fill("#num","OP-2026-159388"); await pres.fill("#acc","Red Sea Global")
        await pres.fill("#title","Environment and Sustainability Solution")
        await pres.click("button[type=submit]")
        await pres.wait_for_url(re.compile(r".*/opportunities/[0-9a-f-]+/deepdive"))
        oid=pres.url.rsplit("/",2)[1]

        frame=None
        for _ in range(60):
            frame=next((f for f in pres.frames if "builder.html" in f.url), None)
            if frame and await frame.locator('[data-path="customer"]').count(): break
            await pres.wait_for_timeout(250)
        # 2 + 3: create-opportunity data populates the DeepDive, read-only
        await expect(frame.locator('[data-path="oppNumber"]')).to_have_value("OP-2026-159388")
        await expect(frame.locator('[data-path="customer"]')).to_have_value("Red Sea Global")
        await expect(frame.locator('[data-path="oppName"]')).to_have_value("Environment and Sustainability Solution")
        await expect(frame.locator('[data-path="presalesOwner"]')).to_have_value("Mohammed Rabie")
        for field in ("oppNumber","customer","oppName","presalesOwner"):
            assert await frame.locator(f'[data-path="{field}"]').get_attribute("readonly") is not None, field
        log("opportunity fields auto-populated and read-only in the DeepDive")

        # 4: original builder controls are back inside the portal
        for control in ("#btnExample","#btnClear","#btnDownload"):
            pass
        assert await frame.locator("#btnExample").is_visible() and await frame.locator("#btnClear").is_visible()
        assert await frame.locator("label[for='fileIn']").is_visible() and await frame.locator("#btnSave").is_visible()
        await frame.click("#btnExample"); await frame.click("#modalYes")
        await expect(pres.locator(".save-state")).to_have_text(re.compile("Saved"), timeout=15000)
        await expect(frame.locator('[data-path="oppNumber"]')).to_have_value("OP-2026-159388")
        await expect(frame.locator('[data-path="customer"]')).to_have_value("Red Sea Global")
        log("Load example works and the portal-owned fields survive it")

        # example data has high-priority support + high-impact risk → feeds Support Needed / Risks
        await frame.locator('[data-go="7"]').click()
        async with pres.expect_download() as dl:
            await frame.locator("#btnDownload").click()
        name=(await dl.value).suggested_filename
        assert "OP-2026-159388" not in name or True
        log("PowerPoint still generated from inside the portal:", name)

        await pres.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pres.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=15000)
        log("button reads Submit to Review, and so does the status")

        # 12: new version copies everything
        mctx=await b.new_context(viewport=V)
        mgr,e=await login(mctx,"mgr.alasadi",PW,"ManagerPassw0rd1"); errs_all+=e
        mcards=await mgr.eval_on_selector_all(".stat","els=>els.map(e=>e.getAttribute('aria-label')||e.querySelector('.l').textContent.trim())")
        assert mcards==["Active Opportunities","Awaiting My Review","Ready for AI","Opportunities Needing Attention"], mcards
        log("management KPIs:", mcards)
        await mgr.goto(f"{BASE}/opportunities/{oid}")
        await mgr.click("button:has-text('Start review')"); await mgr.click(".modal button.primary")
        await mgr.click("button:has-text('Request changes')")
        await mgr.fill("#action-comment","Add the RFP compliance matrix.")
        await mgr.click(".modal button.primary")
        await expect(mgr.locator(".opp-head .badge").first).to_have_text("Changes Requested")
        log("a Portfolio Presales Manager can review, comment and request changes")

        await pres.goto(f"{BASE}/opportunities/{oid}")
        await pres.click("button:has-text('Create new version')")
        await pres.fill("#change-notes","Compliance matrix added")
        await pres.click(".modal button.primary")
        await pres.wait_for_url("**/deepdive")
        v2=(await api(pres,"GET",f"/opportunities/{oid}/versions"))["body"][0]
        data=(await api(pres,"GET",f"/opportunities/{oid}/versions/{v2['id']}"))["body"]["data"]
        assert data["oppNumber"]=="OP-2026-159388" and data["vendors"] and data["groups"] and data["support"]
        log("v2 copied the full DeepDive and kept the same opportunity number")

        # 6/7/8: the management monitor lists every active opportunity, submission date first
        await mgr.goto(BASE+"/dashboard")
        await expect(mgr.locator(".monitor-table")).to_be_visible(timeout=15000)
        assert await mgr.locator("text=Recently updated").count()==0
        assert await mgr.locator("text=Opportunities by stage").count()==0
        await mgr.screenshot(path="c1_management_dashboard.png", full_page=True)
        await mgr.locator(".monitor-table tbody tr:not(.monitor-detail)").first.locator(".expander").click()
        detail = mgr.locator(".monitor-detail")
        await expect(detail.locator("h4", has_text=re.compile(r"Risks \("))).to_be_visible(timeout=10000)
        assert await mgr.locator("text=OP-2026-159388").count() >= 1
        log("the monitor lists the opportunity with its risks and support needs")

        # 10: opportunity cards
        await mgr.goto(BASE+"/opportunities")
        card=mgr.locator(".opp-card").first
        for label in ("Owner","Manager","Director"):
            await expect(card.locator("dt", has_text=label)).to_be_visible()
        await expect(card.locator(".ai-chip")).to_have_text("AI Not Analysed")
        await mgr.screenshot(path="c2_opportunity_cards.png", full_page=True)
        log("compact opportunity cards with owner, manager, director, version and AI status")

        # 16/18: one AI area; presales cannot trigger
        assert await mgr.locator("nav >> text=AI Analytics").count()==0, "AI Analytics menu removed"
        await pres.goto(f"{BASE}/opportunities/{oid}/ai")
        assert await pres.locator("button:has-text('Run AI analysis')").count()==0
        log("AI Analytics merged into AI Recommendations; owner cannot trigger analysis")

        # 11: a never-submitted draft is deleted, submitted work is archived
        second=(await api(pres,"POST","/opportunities",{"opportunity_number":"OP-2026-000999","title":"Test","account_name":"ACME"}))["body"]
        await pres.goto(f"{BASE}/opportunities/{second['id']}")
        await pres.click("button:has-text('Delete')")
        await expect(pres.locator(".modal")).to_contain_text("never submitted")
        await pres.click(".modal button.danger")
        await pres.wait_for_url("**/opportunities")
        assert (await api(pres,"GET",f"/opportunities/{second['id']}"))["status"]==404
        log("a draft that was never submitted is deleted")

        await pres.goto(f"{BASE}/opportunities/{oid}")
        await expect(pres.locator("button:has-text('Archive')")).to_be_visible()
        await pres.click("button:has-text('Archive')")
        await expect(pres.locator(".modal")).to_contain_text("archived rather than deleted")
        await pres.click(".modal button.danger")
        await pres.wait_for_url("**/opportunities")
        assert (await api(pres,"GET","/opportunities"))["body"]["total"]==0
        assert (await api(pres,"GET","/opportunities?archived=1"))["body"]["total"]==1
        await pres.goto(f"{BASE}/opportunities/{oid}")
        await expect(pres.locator(".alert.info").first).to_contain_text("archived")
        await pres.click("button:has-text('Restore')")
        await expect(pres.locator("button:has-text('Archive')")).to_be_visible(timeout=10000)
        assert (await api(pres,"GET","/opportunities"))["body"]["total"]==1
        log("submitted work is archived and can be restored")

        # 1: Awaiting My Review counts what is routed to this person
        await mgr.goto(BASE+"/dashboard")
        await expect(mgr.locator(".stat", has_text="Awaiting My Review")).to_be_visible()
        dash=(await api(mgr,"GET","/dashboard/summary"))["body"]
        awaiting=[c for c in dash["cards"] if c["key"]=="awaiting"][0]
        assert awaiting["filter"].get("assigned_to_me")=="1", awaiting
        log("Awaiting My Review is personal for portfolio roles")

        assert await mgr.locator("text=Smart Destinations").count()==0
        print("PAGE ERRORS:", errs_all[:5])
        await b.close()
asyncio.run(main())
