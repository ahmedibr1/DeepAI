import asyncio, re
from playwright.async_api import async_playwright, expect
FILE='http://localhost:4180/Presales_Portal_Phase1_Demo.html'
PW="Demo2026pass"
log=lambda *a: print("•",*a,flush=True)

async def sign_in(page, username):
    if await page.locator(".user-chip").count():
        await page.click(".user-chip")
        await page.click(".user-dropdown button")
        await page.wait_for_selector("#username")
    await page.fill("#username", username); await page.fill("#password", PW); await page.click("button[type=submit]")
    await page.wait_for_selector(".sidenav .me b")
    await page.goto(page.url.split("#")[0] + "#/dashboard"); await page.wait_for_selector(".stat")
    return await page.locator(".sidenav .me b").inner_text()

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); page=await (await b.new_context(viewport={"width":1440,"height":1000})).new_page()
        errs=[]; page.on("pageerror", lambda e: errs.append(str(e)[:160]))
        page.on("console", lambda m: m.type=="error" and errs.append(m.text[:160]))
        await page.goto(FILE); await page.evaluate("localStorage.clear()"); await page.reload()
        await page.evaluate("localStorage.setItem('pp-demo-seen','1')"); await page.reload()

        log("signed in as", await sign_in(page, "m.rabie"))
        cards=await page.eval_on_selector_all(".stat","els=>els.map(e=>e.getAttribute('aria-label')||e.querySelector('.l').textContent.trim())")
        assert cards==["My Active Opportunities","RFP | RFI | Non-RFP","Not Yet Submitted","Returned for Changes",
                       "Review Comments to Address","AI Recommendations Available"], cards
        log("Presales Account dashboard:", cards)

        await page.goto(page.url.split("#")[0]+"#/opportunities")
        card=page.locator(".opp-card").first
        for label in ("Owner","Manager","Director"):
            await expect(card.locator("dt", has_text=label)).to_be_visible()
        await expect(card.locator(".ai-chip")).to_have_text("AI Not Analysed")
        await expect(card).to_contain_text("OP-2026-159388")
        log("opportunity cards show the number, review line, version and AI status")

        await card.click()
        await page.click(".tabs a:has-text('DeepDive')")
        frame=None
        for _ in range(60):
            frame=next((f for f in page.frames if "blob:" in f.url or "srcdoc" in f.url), None)
            if frame and await frame.locator('[data-path="customer"]').count(): break
            await page.wait_for_timeout(250)
        await expect(frame.locator('[data-path="oppNumber"]')).to_have_value("OP-2026-159388")
        for field in ("oppNumber","customer","oppName","presalesOwner"):
            assert await frame.locator(f'[data-path="{field}"]').get_attribute("readonly") is not None, field
        assert await frame.locator("#btnExample").is_visible() and await frame.locator("#btnClear").is_visible()
        assert await frame.locator("label[for='fileIn']").is_visible() and await frame.locator("#btnSave").is_visible()
        log("DeepDive auto-populated, read-only where the portal owns it, all original controls present")

        await page.click("button.btn.coral:has-text('Submit to Review')")
        await expect(page.locator(".opp-head .badge").first).to_have_text("Submitted for Review", timeout=15000)
        log("Submit to Review")

        log("signed in as", await sign_in(page, "m.alasadi"))
        mcards=await page.eval_on_selector_all(".stat","els=>els.map(e=>e.getAttribute('aria-label')||e.querySelector('.l').textContent.trim())")
        assert mcards==["Active Opportunities","RFP | RFI | Non-RFP","AI Recommendations Available","Opportunities Needing Attention"], mcards
        assert await page.locator("text=Recently updated").count()==0
        assert await page.locator("text=Opportunities by stage").count()==0
        assert await page.locator("text=Smart Destinations").count()==0
        await expect(page.locator(".monitor-table").first).to_be_visible(timeout=10000)
        await page.screenshot(path="d7_management.png", full_page=True)
        log("management dashboard:", mcards)

        await page.goto(page.url.split("#")[0] + "#/opportunities?status=submitted")
        await page.locator(".opp-card", has_text="OP-2026-159388").first.click()
        await expect(page.locator(".opp-head .badge").first).to_be_visible(timeout=15000)
        await expect(page.locator("button:has-text('Start review')")).to_be_visible(timeout=15000)
        await page.click("button:has-text('Start review')"); await page.click(".modal button.primary")
        await page.click(".tabs a:has-text('Review')")
        await page.fill("#c-body","Confirm the SLA the customer expects.")
        await page.click("button:has-text('Add comment')")
        await expect(page.locator(".comment")).to_have_count(1, timeout=10000)
        await page.click(".tabs a:has-text('Overview')")
        await page.click("button:has-text('Ready for AI analysis')"); await page.click(".modal button.primary")
        await page.click(".tabs a:has-text('AI recommendations')")
        assert await page.locator(".tabs a:has-text('AI analysis')").count()==0, "one merged AI tab"
        await page.click("button:has-text('Run AI analysis')")
        await expect(page.locator(".readiness-head .badge")).to_be_visible(timeout=40000)
        await page.screenshot(path="d8_ai.png", full_page=True)
        log("a Portfolio Presales Manager reviewed and ran the AI analysis")

        log("signed in as", await sign_in(page, "m.rabie"))
        await page.goto(page.url.split("#")[0]+"#/opportunities")
        await page.locator(".opp-card").first.click()
        await page.click(".tabs a:has-text('AI recommendations')")
        await expect(page.locator(".readiness-head")).to_be_visible(timeout=15000)
        assert await page.locator("button:has-text('Run AI analysis')").count()==0
        log("owner reads the AI recommendations but cannot trigger them")

        # delete with confirmation
        await page.goto(page.url.split("#")[0]+"#/opportunities/new")
        await page.fill("#num","OP-2026-000777"); await page.fill("#acc","ACME"); await page.fill("#title","Test opportunity")
        await page.click("button[type=submit]")
        await page.wait_for_url(re.compile(r".*/deepdive"))
        await page.click("button:has-text('Delete')")
        await expect(page.locator(".modal")).to_contain_text("never submitted")
        await page.click(".modal button.danger")
        await page.wait_for_url(re.compile(r".*#/opportunities$"))
        remaining = await page.evaluate("""async()=>{const r=await fetch('/api/opportunities');const b=await r.json();
            return b.items.map(o=>o.opportunity_number);}""")
        assert "OP-2026-000777" not in remaining, remaining
        log("a draft that was never submitted is deleted")

        # submitted work is archived instead
        await page.goto(page.url.split("#")[0]+"#/opportunities")
        await page.locator(".opp-card", has_text="OP-2026-159388").first.click()
        await expect(page.locator("button:has-text('Archive')")).to_be_visible(timeout=10000)
        await page.click("button:has-text('Archive')")
        await expect(page.locator(".modal")).to_contain_text("archived rather than deleted")
        await page.click(".modal button.danger")
        await page.wait_for_url(re.compile(r".*#/opportunities$"))
        left = await page.evaluate("""async()=>{const r=await fetch('/api/opportunities');const b=await r.json();
            const a=await (await fetch('/api/opportunities?archived=1')).json();
            return {active:b.total, archived:a.total};}""")
        assert left=={"active":0,"archived":1}, left
        log("submitted work is archived, not destroyed")
        print("PAGE ERRORS:", errs[:5])
        await b.close()
asyncio.run(main())
