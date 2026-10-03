"""Director review: structured comments on a DeepDive version."""
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user, require
from app.core.enums import ROLE_LABELS, CommentType, Priority
from app.core.errors import forbidden, not_found, unprocessable
from app.core.rbac import Perm
from app.db import get_db
from app.models import DirectorReview, Opportunity, OpportunityVersion, ReviewComment, User
from app.schemas.common import CommentCreateIn, CommentOut, CommentUpdateIn, ReviewOut
from app.services import audit
from app.services.access import get_visible_opportunity, is_team_director
from app.services.notifications import notify

router = APIRouter(prefix="/opportunities/{opportunity_id}", tags=["reviews"])


def _comment_out(c: ReviewComment, version_number: int | None, author: User, can_manage: bool) -> CommentOut:
    return CommentOut(
        id=c.id, comment_type=c.comment_type, section=c.section, body=c.body, priority=c.priority,
        owner_name=c.owner_name, due_date=c.due_date, status=c.status, created_at=c.created_at,
        created_by_role=ROLE_LABELS[author.role_key],
        updated_at=c.updated_at, resolved_at=c.resolved_at, created_by=author, version_id=c.version_id,
        version_number=version_number, can_manage=can_manage,
    )


def _review_for(db: Session, opp: Opportunity, reviewer_id: uuid.UUID, version_id: uuid.UUID) -> DirectorReview:
    review = db.execute(select(DirectorReview).where(
        DirectorReview.version_id == version_id, DirectorReview.reviewer_id == reviewer_id)).scalar_one_or_none()
    if review is None:
        review = DirectorReview(opportunity_id=opp.id, version_id=version_id, reviewer_id=reviewer_id)
        db.add(review)
        db.flush()
    return review


@router.get("/review", response_model=ReviewOut)
def get_review(opportunity_id: uuid.UUID, version_id: uuid.UUID | None = None, db: Session = Depends(get_db),
               user: User = Depends(require(Perm.REVIEW_VIEW))):
    """The review of one version: its comments and the decision recorded on it. Defaults to the current version."""
    opp = get_visible_opportunity(db, user, opportunity_id)
    selected = version_id or opp.current_version_id
    # Comments are written on the version being reviewed, so only the current one accepts new ones.
    can_manage = is_team_director(user, opp) and selected == opp.current_version_id
    versions = {v.id: v.version_number for v in db.execute(
        select(OpportunityVersion).where(OpportunityVersion.opportunity_id == opp.id)).scalars()}
    comments = db.execute(select(ReviewComment).where(ReviewComment.opportunity_id == opp.id,
                                                      ReviewComment.version_id == selected)
                          .order_by(ReviewComment.created_at.desc())).scalars().all()
    reviews = db.execute(select(DirectorReview).where(DirectorReview.opportunity_id == opp.id,
                                                      DirectorReview.version_id == selected)
                         .order_by(DirectorReview.created_at.desc())).scalars().all()
    return ReviewOut(
        can_comment=can_manage,
        current_version_id=opp.current_version_id,
        version_id=selected,
        open_count=sum(1 for c in comments if c.status == "open"),
        decisions=[{"version_id": str(r.version_id), "version_number": versions.get(r.version_id),
                    "reviewer": db.get(User, r.reviewer_id).full_name,
                    "reviewer_role": ROLE_LABELS[db.get(User, r.reviewer_id).role_key], "decision": r.decision,
                    "decided_at": r.decided_at.isoformat() if r.decided_at else None, "summary": r.summary}
                   for r in reviews],
        comments=[_comment_out(c, versions.get(c.version_id), db.get(User, c.created_by), can_manage) for c in comments],
    )


@router.post("/review/comments", response_model=CommentOut, status_code=201)
def add_comment(opportunity_id: uuid.UUID, body: CommentCreateIn, request: Request,
                db: Session = Depends(get_db), user: User = Depends(require(Perm.REVIEW_COMMENT))):
    opp = get_visible_opportunity(db, user, opportunity_id)
    if not is_team_director(user, opp):
        raise forbidden("Only the Presales Director of this team can add review comments.")
    version_id = body.version_id or opp.current_version_id
    version = db.get(OpportunityVersion, version_id)
    if version is None or version.opportunity_id != opp.id:
        raise not_found("Version")
    if body.comment_type in (CommentType.REQUIRED_ACTION, CommentType.CRITICAL_ISSUE) and not body.priority:
        raise unprocessable("Set a priority for a required action or critical issue.")
    review = _review_for(db, opp, user.id, version_id)
    comment = ReviewComment(
        review_id=review.id, opportunity_id=opp.id, version_id=version_id, comment_type=body.comment_type,
        section=body.section, body=body.body.strip(), priority=body.priority, owner_name=body.owner_name,
        due_date=body.due_date, created_by=user.id,
    )
    db.add(comment)
    db.flush()
    audit.record(db, "review.comment_added", actor=user, request=request, entity_type="review_comment",
                 entity_id=comment.id, opportunity_id=opp.id,
                 details={"type": body.comment_type, "section": body.section, "priority": body.priority})
    notify(db, [opp.owner_id], "review.comment", f"New review comment: {opp.title}",
           body=comment.body[:300], opportunity_id=opp.id)
    db.commit()
    db.refresh(comment)
    return _comment_out(comment, version.version_number, user, True)


@router.patch("/review/comments/{comment_id}", response_model=CommentOut)
def update_comment(opportunity_id: uuid.UUID, comment_id: uuid.UUID, body: CommentUpdateIn, request: Request,
                   db: Session = Depends(get_db), user: User = Depends(require(Perm.REVIEW_COMMENT))):
    opp = get_visible_opportunity(db, user, opportunity_id)
    comment = db.get(ReviewComment, comment_id)
    if comment is None or comment.opportunity_id != opp.id:
        raise not_found("Comment")
    if comment.created_by != user.id:
        raise forbidden("Only the author can change a review comment.")
    changes: dict = {}
    for field in ("body", "priority", "owner_name", "due_date", "section"):
        value = getattr(body, field)
        if value is not None:
            setattr(comment, field, value.strip() if isinstance(value, str) else value)
            changes[field] = str(value)
    if body.status is not None:
        if body.status not in ("open", "addressed", "closed"):
            raise unprocessable("Unknown comment status.")
        comment.status = body.status
        comment.resolved_at = datetime.now(UTC) if body.status != "open" else None
        changes["status"] = body.status
    audit.record(db, "review.comment_updated", actor=user, request=request, entity_type="review_comment",
                 entity_id=comment.id, opportunity_id=opp.id, details=changes)
    db.commit()
    db.refresh(comment)
    version = db.get(OpportunityVersion, comment.version_id)
    return _comment_out(comment, version.version_number if version else None, user, True)


@router.delete("/review/comments/{comment_id}", status_code=204)
def delete_comment(opportunity_id: uuid.UUID, comment_id: uuid.UUID, request: Request,
                   db: Session = Depends(get_db), user: User = Depends(require(Perm.REVIEW_COMMENT))):
    opp = get_visible_opportunity(db, user, opportunity_id)
    comment = db.get(ReviewComment, comment_id)
    if comment is None or comment.opportunity_id != opp.id:
        raise not_found("Comment")
    if comment.created_by != user.id:
        raise forbidden("Only the author can remove a review comment.")
    db.delete(comment)
    audit.record(db, "review.comment_deleted", actor=user, request=request, entity_type="review_comment",
                 entity_id=comment_id, opportunity_id=opp.id)
    db.commit()


@router.get("/review/sections", include_in_schema=False)
def sections(opportunity_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_visible_opportunity(db, user, opportunity_id)
    return {"comment_types": [t.value for t in CommentType], "priorities": [p.value for p in Priority]}
