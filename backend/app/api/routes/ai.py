"""AI analysis: trigger a run, follow its progress, read its results."""
import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import queue
from app.core.enums import AiRunStatus, OpportunityStatus
from app.core.errors import conflict, forbidden, not_found
from app.core.rbac import Perm
from app.api.deps import require
from app.db import get_db
from app.models import AiAnalysisRun, AiFinding, AiRecommendation, User
from app.services import audit, workflow
from app.services.access import can_view_ai, get_visible_opportunity, is_team_director

router = APIRouter(prefix="/opportunities/{opportunity_id}/ai", tags=["ai"])


def _run_summary(run: AiAnalysisRun, version_number: int | None, triggered_by: User | None) -> dict:
    return {
        "id": str(run.id), "status": run.status, "version_id": str(run.version_id), "version_number": version_number,
        "llm_model": run.llm_model, "embedding_model": run.embedding_model, "prompt_version": run.prompt_version,
        "schema_version": run.output_schema_version, "queued_at": run.queued_at, "started_at": run.started_at,
        "completed_at": run.completed_at, "error_message": run.error_message,
        "triggered_by": triggered_by.full_name if triggered_by else None,
        "warning_count": len(run.validation_errors or []),
    }


@router.post("/runs", status_code=202)
def start_run(opportunity_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
              user: User = Depends(require(Perm.AI_TRIGGER))):
    opp = get_visible_opportunity(db, user, opportunity_id, for_update=True)
    if not (is_team_director(user, opp) or user.role_key.value == "admin"):
        raise forbidden("AI analysis is started by the Presales Director of this team, or an Admin.")
    if opp.status != OpportunityStatus.READY_FOR_AI:
        raise conflict("The opportunity must be marked Ready for AI before analysis can run.", code="invalid_status")

    from app.ai.analysis import build_manifest

    version = opp.current_version
    run = AiAnalysisRun(opportunity_id=opp.id, version_id=version.id, triggered_by=user.id,
                        status=AiRunStatus.QUEUED, input_manifest=build_manifest(db, opp, version))
    db.add(run)
    db.flush()
    queue.enqueue(db, "analyze", run_id=run.id, opportunity_id=opp.id, version_id=version.id)
    workflow.transition(db, opp, "start_ai_analysis", user, request=request)
    audit.record(db, "ai.requested", actor=user, request=request, entity_type="ai_analysis_run", entity_id=run.id,
                 opportunity_id=opp.id, details={"version": version.version_number})
    db.commit()
    return _run_summary(run, version.version_number, user)


@router.get("/runs")
def list_runs(opportunity_id: uuid.UUID, version_id: uuid.UUID | None = None, db: Session = Depends(get_db),
              user: User = Depends(require(Perm.AI_VIEW))):
    """Analysis runs of one version. Defaults to the current one."""
    opp = get_visible_opportunity(db, user, opportunity_id)
    if not can_view_ai(user, opp):
        return []
    selected = version_id or opp.current_version_id
    runs = db.execute(select(AiAnalysisRun).where(AiAnalysisRun.opportunity_id == opp.id,
                                                  AiAnalysisRun.version_id == selected)
                      .order_by(AiAnalysisRun.queued_at.desc())).scalars().all()
    from app.models import OpportunityVersion

    numbers = {v.id: v.version_number for v in db.execute(
        select(OpportunityVersion).where(OpportunityVersion.opportunity_id == opp.id)).scalars()}
    return [_run_summary(r, numbers.get(r.version_id), db.get(User, r.triggered_by)) for r in runs]


@router.get("/runs/{run_id}")
def run_detail(opportunity_id: uuid.UUID, run_id: uuid.UUID, db: Session = Depends(get_db),
               user: User = Depends(require(Perm.AI_VIEW))):
    opp = get_visible_opportunity(db, user, opportunity_id)
    if not can_view_ai(user, opp):
        raise forbidden("AI results become visible to you once the analysis is complete.")
    run = db.get(AiAnalysisRun, run_id)
    if run is None or run.opportunity_id != opp.id:
        raise not_found("AI analysis run")
    from app.models import OpportunityVersion

    version = db.get(OpportunityVersion, run.version_id)
    findings = db.execute(select(AiFinding).where(AiFinding.run_id == run.id).order_by(AiFinding.ordinal)).scalars().all()
    recommendation = db.execute(select(AiRecommendation).where(AiRecommendation.run_id == run.id)).scalar_one_or_none()
    result = run.result_json or {}
    return {
        **_run_summary(run, version.version_number if version else None, db.get(User, run.triggered_by)),
        "input_manifest": run.input_manifest,
        "executive_summary": result.get("executive_summary"),
        "confidence": result.get("confidence"),
        "director_comment_analysis": result.get("director_comment_analysis", []),
        "validation_warnings": run.validation_errors or [],
        "findings": [{
            "id": str(f.id), "section": f.section, "category": f.category, "severity": f.severity,
            "evidence_class": f.evidence_class, "title": f.title, "finding": f.finding, "evidence": f.evidence,
            "business_impact": f.business_impact, "recommended_action": f.recommended_action,
            "suggested_owner": f.suggested_owner, "citations": f.citations,
        } for f in findings],
        "recommendation": None if recommendation is None else {
            "overall_readiness": recommendation.overall_readiness,
            "confidence": float(recommendation.confidence) if recommendation.confidence is not None else None,
            "readiness_areas": recommendation.readiness_areas,
            "required_actions": recommendation.required_actions,
            "missing_information": recommendation.missing_information,
            "management_recommendation": recommendation.management_recommendation,
        },
    }


@router.get("/citations/{chunk_id}")
def citation(opportunity_id: uuid.UUID, chunk_id: uuid.UUID, db: Session = Depends(get_db),
             user: User = Depends(require(Perm.AI_VIEW))):
    """The exact source text behind a finding, so a citation can be checked in one click."""
    opp = get_visible_opportunity(db, user, opportunity_id)
    from app.models import DocumentChunk

    chunk = db.get(DocumentChunk, chunk_id)
    if chunk is None or chunk.opportunity_id != opp.id:
        raise not_found("Source")
    return {"id": str(chunk.id), "location": chunk.location_label, "source_kind": chunk.source_kind,
            "document_name": chunk.document_name, "text": chunk.text[:6000],
            "document_id": str(chunk.document_id) if chunk.document_id else None}
