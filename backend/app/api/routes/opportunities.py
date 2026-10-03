import uuid
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from app.api.deps import current_user, require, require_any
from app.core.enums import AI_STATUS_LABELS, STATUS_LABELS, OpportunityStatus, RoleKey
from app.core.errors import conflict, not_found
from app.core.rbac import Perm
from app.db import get_db
from app.models import Opportunity, OpportunityDocument, OpportunityVersion, ReviewComment, Team, User, WorkflowHistory
from app.schemas.common import (DeepDiveSaveIn, HistoryItem, NewVersionIn, OpportunityCreateIn, OpportunityDetail,
                                OpportunityListItem, OpportunityUpdateIn, Page, TransitionIn, UserRef, VersionDetail,
                                VersionSummary)
from app.services import audit, workflow
from app.services.access import (ACTIVE_STATUSES, can_create_version, can_delete, can_edit_content, can_view_ai,
                                 get_visible_opportunity, scope_opportunities)
from app.services.opportunities import (archive_opportunity, create_opportunity, create_version, purge_opportunity,
                                        remove_opportunity, restore_opportunity, save_deepdive,
                                        update_master_fields)

router = APIRouter(prefix="/opportunities", tags=["opportunities"])
VIEW = require_any(Perm.OPP_VIEW_ALL, Perm.OPP_VIEW_TEAM, Perm.OPP_VIEW_OWN)


def ai_status(o: Opportunity) -> str:
    if o.status == OpportunityStatus.AI_ANALYSIS:
        return "processing"
    if o.status == OpportunityStatus.READY_FOR_AI:
        return "requested"
    return "completed" if o.ai_readiness else "not_analysed"


def list_item(o: Opportunity) -> dict:
    return dict(id=o.id, opportunity_number=o.opportunity_number, title=o.title, account_name=o.account_name,
                opportunity_type=o.opportunity_type, vertical=o.vertical,
                status=o.status, status_label=STATUS_LABELS[OpportunityStatus(o.status)], owner=UserRef.model_validate(o.owner),
                team_name=o.team.name if o.team else None,
                manager=UserRef.model_validate(o.manager) if o.manager else None,
                director=UserRef.model_validate(o.director) if o.director else None,
                ai_status=ai_status(o), ai_status_label=AI_STATUS_LABELS[ai_status(o)],
                current_version=o.current_version.version_number if o.current_version else None,
                ai_readiness=o.ai_readiness, has_critical_findings=o.has_critical_findings,
                created_at=o.created_at, updated_at=o.updated_at)


def filtered_query(user: User, *, q: str | None = None, account: str | None = None, number: str | None = None,
                   owner_id: uuid.UUID | None = None, director_id: uuid.UUID | None = None, status: list[str] | None = None,
                   ai_readiness: str | None = None, updated_from: date | None = None, updated_to: date | None = None,
                   critical: bool | None = None, open_comments: bool | None = None, archived: bool | None = None,
                   assigned_to_me: bool | None = None, active: bool | None = None):
    stmt = scope_opportunities(select(Opportunity).where(Opportunity.is_archived.is_(bool(archived))), user)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Opportunity.title.ilike(like), Opportunity.account_name.ilike(like),
                              Opportunity.opportunity_number.ilike(like)))
    if account:
        stmt = stmt.where(Opportunity.account_name.ilike(f"%{account.strip()}%"))
    if number:
        stmt = stmt.where(Opportunity.opportunity_number.ilike(f"%{number.strip()}%"))
    if owner_id:
        stmt = stmt.where(Opportunity.owner_id == owner_id)
    if director_id:
        stmt = stmt.where(Opportunity.team_id.in_(select(Team.id).where(Team.director_id == director_id)))
    if status:
        stmt = stmt.where(Opportunity.status.in_(status))
    if ai_readiness:
        stmt = stmt.where(Opportunity.ai_readiness.is_(None) if ai_readiness == "none" else Opportunity.ai_readiness == ai_readiness)
    if critical:
        stmt = stmt.where(Opportunity.has_critical_findings.is_(True))
    if active:
        stmt = stmt.where(Opportunity.status.in_([s.value for s in ACTIVE_STATUSES]))
    if assigned_to_me:
        stmt = stmt.where(or_(Opportunity.manager_id == user.id, Opportunity.director_id == user.id))
    if open_comments:
        from app.models import ReviewComment

        stmt = stmt.where(Opportunity.id.in_(select(ReviewComment.opportunity_id).where(ReviewComment.status == "open")))
    if updated_from:
        stmt = stmt.where(Opportunity.updated_at >= datetime.combine(updated_from, time.min))
    if updated_to:
        stmt = stmt.where(Opportunity.updated_at < datetime.combine(updated_to + timedelta(days=1), time.min))
    return stmt


@router.get("", response_model=Page[OpportunityListItem])
def list_opportunities(q: str | None = None, account: str | None = None, number: str | None = None,
                       owner_id: uuid.UUID | None = None, director_id: uuid.UUID | None = None,
                       status: list[str] | None = Query(None), ai_readiness: str | None = None,
                       updated_from: date | None = None, updated_to: date | None = None, critical: bool | None = None,
                       open_comments: bool | None = None, attention: bool | None = None, archived: bool | None = None,
                       assigned_to_me: bool | None = None, active: bool | None = None,
                       sort: str = Query("-updated_at", pattern=r"^-?(updated_at|created_at|opportunity_number|account_name|status)$"),
                       page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                       db: Session = Depends(get_db), user: User = Depends(VIEW)):
    stmt = filtered_query(user, q=q, account=account, number=number, owner_id=owner_id, director_id=director_id,
                          status=status, ai_readiness=ai_readiness, updated_from=updated_from, updated_to=updated_to,
                          critical=critical, open_comments=open_comments, archived=archived,
                          assigned_to_me=assigned_to_me, active=active)
    if attention:
        from app.services.support_risks import opportunities_needing_attention

        ids = [r["id"] for r in opportunities_needing_attention(db, user, limit=500)]
        stmt = stmt.where(Opportunity.id.in_(ids)) if ids else stmt.where(Opportunity.id.is_(None))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    col = getattr(Opportunity, sort.lstrip("-"))
    rows = db.execute(stmt.order_by(col.desc() if sort.startswith("-") else col.asc(), Opportunity.id)
                      .offset((page - 1) * page_size).limit(page_size)).unique().scalars().all()
    return Page(items=[OpportunityListItem(**list_item(o)) for o in rows], total=total, page=page, page_size=page_size)


@router.post("", response_model=OpportunityDetail, status_code=201)
def create(body: OpportunityCreateIn, request: Request, db: Session = Depends(get_db),
           user: User = Depends(require(Perm.OPP_CREATE))):
    opp = create_opportunity(db, user, body.opportunity_number, body.title, body.account_name, request,
                             opportunity_type=body.opportunity_type, vertical=body.vertical)
    db.commit()
    return _detail(db, user, get_visible_opportunity(db, user, opp.id))


def _detail(db: Session, user: User, opp: Opportunity) -> OpportunityDetail:
    version = opp.current_version
    document_count = db.scalar(select(func.count()).select_from(OpportunityDocument)
                               .where(OpportunityDocument.opportunity_id == opp.id,
                                      OpportunityDocument.deleted_at.is_(None))) or 0
    open_comments = db.scalar(select(func.count()).select_from(ReviewComment)
                              .where(ReviewComment.opportunity_id == opp.id, ReviewComment.status == "open")) or 0
    return OpportunityDetail(
        **list_item(opp), current_version_id=opp.current_version_id,
        can_edit=can_edit_content(user, opp, version),
        can_create_version=can_create_version(user, opp),
        can_view_ai=can_view_ai(user, opp), can_delete=can_delete(user, opp),
        is_archived=opp.is_archived,
        can_manage_documents=can_edit_content(user, opp, version),
        document_count=document_count, open_comments=open_comments,
        actions=workflow.available_actions(user, opp))


@router.patch("/{opportunity_id}", response_model=OpportunityDetail)
def update_master(opportunity_id: uuid.UUID, body: OpportunityUpdateIn, request: Request,
                  db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Master fields of the opportunity record (Overview), shared by every version."""
    opp = get_visible_opportunity(db, user, opportunity_id, for_update=True)
    update_master_fields(db, user, opp, body.model_dump(exclude_unset=True), request)
    db.commit()
    return _detail(db, user, opp)


@router.get("/{opportunity_id}", response_model=OpportunityDetail)
def detail(opportunity_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(VIEW)):
    return _detail(db, user, get_visible_opportunity(db, user, opportunity_id))


def _version_summary(v: OpportunityVersion, current_id: uuid.UUID | None) -> dict:
    return dict(id=v.id, version_number=v.version_number, change_notes=v.change_notes, is_locked=v.is_locked,
                revision=v.revision, created_at=v.created_at, updated_at=v.updated_at, submitted_at=v.submitted_at,
                locked_at=v.locked_at, created_by=UserRef.model_validate(v.creator), updated_by=UserRef.model_validate(v.updater),
                is_current=v.id == current_id)


@router.get("/{opportunity_id}/versions", response_model=list[VersionSummary])
def versions(opportunity_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(VIEW)):
    opp = get_visible_opportunity(db, user, opportunity_id)
    rows = db.execute(select(OpportunityVersion).where(OpportunityVersion.opportunity_id == opp.id)
                      .order_by(OpportunityVersion.version_number.desc())).unique().scalars().all()
    return [VersionSummary(**_version_summary(v, opp.current_version_id)) for v in rows]


def _get_version(db: Session, opp: Opportunity, version_id: uuid.UUID) -> OpportunityVersion:
    v = db.get(OpportunityVersion, version_id)
    if v is None or v.opportunity_id != opp.id:
        raise not_found("Version")
    return v


@router.get("/{opportunity_id}/versions/{version_id}", response_model=VersionDetail)
def version_detail(opportunity_id: uuid.UUID, version_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(VIEW)):
    opp = get_visible_opportunity(db, user, opportunity_id)
    v = _get_version(db, opp, version_id)
    return VersionDetail(**_version_summary(v, opp.current_version_id), data=v.deepdive.data)


@router.put("/{opportunity_id}/versions/{version_id}/deepdive", response_model=VersionSummary)
def save(opportunity_id: uuid.UUID, version_id: uuid.UUID, body: DeepDiveSaveIn, request: Request,
         db: Session = Depends(get_db), user: User = Depends(current_user)):
    opp = get_visible_opportunity(db, user, opportunity_id, for_update=True)
    v = _get_version(db, opp, version_id)
    save_deepdive(db, user, opp, v, body.data, body.revision, request)
    db.commit()
    return VersionSummary(**_version_summary(v, opp.current_version_id))


@router.post("/{opportunity_id}/versions", response_model=VersionSummary, status_code=201)
def new_version(opportunity_id: uuid.UUID, body: NewVersionIn, request: Request, db: Session = Depends(get_db),
                user: User = Depends(current_user)):
    opp = get_visible_opportunity(db, user, opportunity_id, for_update=True)
    v = create_version(db, user, opp, body.change_notes, request)
    db.commit()
    return VersionSummary(**_version_summary(v, opp.current_version_id))


@router.delete("/{opportunity_id}")
def delete(opportunity_id: uuid.UUID, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Deletes a draft that was never submitted; archives anything that has been submitted."""
    opp = get_visible_opportunity(db, user, opportunity_id, for_update=True)
    outcome = remove_opportunity(db, user, opp, request)
    db.commit()
    return {"outcome": outcome}


@router.post("/{opportunity_id}/archive", response_model=OpportunityDetail)
def archive(opportunity_id: uuid.UUID, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Soft archive: the opportunity leaves the active lists but keeps everything attached to it."""
    opp = get_visible_opportunity(db, user, opportunity_id, for_update=True)
    archive_opportunity(db, user, opp, request)
    db.commit()
    return _detail(db, user, opp)


@router.post("/{opportunity_id}/restore", response_model=OpportunityDetail)
def restore(opportunity_id: uuid.UUID, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    opp = get_visible_opportunity(db, user, opportunity_id, for_update=True)
    restore_opportunity(db, user, opp, request)
    db.commit()
    return _detail(db, user, opp)


@router.delete("/{opportunity_id}/purge", status_code=204)
def purge(opportunity_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
          user: User = Depends(require(Perm.USER_MANAGE))):
    """Admin only: removes an archived opportunity and everything attached to it, for good."""
    opp = get_visible_opportunity(db, user, opportunity_id, for_update=True)
    if not opp.is_archived:
        raise conflict("Archive the opportunity before purging it.", code="not_archived")
    purge_opportunity(db, user, opp, request)
    db.commit()


@router.get("/{opportunity_id}/history", response_model=list[HistoryItem])
def history(opportunity_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(VIEW)):
    opp = get_visible_opportunity(db, user, opportunity_id)
    V = aliased(OpportunityVersion)
    rows = db.execute(select(WorkflowHistory, V.version_number).outerjoin(V, V.id == WorkflowHistory.version_id)
                      .where(WorkflowHistory.opportunity_id == opp.id)
                      .order_by(WorkflowHistory.created_at.desc(), WorkflowHistory.id.desc())).unique().all()
    out = []
    for h, vnum in rows:
        out.append(HistoryItem(id=h.id, action=h.action, from_status=h.from_status, to_status=h.to_status,
                               from_label=STATUS_LABELS[OpportunityStatus(h.from_status)] if h.from_status else None,
                               to_label=STATUS_LABELS[OpportunityStatus(h.to_status)],
                               actor=UserRef.model_validate(h.actor) if h.actor else None, comment=h.comment,
                               version_number=vnum, created_at=h.created_at))
    return out


@router.post("/{opportunity_id}/transitions", response_model=OpportunityDetail)
def do_transition(opportunity_id: uuid.UUID, body: TransitionIn, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(current_user)):
    opp = get_visible_opportunity(db, user, opportunity_id, for_update=True)
    if body.action in ("start_ai_analysis", "ai_completed", "ai_failed"):
        raise conflict("Start AI analysis from the AI endpoint, which records the run and its inputs.",
                       code="use_ai_endpoint")
    workflow.transition(db, opp, body.action, user, comment=body.comment, expected_version_id=body.expected_version_id,
                        request=request)
    db.commit()
    db.expire_all()
    return _detail(db, user, get_visible_opportunity(db, user, opportunity_id))
