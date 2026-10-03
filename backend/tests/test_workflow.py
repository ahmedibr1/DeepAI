import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.db import SessionLocal, engine
from app.models import AuditLog, Notification
from tests.conftest import Api, create_opp


def save(api, opp_id, version_id, data, revision):
    return api.put(f"/api/opportunities/{opp_id}/versions/{version_id}/deepdive", json={"data": data, "revision": revision})


def test_full_phase1_workflow_with_versions(org, complete_deepdive):
    presales, director, gm = Api("presales_one"), Api("director_one"), Api("gm")
    o = create_opp(presales)
    oid, v1 = o["id"], o["current_version_id"]
    assert o["status"] == "draft" and o["current_version"] == 1 and o["can_edit"]

    # Portal owns the opportunity number, whatever the builder sends
    r = save(presales, oid, v1, {**complete_deepdive, "oppNumber": "HACKED"}, 0)
    assert r.status_code == 200 and r.json()["revision"] == 1
    data = presales.get(f"/api/opportunities/{oid}/versions/{v1}").json()["data"]
    assert data["oppNumber"] == "OP-2026-159388"

    # Optimistic concurrency
    assert save(presales, oid, v1, complete_deepdive, 0).status_code == 409

    # Incomplete DeepDive cannot be submitted through the API
    incomplete = {**complete_deepdive, "sow": "", "vendors": [{**complete_deepdive["vendors"][0], "internal": True, "justification": ""}]}
    assert save(presales, oid, v1, incomplete, 1).status_code == 200
    r = presales.post(f"/api/opportunities/{oid}/transitions", json={"action": "submit"})
    assert r.status_code == 422
    missing = r.json()["detail"]["missing"]
    assert "Scope of work" in missing and any("justification" in m for m in missing)

    assert save(presales, oid, v1, complete_deepdive, 2).status_code == 200
    r = presales.post(f"/api/opportunities/{oid}/transitions", json={"action": "submit"})
    assert r.status_code == 200 and r.json()["status"] == "submitted" and r.json()["can_edit"] is False
    assert r.json()["status_label"] == "Submitted for Review", "no role is named in the status"

    # Locked: no edits via API, and the database refuses too
    assert save(presales, oid, v1, complete_deepdive, 4).status_code in (403, 409)
    with pytest.raises(DBAPIError):
        with engine.begin() as conn:
            conn.execute(text("UPDATE deepdive_data SET data = '{}'::jsonb WHERE version_id = :v"), {"v": v1})

    # Only the team director reviews
    # The owner never reviews their own work; any management role may
    assert presales.post(f"/api/opportunities/{oid}/transitions", json={"action": "start_review"}).status_code == 403
    assert director.post(f"/api/opportunities/{oid}/transitions", json={"action": "start_review"}).json()["status"] == "in_review"
    assert gm.get(f"/api/opportunities/{oid}").json()["actions"], "GM sees review actions too"

    assert director.post(f"/api/opportunities/{oid}/transitions", json={"action": "request_changes"}).status_code == 422
    r = director.post(f"/api/opportunities/{oid}/transitions",
                      json={"action": "request_changes", "comment": "Add the RFP compliance matrix to the scope."})
    assert r.status_code == 200 and r.json()["status"] == "changes_requested"

    # Presales must create a new version; version 1 stays frozen with the director's comments
    assert save(presales, oid, v1, complete_deepdive, 4).status_code in (403, 409)
    r = presales.post(f"/api/opportunities/{oid}/versions", json={"change_notes": "Added compliance matrix"})
    assert r.status_code == 201 and r.json()["version_number"] == 2 and r.json()["is_locked"] is False
    v2 = r.json()["id"]
    assert save(presales, oid, v2, {**complete_deepdive, "sow": complete_deepdive["sow"] + "\nRFP compliance matrix"}, 0).status_code == 200
    assert presales.post(f"/api/opportunities/{oid}/transitions", json={"action": "submit", "expected_version_id": v2}).status_code == 200

    director.post(f"/api/opportunities/{oid}/transitions", json={"action": "start_review"})
    r = director.post(f"/api/opportunities/{oid}/transitions", json={"action": "mark_ready_for_ai"})
    assert r.status_code == 200 and r.json()["status"] == "ready_for_ai"

    # AI analysis is started through the AI endpoint, so the run and its inputs are always recorded
    r = director.post(f"/api/opportunities/{oid}/transitions", json={"action": "start_ai_analysis"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "use_ai_endpoint"

    versions = presales.get(f"/api/opportunities/{oid}/versions").json()
    assert [v["version_number"] for v in versions] == [2, 1] and all(v["is_locked"] for v in versions)
    assert presales.get(f"/api/opportunities/{oid}/versions/{v1}").json()["data"]["sow"] == complete_deepdive["sow"]

    history = gm.get(f"/api/opportunities/{oid}/history").json()
    assert [h["action"] for h in history][::-1] == ["create", "submit", "start_review", "request_changes", "submit",
                                                     "start_review", "mark_ready_for_ai"]
    assert all(h["actor"] for h in history) and history[0]["version_number"] == 2

    with SessionLocal() as db:
        changes = db.execute(select(AuditLog).where(AuditLog.action == "opportunity.status_changed")).scalars().all()
        assert len(changes) == 6 and all(c.details["from"] and c.details["to"] for c in changes)
        kinds = {n.type for n in db.execute(select(Notification)).scalars()}
        assert {"opportunity.submitted", "review.changes_requested", "opportunity.ready_for_ai"} <= kinds

    dash = director.get("/api/dashboard/summary").json()
    assert next(c for c in dash["cards"] if c["key"] == "ready_for_ai")["value"] == 1
    assert next(c for c in dash["cards"] if c["key"] == "active")["value"] == 1


def test_duplicate_opportunity_number_rejected(org):
    create_opp(Api("presales_one"), "op-2026-777")
    r = Api("presales_two").post("/api/opportunities", json={"opportunity_number": "OP-2026-777", "title": "t", "account_name": "a"})
    assert r.status_code == 409


def test_presales_without_team_cannot_create(org):
    from tests.conftest import make_user
    make_user("loner", "presales_account")
    r = Api("loner").post("/api/opportunities", json={"opportunity_number": "OP-2026-9", "title": "t", "account_name": "a"})
    assert r.status_code == 422


def test_management_can_edit_and_open_versions(org, complete_deepdive):
    """A submitted version is locked for everyone; the owner, Manager and Director can all open a new one."""
    owner, manager, director = Api("presales_one"), Api("manager_one"), Api("director_one")
    opp = create_opp(owner, "OP-2026-000500")
    oid, v1 = opp["id"], opp["current_version_id"]

    # Management may edit an open version, like the owner
    assert save(manager, oid, v1, complete_deepdive, 0).status_code == 200
    assert manager.get(f"/api/opportunities/{oid}").json()["can_edit"] is True

    owner.post(f"/api/opportunities/{oid}/transitions", json={"action": "submit"})
    detail = owner.get(f"/api/opportunities/{oid}").json()
    assert detail["can_edit"] is False and detail["can_create_version"] is True
    for api in (owner, manager, director):
        assert api.get(f"/api/opportunities/{oid}").json()["can_edit"] is False, "a submitted version is locked for all"
        assert save(api, oid, v1, complete_deepdive, 1).status_code in (403, 409)

    # The Director opens a new version while it is in review: the reviewed version stays untouched
    r = director.post(f"/api/opportunities/{oid}/versions", json={"change_notes": "Director corrections"})
    assert r.status_code == 201 and r.json()["version_number"] == 2
    after = director.get(f"/api/opportunities/{oid}").json()
    assert after["status"] == "draft", "the opportunity reopens so work can continue"
    assert after["can_edit"] is True
    assert owner.get(f"/api/opportunities/{oid}/versions/{v1}").json()["data"]["sow"] == complete_deepdive["sow"]

    history = owner.get(f"/api/opportunities/{oid}/history").json()
    assert history[0]["action"] == "new_version" and history[0]["actor"]["username"] == "director_one"
    assert save(owner, oid, after["current_version_id"], {**complete_deepdive, "sow": "updated"}, 0).status_code == 200


def test_active_list_and_closing_an_opportunity(org, complete_deepdive):
    owner, manager = Api("presales_one"), Api("manager_one")
    opp = create_opp(owner, "OP-2026-000501")
    save(owner, opp["id"], opp["current_version_id"], complete_deepdive, 0)

    assert manager.get("/api/opportunities", params={"active": "1"}).json()["total"] == 1
    assert owner.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "complete"}).status_code == 403, \
        "only management closes an opportunity"

    r = manager.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "complete"})
    assert r.status_code == 200 and r.json()["status"] == "completed"
    assert manager.get("/api/opportunities", params={"active": "1"}).json()["total"] == 0, "it leaves the active list"
    assert manager.get("/api/opportunities").json()["total"] == 1, "but stays under all opportunities"
    assert next(c for c in manager.get("/api/dashboard/summary").json()["cards"] if c["key"] == "active")["value"] == 0

    assert manager.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "reopen"}).json()["status"] == "draft"
    assert manager.get("/api/opportunities", params={"active": "1"}).json()["total"] == 1


def test_support_needed_and_risks_both_appear(org, complete_deepdive):
    """The example DeepDive carries High priority support requests as well as High impact risks."""
    owner = Api("presales_one")
    opp = create_opp(owner, "OP-2026-000502")
    save(owner, opp["id"], opp["current_version_id"], complete_deepdive, 0)
    row = next(r for r in Api("gm").get("/api/dashboard/attention").json()["rows"] if r["attention_count"])
    assert row["support_count"] >= 2 and row["risk_count"] >= 1, row
    assert row["support"][0]["need"] and row["support"][0]["due_date"]
