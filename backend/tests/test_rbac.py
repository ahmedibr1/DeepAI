from tests.conftest import Api, create_opp


def test_role_permissions_are_enforced_on_routes(org):
    presales, gm, director, admin = Api("presales_one"), Api("gm"), Api("director_one"), Api("admin")
    assert presales.get("/api/admin/users").status_code == 403
    assert director.get("/api/admin/audit-logs").status_code == 403
    assert gm.get("/api/admin/users").status_code == 403
    assert admin.get("/api/admin/users").status_code == 200
    for api in (gm, director, admin):
        r = api.post("/api/opportunities", json={"opportunity_number": "OP-2026-1", "title": "t", "account_name": "a"})
        assert r.status_code == 403, "only Presales Account creates opportunities"


def test_presales_cannot_see_other_presales_opportunities(org):
    mine = create_opp(Api("presales_one"), "OP-2026-000001")
    other = Api("presales_one_b")
    assert other.get(f"/api/opportunities/{mine['id']}").status_code == 404  # existence not disclosed
    assert other.get(f"/api/opportunities/{mine['id']}/versions").status_code == 404
    assert other.get("/api/opportunities").json()["total"] == 0


def test_management_roles_see_everything_and_presales_only_their_own(org):
    """In this phase GM, Portfolio Director and Portfolio Manager share one scope; the roles stay separate."""
    o1 = create_opp(Api("presales_one"), "OP-2026-000001")
    o2 = create_opp(Api("presales_two"), "OP-2026-000002")
    for name in ("gm", "director_one", "director_two", "manager_one", "admin"):
        ids = {o["id"] for o in Api(name).get("/api/opportunities").json()["items"]}
        assert ids == {o1["id"], o2["id"]}, name
    assert {o["id"] for o in Api("presales_one").get("/api/opportunities").json()["items"]} == {o1["id"]}


def test_who_may_edit_a_deepdive(org, complete_deepdive):
    """The owner and management may edit an open version; another Presales Account may not see it at all."""
    o = create_opp(Api("presales_one"), "OP-2026-000003")
    url = f"/api/opportunities/{o['id']}/versions/{o['current_version_id']}/deepdive"
    assert Api("presales_one_b").put(url, json={"data": complete_deepdive, "revision": 0}).status_code == 404
    assert Api("director_one").put(url, json={"data": complete_deepdive, "revision": 0}).status_code == 200
    assert Api("gm").put(url, json={"data": {**complete_deepdive, "sow": "GM edit"}, "revision": 1}).status_code == 200
    assert Api("presales_one").put(url, json={"data": {**complete_deepdive, "sow": "Owner edit"}, "revision": 2}).status_code == 200


def test_explicit_grant_gives_read_access(org):
    from app.db import SessionLocal
    from app.models import OpportunityAccess
    o = create_opp(Api("presales_one"), "OP-2026-000004")
    with SessionLocal() as db:
        db.add(OpportunityAccess(opportunity_id=o["id"], user_id=org["p1b"].id, granted_by=org["admin"].id))
        db.commit()
    other = Api("presales_one_b")
    detail = other.get(f"/api/opportunities/{o['id']}")
    assert detail.status_code == 200 and detail.json()["can_edit"] is False


def test_admin_team_rules(org):
    admin = Api("admin")
    r = admin.post("/api/admin/users", json={"username": "newbie", "full_name": "New", "role": "presales_account",
                                               "team_id": str(org["t1"].id), "temporary_password": "weak"})
    assert r.status_code == 422
    r = admin.post("/api/admin/users", json={"username": "dir3", "full_name": "Dir", "role": "portfolio_director",
                                               "team_id": str(org["t1"].id), "temporary_password": "TempPassw0rd123"})
    assert r.status_code == 422, "Directors are assigned to a portfolio, not members of one"
    r = admin.post("/api/admin/teams", json={"name": "Dup lead", "director_id": str(org["d1"].id)})
    assert r.status_code == 409, "a Director leads one portfolio"
    r = admin.post("/api/admin/teams", json={"name": "Bad manager", "manager_id": str(org["d2"].id)})
    assert r.status_code == 422, "the portfolio manager must hold the Portfolio Presales Manager role"


def test_dashboards_for_every_role(org):
    create_opp(Api("presales_one"), "OP-2026-000010")
    create_opp(Api("presales_two"), "OP-2026-000011")
    for user, total in {"presales_one": 1, "director_one": 2, "manager_one": 2, "gm": 2, "admin": 2}.items():
        r = Api(user).get("/api/dashboard/summary")
        assert r.status_code == 200, (user, r.text)
        assert r.json()["cards"][0]["value"] == total, user
    account = Api("presales_one").get("/api/dashboard/summary").json()
    management = Api("gm").get("/api/dashboard/summary").json()
    assert account["kind"] == "account" and management["kind"] == "management"
    assert [c["label"] for c in management["cards"]] == [
        "Active Opportunities", "Awaiting My Review", "Ready for AI", "Opportunities Needing Attention"]
    # The two dashboards stay separate: the monitor belongs to management only.
    assert "monitor" in management and "monitor" not in account
    assert [c["label"] for c in account["cards"]] == [
        "My Opportunities", "Not Yet Submitted", "Returned for Changes", "Review Comments to Address",
        "AI Recommendations Available"]
    assert {"to_complete", "in_review", "ai_available"} <= set(account)
    assert "Awaiting My Review" not in [c["label"] for c in account["cards"]]
    assert "by_stage" not in account and "by_stage" not in management


def test_list_filters(org):
    p = Api("presales_one")
    create_opp(p, "OP-2026-000020")
    gm = Api("gm")
    assert gm.get("/api/opportunities", params={"number": "000020"}).json()["total"] == 1
    assert gm.get("/api/opportunities", params={"status": ["completed"]}).json()["total"] == 0
    assert gm.get("/api/opportunities", params={"director_id": str(org["d2"].id)}).json()["total"] == 0
    assert gm.get("/api/opportunities", params={"owner_id": str(org["p1"].id), "ai_readiness": "none"}).json()["total"] == 1


def test_support_and_risks_are_grouped_per_opportunity_and_sorted_by_urgency(org, complete_deepdive):
    """The monitoring list comes from the DeepDive itself; nothing is entered twice."""
    urgent = {**complete_deepdive,
              "support": [{"need": "Vendor commercial quotation", "from": "Nutanix", "priority": "High", "date": "2020-01-15"},
                          {"need": "Low priority item", "from": "x", "priority": "Low", "date": "2020-01-01"}],
              "riskTech": [{"risk": "Integration dependency", "mitigation": "Workshop", "owner": "MR", "date": "2026-10-01", "impact": "High"}],
              "riskFin": [{"risk": "Budget gap", "mitigation": "Re-price", "owner": "SH", "date": "2026-10-02", "impact": "Low"}]}
    later = {**complete_deepdive,
             "support": [{"need": "Management pricing approval", "from": "VP", "priority": "High", "date": "2099-01-01"}],
             "riskTech": [], "riskFin": []}
    quiet = {**complete_deepdive, "support": [{"need": "Nothing urgent", "from": "x", "priority": "Low", "date": ""}],
             "riskTech": [], "riskFin": []}

    for number, data in (("OP-2026-000101", urgent), ("OP-2026-000102", later), ("OP-2026-000103", quiet)):
        api = Api("presales_one")
        opp = create_opp(api, number)
        api.put(f"/api/opportunities/{opp['id']}/versions/{opp['current_version_id']}/deepdive", json={"data": data, "revision": 0})

    rows = Api("gm").get("/api/dashboard/attention").json()["rows"]
    flagged = [r for r in rows if r["attention_count"] > 0]
    assert [r["opportunity_number"] for r in flagged] == ["OP-2026-000101", "OP-2026-000102"], "flagged, most urgent first"
    assert len(rows) == 3, "the monitor lists the quiet opportunity as well"
    first = flagged[0]
    assert first["is_overdue"] is True and first["nearest_due_date"] == "2020-01-15"
    assert first["days_since_update"] >= 0
    assert first["support_count"] == 1 and first["risk_count"] == 1, "only High priority / High impact items count"
    assert first["support"][0]["need"] == "Vendor commercial quotation"
    assert first["risks"][0]["category"] == "Technical"
    assert first["owner"] and first["manager"] and first["director"], "the review line is shown per opportunity"
    assert first["portfolio"] == "Portfolio One"

    card = next(c for c in Api("gm").get("/api/dashboard/summary").json()["cards"] if c["key"] == "attention")
    assert card["value"] == 2, "the KPI counts opportunities, not individual items"
    assert Api("presales_one").get("/api/dashboard/attention").status_code == 403


def test_never_submitted_drafts_are_deleted(org):
    owner, other = Api("presales_one"), Api("presales_one_b")
    opp = create_opp(owner, "OP-2026-000200")
    owner.c.post(f"/api/opportunities/{opp['id']}/documents", files={"file": ("RFP.pdf", b"%PDF-1.7 test", "application/pdf")},
                 data={"category": "rfp"}, headers=owner._h())
    assert other.delete(f"/api/opportunities/{opp['id']}").status_code == 404
    assert owner.get(f"/api/opportunities/{opp['id']}").json()["can_delete"] is True
    assert owner.delete(f"/api/opportunities/{opp['id']}").json()["outcome"] == "deleted"
    assert owner.get(f"/api/opportunities/{opp['id']}").status_code == 404
    entries = Api("admin").get("/api/admin/audit-logs", params={"action": "opportunity.deleted"}).json()["items"]
    assert entries and entries[0]["details"]["number"] == "OP-2026-000200"


def test_submitted_opportunities_are_archived_not_destroyed(org, complete_deepdive):
    """Work that has been submitted is never lost to a stray click."""
    owner, gm, admin = Api("presales_one"), Api("gm"), Api("admin")
    opp = create_opp(owner, "OP-2026-000202")
    owner.put(f"/api/opportunities/{opp['id']}/versions/{opp['current_version_id']}/deepdive",
              json={"data": complete_deepdive, "revision": 0})
    owner.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "submit"})

    assert owner.delete(f"/api/opportunities/{opp['id']}").json()["outcome"] == "archived"
    assert owner.get("/api/opportunities").json()["total"] == 0, "archived work leaves the lists"
    assert gm.get("/api/dashboard/summary").json()["cards"][0]["value"] == 0
    detail = owner.get(f"/api/opportunities/{opp['id']}").json()
    assert detail["is_archived"] is True, "but the record and everything attached to it survive"
    assert owner.get("/api/opportunities", params={"archived": "1"}).json()["total"] == 1

    assert owner.post(f"/api/opportunities/{opp['id']}/restore").json()["is_archived"] is False
    assert owner.get("/api/opportunities").json()["total"] == 1

    # Only an Admin can remove an archived opportunity for good
    owner.delete(f"/api/opportunities/{opp['id']}")
    assert gm.c.delete(f"/api/opportunities/{opp['id']}/purge", headers=gm._h()).status_code == 403
    assert admin.c.delete(f"/api/opportunities/{opp['id']}/purge", headers=admin._h()).status_code == 204
    assert admin.get(f"/api/opportunities/{opp['id']}").status_code == 404


def test_awaiting_my_review_is_personal_for_portfolio_roles(org, complete_deepdive):
    owner = Api("presales_one")
    opp = create_opp(owner, "OP-2026-000203")
    owner.put(f"/api/opportunities/{opp['id']}/versions/{opp['current_version_id']}/deepdive",
              json={"data": complete_deepdive, "revision": 0})
    owner.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "submit"})

    mine = next(c for c in Api("manager_one").get("/api/dashboard/summary").json()["cards"] if c["key"] == "awaiting")
    assert mine["value"] == 1, "routed to the manager of the owner's portfolio"
    other = next(c for c in Api("director_two").get("/api/dashboard/summary").json()["cards"] if c["key"] == "awaiting")
    assert other["value"] == 0 and other["note"] == "1 in review overall", "another portfolio's director sees the context, not the count"
    gm = next(c for c in Api("gm").get("/api/dashboard/summary").json()["cards"] if c["key"] == "awaiting")
    assert gm["value"] == 1, "the GM oversees everything"
    assert Api("manager_one").get("/api/opportunities", params={"assigned_to_me": "1"}).json()["total"] == 1


def test_create_opportunity_populates_the_deepdive(org):
    owner = Api("presales_one")
    opp = create_opp(owner, "OP-2026-000300")
    data = owner.get(f"/api/opportunities/{opp['id']}/versions/{opp['current_version_id']}").json()["data"]
    assert data["oppNumber"] == "OP-2026-000300"
    assert data["oppName"] == "Environment and Sustainability Solution"
    assert data["customer"] == "Red Sea Global"
    assert data["presalesOwner"] == "Presales One"
    assert opp["manager"]["username"] == "manager_one" and opp["director"]["username"] == "director_one"
    assert opp["ai_status"] == "not_analysed" and opp["ai_status_label"] == "AI Not Analysed"


def test_new_version_copies_everything_and_keeps_the_number(org, complete_deepdive):
    owner = Api("presales_one")
    opp = create_opp(owner, "OP-2026-000400")
    owner.put(f"/api/opportunities/{opp['id']}/versions/{opp['current_version_id']}/deepdive",
              json={"data": complete_deepdive, "revision": 0})
    v2 = owner.post(f"/api/opportunities/{opp['id']}/versions", json={"change_notes": "Round two"}).json()
    copied = owner.get(f"/api/opportunities/{opp['id']}/versions/{v2['id']}").json()["data"]
    for key in ("sow", "solution", "vendors", "internal", "winTech", "riskTech", "support", "groups", "competitors"):
        assert copied[key] == complete_deepdive[key], key
    assert copied["oppNumber"] == "OP-2026-000400", "the number never changes across versions"
    assert owner.get(f"/api/opportunities/{opp['id']}").json()["opportunity_number"] == "OP-2026-000400"


def test_monitor_lists_every_active_opportunity_with_dates(org, complete_deepdive):
    """The monitor shows the whole active portfolio, not only the opportunities with attention items."""
    from datetime import date, timedelta

    owner = Api("presales_one")
    soon = (date.today() + timedelta(days=2)).isoformat()
    past = (date.today() - timedelta(days=4)).isoformat()
    received = (date.today() - timedelta(days=5)).isoformat()

    busy = {**complete_deepdive, "submissionDate": soon, "presalesReceived": received, "value": "28000000"}
    quiet = {**complete_deepdive, "submissionDate": past, "presalesReceived": received,
             "support": [{"need": "Nothing urgent", "from": "x", "priority": "Low", "date": ""}],
             "riskTech": [], "riskFin": []}

    for number, data in (("OP-2026-000600", busy), ("OP-2026-000601", quiet)):
        opp = create_opp(owner, number)
        owner.put(f"/api/opportunities/{opp['id']}/versions/{opp['current_version_id']}/deepdive",
                  json={"data": data, "revision": 0})
    Api("admin").patch(f"/api/opportunities/{owner.get('/api/opportunities').json()['items'][0]['id']}",
                       json={"opportunity_type": "RFP", "vertical": "Giga Projects"})

    body = Api("gm").get("/api/dashboard/attention").json()
    rows = {r["opportunity_number"]: r for r in body["rows"]}
    assert set(rows) == {"OP-2026-000600", "OP-2026-000601"}, "quiet opportunities are listed too"
    assert [r["opportunity_number"] for r in body["rows"]][0] == "OP-2026-000601", "nearest submission date first"
    assert body["portfolios"], "the portfolio filter has options"

    busy_row = rows["OP-2026-000600"]
    assert busy_row["days_remaining"] == 2 and busy_row["is_overdue_submission"] is False
    assert busy_row["days_with_presales"] == 5
    assert busy_row["estimated_value"] == 28_000_000
    assert busy_row["attention_count"] == busy_row["support_count"] + busy_row["risk_count"] >= 3
    assert busy_row["scope"] and busy_row["internal"] and busy_row["vendors"]
    assert all(s["priority"].lower() == "high" for s in busy_row["support"])
    assert all(r["impact"].lower() == "high" for r in busy_row["risks"])

    quiet_row = rows["OP-2026-000601"]
    assert quiet_row["attention_count"] == 0 and quiet_row["is_overdue_submission"] is True
    assert quiet_row["days_remaining"] == -4

    # The KPI still counts only the opportunities with something to watch
    card = next(c for c in Api("gm").get("/api/dashboard/summary").json()["cards"] if c["key"] == "attention")
    assert card["value"] == 1
