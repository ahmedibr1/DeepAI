import asyncio, re, json
from playwright.async_api import async_playwright, expect

BASE = "http://localhost:4173"
PPTX = "/home/claude/form/t_DeepDive_Red_Sea_Global_Environment_and_Sustainability_Solution.pptx"
PW = "PortalPassw0rd2026"
log = lambda *a: print("•", *a, flush=True)

async def login(ctx, username, password, new_password=None):
    page = await ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and "401" not in m.text and errors.append(m.text))
    await page.goto(BASE + "/login")
    await page.fill("#username", username); await page.fill("#password", password)
    await page.click("button[type=submit]")
    if new_password:
        await page.wait_for_url("**/change-password")
        await page.fill("#cur", password); await page.fill("#new", new_password); await page.fill("#confirm", new_password)
        await page.click("button[type=submit]")
    await page.wait_for_url("**/dashboard")
    return page, errors

async def api(page, method, path, body=None):
    return await page.evaluate("""async ([method, path, body]) => {
        const csrf = document.cookie.split('; ').find(c => c.startsWith('pp_csrf='))?.slice(8) || '';
        const r = await fetch('/api' + path, {method, headers: {'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf)}, body: body ? JSON.stringify(body) : undefined});
        return {status: r.status, body: r.status === 204 ? null : await r.json()};
    }""", [method, path, body])

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        V = {"width": 1440, "height": 950}
        all_errors = []

        # ---------- Admin: first sign-in, org setup
        actx = await browser.new_context(viewport=V)
        admin, errs = await login(actx, "admin", "BootstrapAdmin2026", new_password="AdminPassw0rd2026")
        all_errors += errs
        log("admin signed in after forced password change")
        for u in [("director.rabie", "Ahmed AlOulah", "portfolio_director"), ("a.alhaqbani", "Abdulrahman Alhaqbani", "presales_gm")]:
            r = await api(admin, "POST", "/admin/users", {"username": u[0], "full_name": u[1], "role": u[2], "temporary_password": PW})
            assert r["status"] == 201, r
        users = (await api(admin, "GET", "/admin/users"))["body"]
        director_id = next(u["id"] for u in users if u["username"] == "director.rabie")
        # Team via UI
        await admin.goto(BASE + "/admin/teams")
        await admin.click("text=Add team")
        await admin.fill("#t-name", "Giga Projects")
        await admin.select_option("#t-dir", director_id)
        await admin.click(".modal button.primary")
        await expect(admin.locator("td", has_text="Giga Projects")).to_be_visible()
        log("team created in UI")
        # Presales via UI
        await admin.goto(BASE + "/admin/users")
        await admin.click("text=Add user")
        await admin.fill("#u-name", "Mohammed Rabie"); await admin.fill("#u-username", "m.rabie")
        await admin.fill("#u-email", "m.rabie@example.com")
        await admin.select_option("#u-role", "presales_account")
        team_id = (await api(admin, "GET", "/admin/teams"))["body"][0]["id"]
        await admin.select_option("#u-team", team_id)
        await admin.fill("#u-pass", PW)
        await admin.click(".modal button.primary")
        await expect(admin.locator("td", has_text="m.rabie").first).to_be_visible()
        await admin.screenshot(path="01_admin_users.png")
        log("presales user created in UI")

        # ---------- Account Presales: create opportunity, import DeepDive, submit
        pctx = await browser.new_context(viewport=V, accept_downloads=True)
        pres, errs = await login(pctx, "m.rabie", PW, new_password="PresalesPassw0rd1")
        all_errors += errs
        assert await pres.locator("nav >> text=Administration").count() == 0, "presales must not see admin nav"
        r = await api(pres, "GET", "/admin/users"); assert r["status"] == 403
        await pres.goto(BASE + "/opportunities/new")
        await pres.fill("#num", "OP-2026-159388"); await pres.fill("#acc", "Red Sea Global")
        await pres.fill("#title", "Environment and Sustainability Solution")
        await pres.click("button[type=submit]")
        await pres.wait_for_url(re.compile(r".*/opportunities/[0-9a-f-]+/deepdive"))
        opp_url = pres.url.replace("/deepdive", "")
        opp_id = opp_url.rsplit("/", 1)[1]
        log("opportunity created", opp_id)

        frame = None
        for _ in range(40):
            frame = next((f for f in pres.frames if "builder.html" in f.url), None)
            if frame and await frame.locator("#stepList li").count() > 0: break
            await pres.wait_for_timeout(250)
        await expect(frame.locator('[data-path="oppNumber"]')).to_have_value("OP-2026-159388")
        assert await frame.locator('[data-path="oppNumber"]').get_attribute("readonly") is not None
        assert await frame.locator("#btnExample").is_hidden()
        await frame.set_input_files("#fileIn", PPTX)
        await frame.locator("#modal.open #modalYes").click(timeout=5000)
        await expect(pres.locator(".save-state")).to_have_text(re.compile("Saved"), timeout=15000)
        await expect(frame.locator('[data-path="customer"]')).to_have_value("Red Sea Global")
        await pres.screenshot(path="02_presales_deepdive.png")
        log("imported existing DeepDive PowerPoint into the portal; autosaved")

        # the builder's own downloads still work embedded
        await frame.locator('[data-go="7"]').click()
        async with pres.expect_download() as dl:
            await frame.locator("#btnDownload").click()
        d = await dl.value
        log("PowerPoint downloaded from embedded builder:", d.suggested_filename)

        await pres.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pres.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=10000)
        await expect(pres.locator(".builder-bar .badge")).to_have_text("v1 is locked", timeout=8000)
        await expect(frame.locator("body.readonly")).to_have_count(1, timeout=8000)
        log("submitted; v1 locked and builder read-only")

        # ---------- Director: review, request changes
        dctx = await browser.new_context(viewport=V)
        director, errs = await login(dctx, "director.rabie", PW, new_password="DirectorPassw0rd1")
        all_errors += errs
        await expect(director.locator(".stat", has_text="Awaiting my review").locator(".v")).to_have_text("1")
        await director.screenshot(path="03_director_dashboard.png")
        await director.click("a.opp-title")
        await director.click("button:has-text('Start review')")
        await director.click(".modal button.primary")
        await expect(director.locator(".opp-head .badge").first).to_have_text("Director Review")
        await director.click("a:has-text('DeepDive')")
        dframe = None
        for _ in range(40):
            dframe = next((f for f in director.frames if "builder.html" in f.url), None)
            if dframe and await dframe.locator("#stepList li").count() > 0 and await dframe.locator('[data-path="customer"]').count(): break
            await director.wait_for_timeout(250)
        await expect(dframe.locator('[data-path="customer"]')).to_have_value("Red Sea Global")
        assert await dframe.locator('[data-path="customer"]').get_attribute("readonly") is not None
        assert await dframe.locator("body.readonly").count() == 1
        await director.screenshot(path="04_director_readonly_deepdive.png")
        await director.click("button:has-text('Request changes')")
        await director.fill("#action-comment", "Add the RFP compliance matrix and confirm SenseTime deal registration before resubmitting.")
        await director.click(".modal button.primary")
        await expect(director.locator(".opp-head .badge").first).to_have_text("Changes Requested")
        log("director reviewed read-only and requested changes")

        # ---------- Presales: notification, new version, edit, resubmit
        await pres.goto(BASE + "/dashboard")
        await expect(pres.locator(".icon-btn .dot")).to_be_visible(timeout=5000)
        await pres.click("button[aria-label^='Notifications']")
        await pres.click(".notif >> text=Changes requested")
        await expect(pres.locator(".alert.info", has_text="requested changes")).to_contain_text("RFP compliance matrix")
        await pres.click("button:has-text('Create new version')")
        await pres.fill("#change-notes", "Added RFP compliance matrix; SenseTime registration confirmed")
        await pres.click(".modal button.primary")
        await pres.wait_for_url("**/deepdive")
        await expect(pres.locator("#version-select")).to_contain_text("v2 (current) · editing")
        frame = None
        for _ in range(40):
            frame = next((f for f in pres.frames if "builder.html" in f.url), None)
            if frame and await frame.locator('[data-go="1"]').count(): break
            await pres.wait_for_timeout(250)
        await frame.locator('[data-go="1"]').click()
        sow = frame.locator('[data-path="sow"]')
        await expect(sow).not_to_have_attribute("readonly", "")
        await sow.click(); await sow.press("End"); await sow.type("\nDeliver an RFP compliance matrix")
        await expect(pres.locator(".save-state")).to_have_text(re.compile("Saved"), timeout=15000)
        await pres.click("button.btn.coral:has-text('Submit to Review')")
        await expect(pres.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=10000)
        log("v2 created, edited, autosaved and resubmitted")

        # v1 still has the original scope
        versions = (await api(pres, "GET", f"/opportunities/{opp_id}/versions"))["body"]
        v1 = next(v for v in versions if v["version_number"] == 1)
        v1d = (await api(pres, "GET", f"/opportunities/{opp_id}/versions/{v1['id']}"))["body"]
        assert "compliance matrix" not in v1d["data"]["sow"]
        await pres.click("a:has-text('Versions (2)')")
        await pres.screenshot(path="05_versions_timeline.png")

        # ---------- Director: ready for AI; AI step not enabled yet
        await director.goto(opp_url)
        await director.click("button:has-text('Start review')"); await director.click(".modal button.primary")
        await expect(director.locator(".opp-head .badge").first).to_have_text("Director Review")
        await director.click("button:has-text('Ready for AI analysis')"); await director.click(".modal button.primary")
        await expect(director.locator(".opp-head .badge").first).to_have_text("Ready for AI")
        assert await director.locator("button:has-text('Run AI analysis')").is_disabled()
        await director.click("a:has-text('Workflow history')")
        await director.screenshot(path="06_workflow_history.png")
        log("director marked ready for AI; Run AI analysis visible but disabled until Phase 3")

        # ---------- GM: read-only visibility across teams
        gctx = await browser.new_context(viewport=V)
        gm, errs = await login(gctx, "a.alhaqbani", PW, new_password="GmPassw0rd2026x")
        all_errors += errs
        await expect(gm.locator(".stat.hero .v")).to_have_text("1")
        await gm.screenshot(path="07_gm_dashboard.png")
        await gm.goto(opp_url)
        assert await gm.locator(".opp-head button.coral").count() == 0, "GM has no workflow actions"
        r = await api(gm, "PUT", f"/opportunities/{opp_id}/versions/{versions[0]['id']}/deepdive", {"data": {}, "revision": 0})
        assert r["status"] == 403, r
        log("GM sees all, read-only; write attempt → 403")

        # ---------- Presales B in same team cannot see it
        r = await api(admin, "POST", "/admin/users", {"username": "other.presales", "full_name": "Other Presales", "role": "presales_account",
                                                     "team_id": (await api(admin, "GET", "/admin/teams"))["body"][0]["id"], "temporary_password": PW})
        octx = await browser.new_context(viewport=V)
        other, errs = await login(octx, "other.presales", PW, new_password="OtherPassw0rd1")
        r = await api(other, "GET", f"/opportunities/{opp_id}")
        assert r["status"] == 404, r
        log("another Account Presales in the same team → 404")

        # ---------- Admin audit log
        await admin.goto(BASE + "/admin/audit")
        await expect(admin.locator("code", has_text="opportunity.status_changed").first).to_be_visible()
        await admin.screenshot(path="08_audit_log.png")
        audit = (await api(admin, "GET", "/admin/audit-logs?page_size=200"))["body"]
        actions = sorted({a["action"] for a in audit["items"]})
        log("audit actions:", actions)
        await pres.goto(BASE + "/dashboard"); await pres.screenshot(path="09_presales_dashboard.png")
        await browser.close()
        print("PAGE ERRORS:", all_errors)

asyncio.run(main())
