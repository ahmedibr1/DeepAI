import io
import zipfile

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.ai import analysis, ingest, queue, retrieval
from app.ai.providers import DeterministicEmbeddings, ScriptedLlm
from app.ai.schema import NOT_FOUND
from app.db import SessionLocal, engine
from app.models import AiAnalysisRun, AiFinding, AiRecommendation, DocumentChunk, Opportunity, OpportunityVersion
from tests.conftest import Api, create_opp

RFP = ("4 Requirements\n"
       "4.2 Integration\nThe platform shall integrate with the existing SCADA system over OPC-UA.\n"
       "4.3 Data residency\nAll environmental data shall remain inside the Kingdom.\n"
       "4.4 Service levels\nThe supplier shall meet a 99.9% availability SLA with 24/7 support.\n"
       "5 Commercial\nThe ceiling budget for this scope is SAR 28,000,000.\n")


def area(status="green", summary="Looks fine.", citations=None):
    return {"status": status, "summary": summary, "evidence": "From the sources.", "citations": citations or []}


def good_answer(chunk_id: str) -> dict:
    return {
        "executive_summary": "The DeepDive covers the platform but omits the SLA obligation in the RFP.",
        "overall_readiness": "ready_with_actions",
        "confidence": 0.72,
        "critical_findings": [{
            "title": "SLA of 99.9% is not reflected in the DeepDive",
            "finding": "The RFP requires a 99.9% availability SLA with 24/7 support; the DeepDive does not mention it.",
            "category": "requirements", "severity": "critical", "evidence_class": "fact",
            "evidence": "RFP section 4.4", "business_impact": "Non-compliance may disqualify the bid.",
            "recommended_action": "Add the SLA commitment and confirm managed services cover 24/7.",
            "suggested_owner": "Mohammed Rabie",
            "citations": [{"chunk_id": chunk_id, "quote": "99.9% availability SLA"}],
        }],
        "deepdive_gaps": [],
        "customer_requirement_gaps": [{
            "requirement": "Integration with the existing SCADA system over OPC-UA",
            "coverage": "not_covered", "explanation": "No integration scope is described in the DeepDive.",
            "severity": "high", "citations": [{"chunk_id": chunk_id, "quote": "integrate with the existing SCADA"}],
        }],
        "director_comment_analysis": [],
        "technical_analysis": area("amber", "Integration scope is not described."),
        "commercial_analysis": area("amber", "Budget ceiling is stated in the RFP."),
        "partner_analysis": area("green", "Vendors are named with deal registration pending."),
        "risk_analysis": [],
        "missing_information": [{"item": "SLA and penalty regime", "why_it_matters": "Drives managed services pricing.",
                                 "where_to_get_it": "Customer clarification"}],
        "recommended_actions": [{"priority": "critical", "action": "Add the SLA commitment to the scope",
                                 "reason": "Required by the RFP", "owner": "Mohammed Rabie", "due": "", "source": "RFP 4.4"}],
        "management_recommendation": "Proceed once the SLA and integration scope are added; the budget ceiling is understood.",
        "readiness_areas": {},
    }


def prepare(org, complete_deepdive, with_document=True) -> str:
    """An opportunity at Ready for AI, with an RFP attached and a Director comment."""
    presales, director = Api("presales_one"), Api("director_one")
    opp = create_opp(presales, "OP-2026-300001")
    if with_document:
        presales.c.post(f"/api/opportunities/{opp['id']}/documents",
                        files={"file": ("RFP.txt", RFP.encode(), "text/plain")},
                        data={"category": "rfp"}, headers=presales._h())
    presales.put(f"/api/opportunities/{opp['id']}/versions/{opp['current_version_id']}/deepdive",
                 json={"data": complete_deepdive, "revision": 0})
    presales.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "submit"})
    director.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "start_review"})
    director.post(f"/api/opportunities/{opp['id']}/review/comments",
                  json={"comment_type": "missing_information", "body": "Confirm the SLA the customer expects."})
    director.post(f"/api/opportunities/{opp['id']}/transitions", json={"action": "mark_ready_for_ai"})
    return opp["id"]


def ingest_only(opp_id: str):
    with SessionLocal() as db:
        opp = db.get(Opportunity, opp_id)
        version = db.get(OpportunityVersion, opp.current_version_id)
        summary = ingest.ingest_version(db, version, DeterministicEmbeddings())
        db.commit()
        return summary, version.id


def test_ingestion_indexes_all_three_sources_with_provenance(org, complete_deepdive):
    opp_id = prepare(org, complete_deepdive)
    summary, version_id = ingest_only(opp_id)
    assert summary["chunks"]["document"] >= 1 and summary["chunks"]["deepdive"] > 50 and summary["chunks"]["review"] == 1
    with SessionLocal() as db:
        chunks = db.execute(select(DocumentChunk).where(DocumentChunk.version_id == version_id)).scalars().all()
        doc_chunks = [c for c in chunks if c.source_kind == "document"]
        assert all(c.embedding is not None for c in chunks)
        assert any("Section 4" in (c.location_label or "") for c in doc_chunks), "section numbers are kept for citations"
        assert all(c.location_label.startswith("RFP.txt") for c in doc_chunks)
        hits = retrieval.search(db, version_id, "availability SLA support", DeterministicEmbeddings(), kinds=["document"])
        assert hits and "99.9%" in hits[0].text


def test_retrieval_never_crosses_opportunities(org, complete_deepdive):
    first = prepare(org, complete_deepdive)
    _, version_one = ingest_only(first)
    other = create_opp(Api("presales_two"), "OP-2026-300002")
    with SessionLocal() as db:
        version_two = db.get(Opportunity, other["id"]).current_version_id
        assert retrieval.all_chunks(db, version_two) == []
        hits = retrieval.search(db, version_two, "SLA", DeterministicEmbeddings())
        assert hits == []
        assert retrieval.all_chunks(db, version_one)


def test_full_run_stores_grounded_results_and_advances_workflow(org, complete_deepdive):
    opp_id = prepare(org, complete_deepdive)
    _, version_id = ingest_only(opp_id)
    with SessionLocal() as db:
        chunk = db.execute(select(DocumentChunk).where(
            DocumentChunk.version_id == version_id, DocumentChunk.source_kind == "document",
            DocumentChunk.text.contains("99.9%"))).scalars().first()
        chunk_id = str(chunk.id)   # the chunk that actually states the SLA

    director = Api("director_one")
    started = director.post(f"/api/opportunities/{opp_id}/ai/runs")
    assert started.status_code == 202, started.text
    run_id = started.json()["id"]
    assert director.get(f"/api/opportunities/{opp_id}").json()["status"] == "ai_analysis"

    llm = ScriptedLlm(good_answer(chunk_id))
    with SessionLocal() as db:
        job = queue.claim(db)
        assert job is not None and job.kind == "analyze"
        analysis.run_analysis(db, job.run_id, DeterministicEmbeddings(), llm)

    system, user = llm.calls[0]
    assert "CROSS-CHECK" in system and NOT_FOUND in system
    assert "=== C. CUSTOMER DOCUMENTS ===" in user and "Director comment" in user

    detail = director.get(f"/api/opportunities/{opp_id}/ai/runs/{run_id}").json()
    assert detail["status"] == "succeeded", detail.get("error_message") and detail["recommendation"]["overall_readiness"] == "ready_with_actions"
    assert len(detail["recommendation"]["readiness_areas"]) == 8, "every readiness area is reported"
    critical = [f for f in detail["findings"] if f["severity"] == "critical"][0]
    assert critical["evidence_class"] == "fact" and critical["citations"][0]["chunk_id"] == chunk_id

    cited = director.get(f"/api/opportunities/{opp_id}/ai/citations/{chunk_id}").json()
    assert "99.9%" in cited["text"] and cited["location"].startswith("RFP.txt")

    opp = director.get(f"/api/opportunities/{opp_id}").json()
    assert opp["status"] == "ai_recommendations" and opp["ai_readiness"] == "ready_with_actions"
    assert opp["has_critical_findings"] is True

    # Results are frozen once the run finishes
    with pytest.raises(DBAPIError):
        with engine.begin() as conn:
            conn.execute(text("UPDATE ai_analysis_runs SET result_json = '{}'::jsonb WHERE id = :i"), {"i": run_id})
    with pytest.raises(DBAPIError):
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM ai_findings WHERE run_id = :i"), {"i": run_id})


def test_invented_numbers_and_unknown_citations_are_caught(org, complete_deepdive):
    opp_id = prepare(org, complete_deepdive)
    ingest_only(opp_id)
    answer = good_answer("00000000-0000-0000-0000-000000000000")
    answer["critical_findings"][0]["finding"] = "The customer budget is SAR 99,750,000 and the deadline is 14/02/2027."
    Api("director_one").post(f"/api/opportunities/{opp_id}/ai/runs")
    with SessionLocal() as db:
        job = queue.claim(db)
        analysis.run_analysis(db, job.run_id, DeterministicEmbeddings(), ScriptedLlm(answer))

    detail = Api("director_one").get(f"/api/opportunities/{opp_id}/ai/runs/{[r['id'] for r in Api('director_one').get(f'/api/opportunities/{opp_id}/ai/runs').json()][0]}").json()
    kinds = {w["kind"] for w in detail["validation_warnings"]}
    assert "unknown_citation" in kinds and "unsupported_number" in kinds and "unsupported_date" in kinds
    finding = detail["findings"][0]
    assert finding["evidence_class"] == "ai_inference", "an unsupported claim cannot stay a fact"
    assert finding["citations"] == []


def test_ai_permissions(org, complete_deepdive):
    opp_id = prepare(org, complete_deepdive)
    assert Api("presales_one").post(f"/api/opportunities/{opp_id}/ai/runs").status_code == 403
    # Management roles all trigger AI in this phase; Presales Account never does
    assert Api("gm").post(f"/api/opportunities/{opp_id}/ai/runs").status_code == 202
    # A second request while one is running is refused
    assert Api("manager_one").post(f"/api/opportunities/{opp_id}/ai/runs").status_code == 409
    # The owner follows the status and reads the result, but cannot start a run
    runs = Api("admin").get(f"/api/opportunities/{opp_id}/ai/runs").json()
    assert Api("presales_one").get(f"/api/opportunities/{opp_id}/ai/runs/{runs[0]['id']}").status_code == 200


def test_failed_run_returns_the_opportunity_to_ready_for_ai(org, complete_deepdive):
    opp_id = prepare(org, complete_deepdive)
    Api("director_one").post(f"/api/opportunities/{opp_id}/ai/runs")

    def explode(_prompt):
        raise RuntimeError("model endpoint unreachable")

    with SessionLocal() as db:
        job = queue.claim(db)
        run = analysis.run_analysis(db, job.run_id, DeterministicEmbeddings(), ScriptedLlm(explode))
    assert run.status == "failed" and "unreachable" in run.error_message
    assert Api("director_one").get(f"/api/opportunities/{opp_id}").json()["status"] == "ready_for_ai"


def test_extraction_reports_pages_without_text(org):
    from app.ai.extraction import extract

    empty_docx = io.BytesIO()
    with zipfile.ZipFile(empty_docx, "w") as z:
        z.writestr("not-a-document.xml", "<x/>")
    empty_docx.seek(0)
    result = extract("docx", empty_docx)
    assert result.warnings and not result.blocks
    assert extract("msg", io.BytesIO(b"x")).warnings[0].startswith("Outlook")


def test_demo_analyst_produces_a_grounded_result_without_a_model(org, complete_deepdive):
    """The rule-based demo analyst must still obey the grounding rules."""
    from app.ai.demo_llm import DemoLlm

    opp_id = prepare(org, complete_deepdive)
    Api("director_one").post(f"/api/opportunities/{opp_id}/ai/runs")
    with SessionLocal() as db:
        job = queue.claim(db)
        run = analysis.run_analysis(db, job.run_id, DeterministicEmbeddings(), DemoLlm())
    assert run.status == "succeeded", run.error_message

    detail = Api("director_one").get(f"/api/opportunities/{opp_id}/ai/runs/{run.id}").json()
    assert detail["recommendation"]["overall_readiness"] in ("ready", "ready_with_actions", "not_ready")
    assert detail["findings"], "the demo analyst finds the uncovered RFP requirements"
    for finding in detail["findings"]:
        if finding["evidence_class"] == "fact":
            assert finding["citations"], "a fact must cite a source"
    assert not [w for w in detail["validation_warnings"] if w["kind"] == "unknown_citation"]
    assert "demo analyst" in detail["recommendation"]["management_recommendation"]


CUSTOM_PROMPT = ("You are a careful presales analyst. Cross-check the DeepDive against the customer documents and "
                 "cite every finding. Say \"Not found\" rather than guessing.")


def test_ai_configuration_drives_the_analysis(org, complete_deepdive):
    """The prompt, generation and retrieval settings saved on AI Configuration are what the run actually uses."""
    admin = Api("admin")
    page = admin.get("/api/admin/ai-settings")
    assert page.status_code == 200, page.text
    assert page.json()["llm_model"] and page.json()["retrieval"]["top_k"] == 12
    saved = admin.put("/api/admin/ai-settings", json={
        "system_prompt": CUSTOM_PROMPT,
        "generation": {"temperature": 0.5, "max_output_tokens": 3000},
        "retrieval": {"top_k": 3, "min_score": 0.1, "rerank": False},
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["prompt_version"].startswith("custom-")

    opp_id = prepare(org, complete_deepdive)
    _, version_id = ingest_only(opp_id)
    with SessionLocal() as db:
        chunk_id = str(db.execute(select(DocumentChunk).where(
            DocumentChunk.version_id == version_id, DocumentChunk.text.contains("99.9%"))).scalars().first().id)
    Api("director_one").post(f"/api/opportunities/{opp_id}/ai/runs")
    llm = ScriptedLlm(good_answer(chunk_id))
    with SessionLocal() as db:
        job = queue.claim(db)
        run = analysis.run_analysis(db, job.run_id, DeterministicEmbeddings(), llm)
        assert run.status == "succeeded", run.error_message
        assert llm.calls[0][0] == CUSTOM_PROMPT, "the edited system prompt is sent to the model"
        assert run.prompt_version.startswith("custom-")
        assert run.parameters["temperature"] == 0.5 and run.parameters["max_output_tokens"] == 3000
        assert run.parameters["retrieval"]["top_k"] == 3 and run.parameters["retrieval"]["min_score"] == 0.1


def test_settings_are_clamped_to_usable_values(org):
    admin = Api("admin")
    saved = admin.put("/api/admin/ai-settings", json={
        "generation": {"temperature": 7, "max_output_tokens": "lots"}, "retrieval": {"top_k": 0, "min_score": -3}})
    assert saved.status_code == 200, saved.text
    data = saved.json()
    assert data["generation"]["temperature"] == 1.0 and data["generation"]["max_output_tokens"] == 4000
    assert data["retrieval"]["top_k"] == 1 and data["retrieval"]["min_score"] == 0.0


def test_min_score_drops_weak_vector_matches(org, complete_deepdive):
    opp_id = prepare(org, complete_deepdive)
    _, version_id = ingest_only(opp_id)
    with SessionLocal() as db:
        loose = retrieval.search(db, version_id, "orchestra violin concert", DeterministicEmbeddings(), kinds=["document"])
        strict = retrieval.search(db, version_id, "orchestra violin concert", DeterministicEmbeddings(),
                                  kinds=["document"], min_score=0.99)
        assert loose, "without a threshold the nearest chunks always come back"
        assert strict == [], "an unrelated query returns nothing once weak matches are dropped"
        kept = retrieval.search(db, version_id, "availability SLA", DeterministicEmbeddings(),
                                kinds=["document"], min_score=0.99)
        assert kept and "99.9%" in kept[0].text, "exact keyword matches survive the threshold"


class FakeReranker:
    name = "fake-reranker"

    def __init__(self):
        self.queries: list[str] = []

    def rerank(self, query: str, documents: list[str]) -> list[float]:
        self.queries.append(query)
        return [1.0 if "99.9%" in d else 0.1 for d in documents]


def test_rerank_setting_uses_the_reranker(org, complete_deepdive):
    Api("admin").put("/api/admin/ai-settings", json={"retrieval": {"top_k": 2, "rerank": True}})
    opp_id = prepare(org, complete_deepdive)
    _, version_id = ingest_only(opp_id)
    with SessionLocal() as db:
        chunk_id = str(db.execute(select(DocumentChunk).where(
            DocumentChunk.version_id == version_id, DocumentChunk.text.contains("99.9%"))).scalars().first().id)
    Api("director_one").post(f"/api/opportunities/{opp_id}/ai/runs")
    reranker = FakeReranker()
    with SessionLocal() as db:
        job = queue.claim(db)
        run = analysis.run_analysis(db, job.run_id, DeterministicEmbeddings(), ScriptedLlm(good_answer(chunk_id)), reranker)
        assert run.status == "succeeded", run.error_message
        assert reranker.queries, "every retrieval query goes through the reranker"
        assert run.parameters["retrieval"]["reranker"] == "fake-reranker"
