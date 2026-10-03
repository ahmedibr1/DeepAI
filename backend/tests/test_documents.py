import io
import zipfile

from tests.conftest import Api, create_opp

PDF = b"%PDF-1.7\n" + b"0" * 200


def docx_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", "<w:document/>")
    return buf.getvalue()


def upload(api: Api, opp_id: str, name: str, data: bytes, category: str = "rfp"):
    return api.c.post(f"/api/opportunities/{opp_id}/documents", files={"file": (name, data, "application/octet-stream")},
                      data={"category": category}, headers=api._h())


def test_upload_list_download_and_replace(org):
    presales = Api("presales_one")
    opp = create_opp(presales, "OP-2026-100001")
    r = upload(presales, opp["id"], "RFP.pdf", PDF)
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["category"] == "rfp" and doc["doc_version"] == 1 and doc["size_bytes"] == len(PDF)
    assert doc["uploaded_by"]["username"] == "presales_one" and doc["can_delete"] is True

    assert upload(presales, opp["id"], "Scope.docx", docx_bytes(), "scope_of_work").status_code == 201
    listed = presales.get(f"/api/opportunities/{opp['id']}/documents").json()
    assert {d["file_name"] for d in listed} == {"RFP.pdf", "Scope.docx"}

    down = presales.get(f"/api/opportunities/{opp['id']}/documents/{doc['id']}/download")
    assert down.status_code == 200 and down.content == PDF
    assert "attachment" in down.headers["content-disposition"]

    # Re-uploading the same name supersedes it and keeps one active row
    again = upload(presales, opp["id"], "RFP.pdf", PDF + b"more")
    assert again.status_code == 201 and again.json()["doc_version"] == 2
    listed = presales.get(f"/api/opportunities/{opp['id']}/documents").json()
    assert len(listed) == 2 and [d for d in listed if d["file_name"] == "RFP.pdf"][0]["doc_version"] == 2


def test_file_type_and_content_are_validated(org):
    presales = Api("presales_one")
    opp = create_opp(presales, "OP-2026-100002")
    assert upload(presales, opp["id"], "tool.exe", b"MZ\x90\x00").status_code == 422
    renamed = upload(presales, opp["id"], "invoice.pdf", b"MZ\x90\x00not a pdf")
    assert renamed.status_code == 422 and "do not match" in renamed.text
    assert upload(presales, opp["id"], "empty.pdf", b"").status_code == 422
    assert upload(presales, opp["id"], "notes.txt", b"plain text is fine", "other").status_code == 201


def test_document_permissions_follow_the_opportunity(org, complete_deepdive):
    presales, director, gm, other = Api("presales_one"), Api("director_one"), Api("gm"), Api("presales_one_b")
    opp = create_opp(presales, "OP-2026-100003")
    doc = upload(presales, opp["id"], "RFP.pdf", PDF).json()

    assert other.get(f"/api/opportunities/{opp['id']}/documents").status_code == 404
    assert upload(other, opp["id"], "sneaky.pdf", PDF).status_code == 404
    assert upload(director, opp["id"], "director.pdf", PDF).status_code == 403
    assert director.get(f"/api/opportunities/{opp['id']}/documents/{doc['id']}/download").status_code == 200
    assert gm.get(f"/api/opportunities/{opp['id']}/documents").json()[0]["can_delete"] is False
    assert Api("manager_one").get(f"/api/opportunities/{opp['id']}/documents").status_code == 200

    # Owner may delete before submitting, but not after
    presales.put(f"/api/opportunities/{opp['id']}/versions/{opp['current_version_id']}/deepdive",
                 json={"data": complete_deepdive, "revision": 0})
    doc2 = upload(presales, opp["id"], "BoQ.xlsx", docx_bytes(), "boq").json()
    assert presales.c.delete(f"/api/opportunities/{opp['id']}/documents/{doc2['id']}", headers=presales._h()).status_code == 204
    presales.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "submit"})
    assert upload(presales, opp["id"], "late.pdf", PDF).status_code == 403
    assert presales.c.delete(f"/api/opportunities/{opp['id']}/documents/{doc['id']}", headers=presales._h()).status_code == 403
    assert director.get(f"/api/opportunities/{opp['id']}/documents").status_code == 200


def test_uploads_are_audited(org):
    presales = Api("presales_one")
    opp = create_opp(presales, "OP-2026-100004")
    upload(presales, opp["id"], "RFP.pdf", PDF)
    rows = Api("admin").get("/api/admin/audit-logs", params={"action": "document."}).json()["items"]
    assert rows[0]["action"] == "document.uploaded" and rows[0]["details"]["file_name"] == "RFP.pdf"
    assert rows[0]["details"]["sha256"]


def test_documents_belong_to_a_version_and_carry_forward(org, complete_deepdive):
    """v1 keeps what it was reviewed with; v2 starts from a copy and can diverge."""
    owner, director = Api("presales_one"), Api("director_one")
    opp = create_opp(owner, "OP-2026-100010")
    v1 = opp["current_version_id"]
    upload(owner, opp["id"], "RFP.pdf", PDF)
    upload(owner, opp["id"], "BoQ.xlsx", docx_bytes(), "boq")
    owner.put(f"/api/opportunities/{opp['id']}/versions/{v1}/deepdive", json={"data": complete_deepdive, "revision": 0})
    owner.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "submit"})

    created = director.post(f"/api/opportunities/{opp['id']}/versions", json={"change_notes": "Round two"})
    assert created.status_code == 201, created.text
    v2 = created.json()["id"]
    carried = owner.get(f"/api/opportunities/{opp['id']}/documents").json()
    assert {d["file_name"] for d in carried} == {"RFP.pdf", "BoQ.xlsx"}, "v2 starts with v1's documents"

    # Remove one from v2 and add another
    boq = next(d for d in carried if d["file_name"] == "BoQ.xlsx")
    assert owner.delete(f"/api/opportunities/{opp['id']}/documents/{boq['id']}").status_code == 204
    assert upload(owner, opp["id"], "Clarifications.txt", b"answers", "customer_clarification").status_code == 201

    in_v2 = {d["file_name"] for d in owner.get(f"/api/opportunities/{opp['id']}/documents").json()}
    in_v1 = {d["file_name"] for d in owner.get(f"/api/opportunities/{opp['id']}/documents", params={"version_id": v1}).json()}
    assert in_v2 == {"RFP.pdf", "Clarifications.txt"}
    assert in_v1 == {"RFP.pdf", "BoQ.xlsx"}, "the reviewed version is untouched"

    # An earlier version is read-only, and its documents still download
    old = owner.get(f"/api/opportunities/{opp['id']}/documents", params={"version_id": v1}).json()
    assert all(d["can_delete"] is False for d in old)
    rfp_v1 = next(d for d in old if d["file_name"] == "RFP.pdf")
    assert owner.get(f"/api/opportunities/{opp['id']}/documents/{rfp_v1['id']}/download").content == PDF
    assert v2  # the new version is the current one
