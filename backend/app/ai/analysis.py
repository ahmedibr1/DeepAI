"""Runs one AI analysis: gather sources, ask the model under a JSON schema, validate the grounding,
store immutable results, and move the opportunity forward.

Results are written while the run is still "running", because the database freezes a finished run.
"""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import ingest, prompts, retrieval, validation
from app.ai import settings as ai_settings
from app.ai.providers import EmbeddingProvider, LlmProvider
from app.ai.schema import AREA_KEYS, SCHEMA_VERSION, AnalysisResult, json_schema
from app.core.enums import AiRunStatus, OpportunityStatus, Readiness
from app.models import (AiAnalysisRun, AiFinding, AiRecommendation, Opportunity, OpportunityDocument,
                        OpportunityVersion, ReviewComment)
from app.services import workflow

READINESS_FROM_AREAS = {"red": Readiness.NOT_READY, "amber": Readiness.READY_WITH_ACTIONS, "green": Readiness.READY}


def build_manifest(db: Session, opp: Opportunity, version: OpportunityVersion) -> dict:
    documents = db.execute(select(OpportunityDocument).where(
        OpportunityDocument.opportunity_id == opp.id, OpportunityDocument.deleted_at.is_(None))).scalars().all()
    comments = db.execute(select(ReviewComment).where(ReviewComment.opportunity_id == opp.id)).scalars().all()
    return {
        "opportunity_number": opp.opportunity_number,
        "version_number": version.version_number,
        "deepdive_sha256": version.deepdive.content_sha256 if version.deepdive else None,
        "documents": [{"id": str(d.id), "file_name": d.file_name, "category": d.category, "sha256": d.sha256}
                      for d in documents],
        "review_comment_ids": [str(c.id) for c in comments],
        "frozen_at": datetime.now(UTC).isoformat(),
    }


def _context(db: Session, version: OpportunityVersion, embeddings: EmbeddingProvider, retrieval_cfg: dict | None = None,
             reranker=None) -> tuple[str, dict[str, str]]:
    """The whole DeepDive and every comment, plus the document passages that matter most for this DeepDive.

    retrieval_cfg is the AI Configuration → Retrieval section: top_k passages per query, the minimum vector
    similarity, and whether a reranker re-orders the candidates."""
    cfg = retrieval_cfg or {}
    top_k, min_score = int(cfg.get("top_k", 8)), cfg.get("min_score")
    use_rerank = bool(cfg.get("rerank")) and reranker is not None
    hits = retrieval.all_chunks(db, version.id, kinds=["deepdive", "review"], limit=400)
    data = version.deepdive.data if version.deepdive else {}
    queries = [
        str(data.get("sow") or ""), str(data.get("solution") or ""),
        " ".join(str(r.get("text", "")) for r in (data.get("requirements") or [])),
        "mandatory requirements compliance obligations",
        "deliverables scope of work exclusions",
        "integration interfaces dependencies migration",
        "service levels SLA support managed services warranty",
        "pricing payment terms budget bill of quantities",
        "security compliance data residency certification",
        "schedule milestones delivery dates penalties",
    ]
    seen: set[str] = set()
    for query in [q for q in queries if q.strip()]:
        # With a reranker, fetch a wider candidate set and let the cross-encoder pick the best top_k.
        found = retrieval.search(db, version.id, query[:2000], embeddings, limit=top_k * 3 if use_rerank else top_k,
                                 kinds=["document"], min_score=min_score)
        if use_rerank:
            found = retrieval.rerank(found, query[:2000], reranker, top_k)
        for hit in found:
            if hit.chunk_id not in seen:
                seen.add(hit.chunk_id)
                hits.append(hit)
    return retrieval.render_context(hits)


def _store(db: Session, run: AiAnalysisRun, result: AnalysisResult, report: validation.ValidationReport) -> None:
    ordinal = 0
    for section, items in (("critical_findings", result.critical_findings), ("deepdive_gaps", result.deepdive_gaps),
                           ("risk_analysis", result.risk_analysis)):
        for finding in items:
            db.add(AiFinding(
                run_id=run.id, section=section, category=finding.category[:60] or section,
                severity=finding.severity, evidence_class=finding.evidence_class, title=finding.title[:300],
                finding=finding.finding, evidence=finding.evidence, business_impact=finding.business_impact,
                recommended_action=finding.recommended_action, suggested_owner=finding.suggested_owner[:160],
                citations=[c.model_dump() for c in finding.citations], ordinal=ordinal,
            ))
            ordinal += 1
    for index, gap in enumerate(result.customer_requirement_gaps):
        db.add(AiFinding(
            run_id=run.id, section="customer_requirement_gaps", category=gap.coverage, severity=gap.severity,
            evidence_class="fact" if gap.citations else "ai_inference", title=gap.requirement[:300],
            finding=gap.explanation, evidence="", business_impact="", recommended_action="",
            citations=[c.model_dump() for c in gap.citations], ordinal=ordinal + index,
        ))
    db.add(AiRecommendation(
        run_id=run.id, overall_readiness=result.overall_readiness, confidence=result.confidence,
        readiness_areas={key: area.model_dump() for key, area in result.readiness_areas.items()},
        required_actions=[a.model_dump() for a in result.recommended_actions],
        missing_information=[m.model_dump() for m in result.missing_information],
        management_recommendation=result.management_recommendation,
    ))
    payload = result.model_dump()
    payload["validation"] = {"warnings": report.warnings, "downgraded": report.downgraded,
                             "dropped_citations": report.dropped_citations}
    db.flush()   # findings and the recommendation must land while the run is still "running"
    run.result_json = payload
    run.result_sha256 = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    run.validation_errors = report.warnings or None


def run_analysis(db: Session, run_id: UUID, embeddings: EmbeddingProvider, llm: LlmProvider,
                 reranker=None) -> AiAnalysisRun:
    run = db.get(AiAnalysisRun, run_id)
    version = db.get(OpportunityVersion, run.version_id)
    opp = db.get(Opportunity, run.opportunity_id)

    run.status = AiRunStatus.RUNNING
    run.started_at = datetime.now(UTC)
    run.llm_model = getattr(llm, "name", "unknown")
    run.embedding_model = getattr(embeddings, "name", "unknown")
    cfg = ai_settings.load(db)                   # what the admin set on AI Configuration, read once per run
    generation, retrieval_cfg = cfg["generation"], cfg["retrieval"]
    run.prompt_version = cfg["prompt_version"]
    run.output_schema_version = SCHEMA_VERSION
    db.flush()

    try:
        summary = ingest.ingest_version(db, version, embeddings)
        context, supplied = _context(db, version, embeddings, retrieval_cfg, reranker)
        if not supplied:
            raise RuntimeError("There is nothing to analyse for this version.")
        comment_ids = [c.field_path for c in []]  # comment ids are already embedded in the review chunks
        user_prompt = prompts.build_user_prompt(context)
        system = cfg["system_prompt"]
        temperature, max_tokens = generation["temperature"], generation["max_output_tokens"]
        raw, usage = llm.complete_json(system, user_prompt, json_schema(), temperature=temperature, max_tokens=max_tokens)

        try:
            result = AnalysisResult.model_validate(raw)
        except ValidationError as exc:               # one repair attempt, telling the model exactly what failed
            repair = (f"{user_prompt}\n\nYour previous answer did not match the schema:\n{exc.errors()[:8]}\n"
                      "Return corrected JSON only.")
            raw, usage = llm.complete_json(system, repair, json_schema(), temperature=0.0, max_tokens=max_tokens)
            result = AnalysisResult.model_validate(raw)

        for key in AREA_KEYS:                        # never present an area as green just because it was omitted
            result.readiness_areas.setdefault(key, result.technical_analysis.model_copy(
                update={"status": "amber", "summary": validation.phrase_for_absent_evidence(), "evidence": "", "citations": []}))

        report = validation.validate(result, supplied, ingest.corpus_entities(db, version.id))
        _store(db, run, result, report)
        run.parameters = {"ingest": summary, "context_chunks": len(supplied), "temperature": temperature,
                          "max_output_tokens": max_tokens, "comment_ids": comment_ids,
                          "retrieval": {**retrieval_cfg, "reranker": getattr(reranker, "name", None)
                                        if retrieval_cfg["rerank"] else None},
                          "prompt_is_default": cfg["prompt_is_default"]}
        run.tokens_in, run.tokens_out = usage.get("prompt_tokens"), usage.get("completion_tokens")
        run.completed_at = datetime.now(UTC)
        db.flush()
        run.status = AiRunStatus.SUCCEEDED      # freezes the run and its findings from here on
        db.flush()

        opp.ai_readiness = result.overall_readiness
        opp.has_critical_findings = any(f.severity == "critical" for f in result.critical_findings)
        if opp.status == OpportunityStatus.AI_ANALYSIS:
            workflow.transition(db, opp, "ai_completed", None)
    except Exception as exc:
        db.rollback()
        run = db.get(AiAnalysisRun, run_id)
        run.status = AiRunStatus.FAILED
        run.error_message = f"{exc.__class__.__name__}: {exc}"[:2000]
        run.completed_at = datetime.now(UTC)
        opp = db.get(Opportunity, run.opportunity_id)
        if opp.status == OpportunityStatus.AI_ANALYSIS:
            workflow.transition(db, opp, "ai_failed", None)
        db.commit()
        return run
    db.commit()
    return run
