"""Director review and comments.

A review belongs to one opportunity version, so comments always refer to exactly what was reviewed.
Comments are written by the reviewing Director; everyone who can see the opportunity can read them.
Nobody can edit somebody else's comment, and comments on a decided review stay as they were.
"""
import uuid
from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import CommentType, Priority, RoleKey
from app.core.errors import conflict, forbidden, not_found, unprocessable
from app.models import DirectorReview, Opportunity, OpportunityVersion, ReviewComment, User
from app.services import audit
from app.services.access import is_team_director

OPEN_STATUSES = {"open", "addressed", "closed"}


def get_or_create_review(db: Session, opp: Opportunity, version: OpportunityVersion, reviewer: User) -> DirectorReview:
    review = db.execute(select(DirectorReview).where(DirectorReview.version_id == version.id,
                                                     DirectorReview.reviewer_id == reviewer.id)).scalar_one_or_none()
    if review is None:
        review = DirectorReview(opportunity_id=opp.id, version_id=version.id, reviewer_id=reviewer.id)
        db.add(review)
        db.flush()
    return review


def reviews_for(db: Session, opp: Opportunity) -> list[DirectorReview]:
    return list(db.execute(select(DirectorReview).where(DirectorReview.opportunity_id == opp.id)
                           .order_by(DirectorReview.created_at)).scalars())


def comments_for(db: Session, opp: Opportunity, version_id: uuid.UUID | None = None) -> list[ReviewComment]:
    stmt = select(ReviewComment).where(ReviewComment.opportunity_id == opp.id)
    if version_id:
        stmt = stmt.where(ReviewComment.version_id == version_id)
    return list(db.execute(stmt.order_by(ReviewComment.created_at)).scalars())


def _require_reviewer(user: User, opp: Opportunity) -> None:
    if not (is_team_director(user, opp) or user.role_key == RoleKey.ADMIN):
        raise forbidden("Only the Presales Director of this team can review this opportunity.")


def add_comment(db: Session, user: User, opp: Opportunity, version: OpportunityVersion, body: dict,
                request: Request) -> ReviewComment:
    _require_reviewer(user, opp)
    if version.id != opp.current_version_id:
        raise conflict("Comments are added to the version under review.", code="not_current_version")
    text = str(body.get("body") or "").strip()
    if not text:
        raise unprocessable("Write the comment before saving it.")
    comment_type = body.get("comment_type") or CommentType.GENERAL
    if comment_type not in set(CommentType):
        raise unprocessable("Unknown comment type.")
    priority = body.get("priority")
    if priority is not None and priority not in set(Priority):
        raise unprocessable("Unknown priority.")
    if comment_type in (CommentType.CRITICAL_ISSUE, CommentType.REQUIRED_ACTION) and not priority:
        priority = Priority.HIGH if comment_type == CommentType.CRITICAL_ISSUE else Priority.MEDIUM

    review = get_or_create_review(db, opp, version, user)
    comment = ReviewComment(
        review_id=review.id, opportunity_id=opp.id, version_id=version.id, comment_type=comment_type,
        section=(body.get("section") or None), body=text[:5000], priority=priority,
        owner_name=(body.get("owner_name") or None), owner_user_id=body.get("owner_user_id"),
        due_date=body.get("due_date"), created_by=user.id)
    db.add(comment)
    db.flush()
    audit.record(db, "review.comment_added", actor=user, request=request, entity_type="review_comment",
                 entity_id=comment.id, opportunity_id=opp.id,
                 details={"type": str(comment_type), "priority": priority, "version": version.version_number})
    return comment


def update_comment(db: Session, user: User, opp: Opportunity, comment: ReviewComment, body: dict,
                   request: Request) -> ReviewComment:
    if comment.created_by != user.id:
        raise forbidden("You can only change your own comments.")
    review = db.get(DirectorReview, comment.review_id)
    if review and review.decided_at and any(k in body for k in ("body", "priority", "comment_type", "section")):
        raise conflict("This review was already submitted. Its comments stay as they were; add a new comment instead.",
                       code="review_decided")
    changes: dict = {}
    if "body" in body and str(body["body"]).strip():
        comment.body = str(body["body"]).strip()[:5000]; changes["body"] = True
    for field in ("priority", "section", "owner_name", "due_date"):
        if field in body:
            setattr(comment, field, body[field] or None); changes[field] = body[field]
    if "status" in body:
        if body["status"] not in OPEN_STATUSES:
            raise unprocessable("Unknown status.")
        comment.status = body["status"]
        comment.resolved_at = datetime.now(UTC) if body["status"] != "open" else None
        changes["status"] = body["status"]
    audit.record(db, "review.comment_updated", actor=user, request=request, entity_type="review_comment",
                 entity_id=comment.id, opportunity_id=opp.id, details=changes)
    return comment


def delete_comment(db: Session, user: User, opp: Opportunity, comment: ReviewComment, request: Request) -> None:
    if comment.created_by != user.id:
        raise forbidden("You can only delete your own comments.")
    review = db.get(DirectorReview, comment.review_id)
    if review and review.decided_at:
        raise conflict("This review was already submitted, so its comments are kept.", code="review_decided")
    db.delete(comment)
    audit.record(db, "review.comment_deleted", actor=user, request=request, entity_type="review_comment",
                 entity_id=comment.id, opportunity_id=opp.id, details={"type": comment.comment_type})


def get_comment(db: Session, opp: Opportunity, comment_id: uuid.UUID) -> ReviewComment:
    comment = db.get(ReviewComment, comment_id)
    if comment is None or comment.opportunity_id != opp.id:
        raise not_found("Comment")
    return comment


def open_comment_counts(db: Session, opp: Opportunity) -> dict:
    comments = comments_for(db, opp)
    return {
        "total": len(comments),
        "open": sum(1 for c in comments if c.status == "open"),
        "critical_open": sum(1 for c in comments if c.status == "open" and c.priority == Priority.CRITICAL),
    }
