from tests.conftest import Api, create_opp


def submit(api: Api, opp, data):
    api.put(f"/api/opportunities/{opp['id']}/versions/{opp['current_version_id']}/deepdive", json={"data": data, "revision": 0})
    return api.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "submit"})


def test_director_comments_and_change_request(org, complete_deepdive):
    presales, director, gm = Api("presales_one"), Api("director_one"), Api("gm")
    opp = create_opp(presales, "OP-2026-200001")
    assert submit(presales, opp, complete_deepdive).status_code == 200
    director.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "start_review"})

    r = director.post(f"/api/opportunities/{opp['id']}/review/comments", json={
        "comment_type": "critical_issue", "section": "scope", "body": "The RFP compliance matrix is missing.",
        "priority": "critical", "owner_name": "Mohammed Rabie", "due_date": "2026-10-01"})
    assert r.status_code == 201, r.text
    comment = r.json()
    assert comment["version_number"] == 1 and comment["status"] == "open" and comment["can_manage"] is True

    # A required action needs a priority
    assert director.post(f"/api/opportunities/{opp['id']}/review/comments",
                         json={"comment_type": "required_action", "body": "Confirm deal registration."}).status_code == 422

    # Others may read, but not comment or edit
    assert presales.post(f"/api/opportunities/{opp['id']}/review/comments", json={"body": "ok"}).status_code == 403
    # All three management roles review in this phase
    assert gm.post(f"/api/opportunities/{opp['id']}/review/comments", json={"body": "GM note"}).status_code == 201
    assert Api("manager_one").post(f"/api/opportunities/{opp['id']}/review/comments",
                                   json={"body": "Manager note"}).status_code == 201
    assert presales.patch(f"/api/opportunities/{opp['id']}/review/comments/{comment['id']}",
                          json={"body": "changed"}).status_code == 403

    view = presales.get(f"/api/opportunities/{opp['id']}/review").json()
    assert view["open_count"] == 3 and view["can_comment"] is False
    assert any(c["body"] == "The RFP compliance matrix is missing." for c in view["comments"])
    assert all(c["can_manage"] is False for c in view["comments"])

    # The Director resolves their own comment and records the decision
    assert director.patch(f"/api/opportunities/{opp['id']}/review/comments/{comment['id']}",
                          json={"status": "addressed"}).json()["status"] == "addressed"
    r = director.post(f"/api/opportunities/{opp['id']}/transitions",
                      json={"action": "request_changes", "comment": "Add the compliance matrix and resubmit."})
    assert r.status_code == 200
    view = director.get(f"/api/opportunities/{opp['id']}/review").json()
    assert any(d["decision"] == "changes_requested" and d["version_number"] == 1 for d in view["decisions"])
    assert len(view["comments"]) == 4   # structured comment + GM and Manager notes + the decision summary


def test_comments_stay_with_their_version_and_close_when_ready(org, complete_deepdive):
    presales, director = Api("presales_one"), Api("director_one")
    opp = create_opp(presales, "OP-2026-200002")
    submit(presales, opp, complete_deepdive)
    director.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "start_review"})
    director.post(f"/api/opportunities/{opp['id']}/review/comments",
                  json={"comment_type": "missing_information", "body": "SLA targets are not stated."})
    director.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "request_changes", "comment": "See comments."})

    v2 = presales.post(f"/api/opportunities/{opp['id']}/versions", json={"change_notes": "Added SLA targets"}).json()
    presales.put(f"/api/opportunities/{opp['id']}/versions/{v2['id']}/deepdive", json={"data": complete_deepdive, "revision": 0})
    presales.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "submit"})
    director.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "start_review"})

    # The review tab follows the selected version: v2 is empty, v1 still holds its comments.
    current = director.get(f"/api/opportunities/{opp['id']}/review").json()
    assert current["comments"] == []
    v1_view = director.get(f"/api/opportunities/{opp['id']}/review", params={"version_id": opp["current_version_id"]}).json()
    assert {c["version_number"] for c in v1_view["comments"]} == {1}, "old comments stay attached to v1"
    assert v1_view["open_count"] >= 1

    director.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "mark_ready_for_ai"})
    after = director.get(f"/api/opportunities/{opp['id']}/review").json()
    assert after["decisions"][0]["decision"] == "ready_for_ai"


def test_high_priority_support_needs_a_date(org, complete_deepdive):
    """The management monitoring view sorts by date, so a High priority request must carry one."""
    from app.services.deepdive_validation import missing_fields

    undated = {**complete_deepdive, "support": [{"need": "Vendor quotation", "from": "Nutanix", "priority": "High", "date": ""}]}
    problems = missing_fields(undated)
    assert any("needed by" in p for p in problems), problems
    dated = {**complete_deepdive, "support": [{"need": "Vendor quotation", "from": "Nutanix", "priority": "High", "date": "2026-10-01"}]}
    assert not [p for p in missing_fields(dated) if "needed by" in p]
    medium = {**complete_deepdive, "support": [{"need": "Nice to have", "from": "x", "priority": "Medium", "date": ""}]}
    assert not [p for p in missing_fields(medium) if "needed by" in p], "only High priority needs a date"


def test_decisions_and_comments_record_the_reviewer_role(org, complete_deepdive):
    presales, manager = Api("presales_one"), Api("manager_one")
    opp = create_opp(presales, "OP-2026-200003")
    presales.put(f"/api/opportunities/{opp['id']}/versions/{opp['current_version_id']}/deepdive",
                 json={"data": complete_deepdive, "revision": 0})
    presales.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "submit"})
    manager.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "start_review"})
    manager.post(f"/api/opportunities/{opp['id']}/review/comments", json={"body": "Confirm the SLA."})
    manager.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "request_changes", "comment": "See comment."})

    view = presales.get(f"/api/opportunities/{opp['id']}/review").json()
    assert view["decisions"][0]["reviewer_role"] == "Portfolio Presales Manager"
    assert view["comments"][0]["created_by_role"] == "Portfolio Presales Manager"


def test_review_and_ai_are_read_per_version(org, complete_deepdive):
    """Selecting a version shows that version's review comments, and only the current one accepts new ones."""
    owner, manager = Api("presales_one"), Api("manager_one")
    opp = create_opp(owner, "OP-2026-200010")
    v1 = opp["current_version_id"]
    owner.put(f"/api/opportunities/{opp['id']}/versions/{v1}/deepdive", json={"data": complete_deepdive, "revision": 0})
    owner.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "submit"})
    manager.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "start_review"})
    manager.post(f"/api/opportunities/{opp['id']}/review/comments", json={"body": "Comment on v1"})
    manager.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "request_changes", "comment": "Please update."})

    v2 = owner.post(f"/api/opportunities/{opp['id']}/versions", json={"change_notes": "Updated"}).json()["id"]
    owner.put(f"/api/opportunities/{opp['id']}/versions/{v2}/deepdive", json={"data": complete_deepdive, "revision": 0})
    owner.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "submit"})
    manager.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "start_review"})
    manager.post(f"/api/opportunities/{opp['id']}/review/comments", json={"body": "Comment on v2"})

    current = manager.get(f"/api/opportunities/{opp['id']}/review").json()
    assert [c["body"] for c in current["comments"]] == ["Comment on v2"]
    assert current["version_id"] == v2 and current["can_comment"] is True

    old = manager.get(f"/api/opportunities/{opp['id']}/review", params={"version_id": v1}).json()
    assert {c["body"] for c in old["comments"]} == {"Comment on v1", "Please update."}
    assert old["can_comment"] is False, "an earlier version is read-only"
    assert old["decisions"][0]["decision"] == "changes_requested"

    assert manager.get(f"/api/opportunities/{opp['id']}/ai/runs", params={"version_id": v1}).json() == []
