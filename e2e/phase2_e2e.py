import asyncio, re, os
from playwright.async_api import async_playwright, expect
BASE = "http://localhost:4173"
PW = "PortalPassw0rd2026"
log = lambda *a: print("•", *a, flush=True)

async def login(ctx, username, password, new_password=None):
    page = await ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(BASE + "/login")
    await page.fill("#username", username); await page.fill("#password", password)
    await page.click("button[type=submit]")
    if new_password:
        await page.wait_for_url("**/change-password")
        await page.fill("#cur", password); await page.fill("#new", new_password); await page.fill("#confirm", new_password)
        await page.click("button[type=submit]")
    await page.wait_for_url("**/dashboard")
    return page, errs

async def api(page, method, path, body=None):
    return await page.evaluate("""async ([method, path, body]) => {
        const csrf = document.cookie.split('; ').find(c => c.startsWith('pp_csrf='))?.slice(8) || '';
        const r = await fetch('/api' + path, {method, headers: {'content-type':'application/json','x-csrf-token': decodeURIComponent(csrf)}, body: body ? JSON.stringify(body) : undefined});
        return {status: r.status, body: r.status === 204 ? null : await r.json()};
    }""", [method, path, body])

async def main():
    os.makedirs("/tmp/up", exist_ok=True)
    open("/tmp/up/RFP.pdf","wb").write(b"%PDF-1.7\n" + b"Red Sea Global environment RFP " * 400)
    open("/tmp/up/Requirements.txt","w").write("Mandatory: In-Kingdom data residency\nSLA 99.9%\n")
    open("/tmp/up/fake.pdf","wb").write(b"MZ\x90\x00 this is not a pdf")
    async with async_playwright() as p:
        b = await p.chromium.launch(); V = {"width":1440,"height":950}; errs_all=[]
        actx = await b.new_context(viewport=V)
        admin, e = await login(actx, "admin", "BootstrapAdmin2026", "AdminPassw0rd2026"); errs_all+=e
        for u in [("director.rabie","Ahmed AlOulah","portfolio_director"),("a.alhaqbani","Abdulrahman Alhaqbani","presales_gm")]:
            await api(admin, "POST", "/admin/users", {"username":u[0],"full_name":u[1],"role":u[2],"temporary_password":PW})
        users = (await api(admin,"GET","/admin/users"))["body"]
        did = next(u["id"] for u in users if u["username"]=="director.rabie")
        await api(admin,"POST","/admin/teams",{"name":"Giga Projects","director_id":did})
        tid = (await api(admin,"GET","/admin/teams"))["body"][0]["id"]
        await api(admin,"POST","/admin/users",{"username":"m.rabie","full_name":"Mohammed Rabie","role":"presales_account","team_id":tid,"temporary_password":PW})

        pctx = await b.new_context(viewport=V, accept_downloads=True)
        pres, e = await login(pctx, "m.rabie", PW, "PresalesPassw0rd1"); errs_all+=e
        opp = (await api(pres,"POST","/opportunities",{"opportunity_number":"OP-2026-159388","title":"Environment and Sustainability Solution","account_name":"Red Sea Global"}))["body"]
        oid = opp["id"]
        # fill the DeepDive through the API so the test focuses on Phase 2
        import json; data = json.load(open("/home/claude/presales-portal/backend/tests/complete_deepdive.json"))
        r = await api(pres,"PUT",f"/opportunities/{oid}/versions/{opp['current_version_id']}/deepdive",{"data":data,"revision":0})
        assert r["status"]==200, r

        # ---- Documents
        await pres.goto(f"{BASE}/opportunities/{oid}/documents")
        await pres.select_option("#doc-category","rfp")
        await pres.set_input_files("#doc-file","/tmp/up/RFP.pdf")
        await expect(pres.locator("td", has_text="RFP.pdf").first).to_be_visible(timeout=10000)
        await pres.select_option("#doc-category","customer_requirements")
        await pres.set_input_files("#doc-file","/tmp/up/Requirements.txt")
        await expect(pres.locator("table.data tbody tr")).to_have_count(2)
        log("two documents uploaded with categories")
        await pres.set_input_files("#doc-file","/tmp/up/fake.pdf")
        await expect(pres.locator(".alert.error")).to_contain_text("do not match", timeout=10000)
        log("renamed non-PDF rejected")
        async with pres.expect_download() as dl:
            await pres.click("a.btn:has-text('Download')")
        d = await dl.value; log("downloaded", d.suggested_filename)
        await pres.screenshot(path="p2_documents.png", full_page=True)

        await pres.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pres.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=10000)
        await pres.goto(f"{BASE}/opportunities/{oid}/documents")
        assert await pres.locator("#doc-file").count() == 0, "upload box hidden after submission"
        assert await pres.locator("button:has-text('Remove')").count() == 0
        log("after submission the owner can no longer add or remove documents")

        # ---- Director review
        dctx = await b.new_context(viewport=V)
        director, e = await login(dctx, "director.rabie", PW, "DirectorPassw0rd1"); errs_all+=e
        await director.goto(f"{BASE}/opportunities/{oid}")
        await director.click("button:has-text('Start review')"); await director.click(".modal button.primary")
        await director.click(".tabs a:has-text('Documents')")
        await expect(director.locator("table.data tbody tr")).to_have_count(2)
        assert await director.locator("button:has-text('Remove')").count() == 0, "director cannot delete documents"
        async with director.expect_download() as dl2:
            await director.click("a.btn:has-text('Download')")
        await dl2.value
        log("director can read and download the documents, but not change them")

        await director.click(".tabs a:has-text('Review')")
        await director.select_option("#c-type","critical_issue")
        await director.select_option("#c-section","scope")
        await director.fill("#c-body","The RFP compliance matrix is missing from the scope of work.")
        await director.select_option("#c-priority","critical")
        await director.fill("#c-due","2026-10-01")
        await director.fill("#c-owner","Mohammed Rabie")
        await director.click("button:has-text('Add comment')")
        await expect(director.locator(".comment")).to_have_count(1, timeout=10000)
        await director.select_option("#c-type","missing_information")
        await director.fill("#c-body","SLA targets are not stated anywhere in the DeepDive.")
        await director.click("button:has-text('Add comment')")
        await expect(director.locator(".comment")).to_have_count(2, timeout=10000)
        await director.screenshot(path="p2_review.png", full_page=True)
        log("director added two structured comments")

        await director.goto(f"{BASE}/opportunities/{oid}")
        await director.click("button:has-text('Request changes')")
        await director.fill("#action-comment","See the two comments on the Review tab.")
        await director.click(".modal button.primary")
        await expect(director.locator(".opp-head .badge").first).to_have_text("Changes Requested")

        # ---- Presales sees comments read-only
        await pres.goto(f"{BASE}/opportunities/{oid}/review")
        await expect(pres.locator(".comment")).to_have_count(3, timeout=10000)  # 2 + decision summary
        assert await pres.locator("#c-body").count() == 0, "presales cannot add comments"
        assert await pres.locator("button:has-text('Mark addressed')").count() == 0
        await expect(pres.locator(".comment", has_text="SLA targets")).to_have_count(1)
        log("owner sees the comments read-only")

        # new version, resubmit, ready for AI closes open comments
        await pres.goto(f"{BASE}/opportunities/{oid}")
        await pres.click("button:has-text('Create new version')")
        await pres.fill("#change-notes","Added compliance matrix and SLA targets")
        await pres.click(".modal button.primary")
        await pres.wait_for_url("**/deepdive")
        await pres.goto(f"{BASE}/opportunities/{oid}/documents")
        await pres.set_input_files("#doc-file","/tmp/up/Requirements.txt")   # re-upload supersedes
        await expect(pres.locator("td", has_text="file version 2").first).to_be_visible(timeout=10000)
        log("re-upload recorded as file version 2")
        await pres.goto(f"{BASE}/opportunities/{oid}")
        await pres.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pres.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=10000)

        await director.goto(f"{BASE}/opportunities/{oid}")
        await director.click("button:has-text('Start review')"); await director.click(".modal button.primary")
        await director.click("button:has-text('Ready for AI analysis')"); await director.click(".modal button.primary")
        await expect(director.locator(".opp-head .badge").first).to_have_text("Ready for AI")
        review = (await api(director,"GET",f"/opportunities/{oid}/review"))["body"]
        assert review["open_count"] == 0, review["open_count"]
        assert review["decisions"][0]["decision"] == "ready_for_ai"
        log("open comments closed when the version was accepted for AI")

        audit = (await api(admin,"GET","/admin/audit-logs?page_size=200"))["body"]
        acts = sorted({a["action"] for a in audit["items"]})
        log("audit actions:", acts)
        assert {"document.uploaded","document.downloaded","review.comment_added"} <= set(acts)
        print("PAGE ERRORS:", errs_all)
        await b.close()

asyncio.run(main())
