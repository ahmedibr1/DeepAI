"""Opportunity state machine.

Draft → Submitted for Director Review → Director Review → Changes Requested / Ready for AI
      → AI Analysis → AI Recommendations → Completed

Every transition is validated here (who, from which status, guards), then recorded in
workflow_history and audit_logs in the same transaction, and notifies the right people.
"""
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import MANAGEMENT_ROLES, STATUS_LABELS, OpportunityStatus as St, RoleKey
from app.core.errors import conflict, forbidden, unprocessable
from app.models import DirectorReview, Opportunity, OpportunityVersion, ReviewComment, User, WorkflowHistory
from app.services import audit
from app.services.access import is_reviewer
from app.services.deepdive_validation import missing_fields
from app.services.notifications import notify

SYSTEM = "system"


@dataclass(frozen=True)
class Transition:
    action: str
    sources: frozenset[St]
    target: St
    actors: frozenset[str]          # role keys, "owner", "reviewer", or "system"
    label: str
    requires_comment: bool = False
    phase: int = 1                  # transitions from later phases are defined now, enabled when built
    notes: tuple[str, ...] = field(default_factory=tuple)


TRANSITIONS: dict[str, Transition] = {t.action: t for t in [
    Transition("submit", frozenset({St.DRAFT, St.CHANGES_REQUESTED}), St.SUBMITTED, frozenset({"owner"}),
               "Submit to Review"),
    Transition("start_review", frozenset({St.SUBMITTED}), St.IN_REVIEW, frozenset({"reviewer"}), "Start review"),
    Transition("request_changes", frozenset({St.IN_REVIEW, St.READY_FOR_AI}), St.CHANGES_REQUESTED,
               frozenset({"reviewer"}), "Request changes", requires_comment=True),
    Transition("mark_ready_for_ai", frozenset({St.IN_REVIEW}), St.READY_FOR_AI, frozenset({"reviewer"}),
               "Ready for AI analysis"),
    Transition("start_ai_analysis", frozenset({St.READY_FOR_AI}), St.AI_ANALYSIS,
               frozenset({"reviewer", RoleKey.ADMIN}), "Run AI analysis", phase=3),
    Transition("ai_completed", frozenset({St.AI_ANALYSIS}), St.AI_RECOMMENDATIONS, frozenset({SYSTEM}),
               "AI recommendations ready", phase=3),
    Transition("ai_failed", frozenset({St.AI_ANALYSIS}), St.READY_FOR_AI, frozenset({SYSTEM}), "AI analysis failed", phase=3),
    # Closing an opportunity is a management decision: it is what moves it out of the active list.
    Transition("complete", frozenset({St.DRAFT, St.SUBMITTED, St.IN_REVIEW, St.CHANGES_REQUESTED, St.READY_FOR_AI,
                                      St.AI_RECOMMENDATIONS}), St.COMPLETED, frozenset({"reviewer", RoleKey.ADMIN}),
               "Close opportunity"),
    Transition("reopen", frozenset({St.COMPLETED}), St.DRAFT, frozenset({"reviewer", RoleKey.ADMIN}),
               "Reopen opportunity"),
]}

ENABLED_PHASE = 3


def actor_matches(t: Transition, user: User | None, opp: Opportunity) -> bool:
    if user is None:
        return SYSTEM in t.actors
    if "owner" in t.actors and user.role_key == RoleKey.PRESALES_ACCOUNT and opp.owner_id == user.id:
        return True
    if "reviewer" in t.actors and is_reviewer(user, opp):
        return True
    return user.role_key in t.actors


# Started from the AI screen instead, because that endpoint also records the run and freezes its inputs.
AI_ROUTE_ACTIONS = {"start_ai_analysis"}


def available_actions(user: User, opp: Opportunity) -> list[dict]:
    out = []
    for t in TRANSITIONS.values():
        if t.action in AI_ROUTE_ACTIONS:
            continue
        if St(opp.status) in t.sources and SYSTEM not in t.actors and actor_matches(t, user, opp):
            out.append({"action": t.action, "label": t.label, "requires_comment": t.requires_comment,
                        "enabled": t.phase <= ENABLED_PHASE})
    return out


def transition(db: Session, opp: Opportunity, action: str, user: User | None, *, comment: str | None = None,
               expected_version_id: uuid.UUID | None = None, request: Request | None = None) -> WorkflowHistory:
    t = TRANSITIONS.get(action)
    if t is None:
        raise unprocessable(f"Unknown action '{action}'.")
    if t.phase > ENABLED_PHASE:
        raise conflict("This step becomes available in a later release of the portal.", code="not_enabled")
    if not actor_matches(t, user, opp):
        raise forbidden("You are not allowed to perform this step on this opportunity.")
    if St(opp.status) not in t.sources:
        raise conflict(f"Cannot '{t.label}' while the opportunity is {STATUS_LABELS[St(opp.status)]}.",
                       code="invalid_transition", status=opp.status)
    if expected_version_id and expected_version_id != opp.current_version_id:
        raise conflict("The opportunity has a newer version. Reload and try again.", code="stale_version")
    if t.requires_comment and not (comment and comment.strip()):
        raise unprocessable("A comment explaining the requested changes is required.")

    version: OpportunityVersion = db.get(OpportunityVersion, opp.current_version_id)
    now = datetime.now(UTC)

    if action == "submit":
        if version.is_locked:
            raise conflict("This version was already submitted. Create a new version with your changes first.",
                           code="version_locked")
        problems = missing_fields(version.deepdive.data if version.deepdive else {})
        if problems:
            raise unprocessable("The DeepDive is incomplete.", code="incomplete", missing=problems[:200], count=len(problems))
        version.is_locked, version.locked_at, version.submitted_at = True, now, now
        version.updated_by = user.id
        version.revision += 1

    if action in ("request_changes", "mark_ready_for_ai"):
        review = db.execute(select(DirectorReview).where(
            DirectorReview.version_id == version.id, DirectorReview.reviewer_id == user.id)).scalar_one_or_none()
        if review is None:
            review = DirectorReview(opportunity_id=opp.id, version_id=version.id, reviewer_id=user.id)
            db.add(review)
            db.flush()
        review.decision = "changes_requested" if action == "request_changes" else "ready_for_ai"
        review.decided_at = now
        if comment and comment.strip():
            review.summary = comment.strip()
            db.add(ReviewComment(review_id=review.id, opportunity_id=opp.id, version_id=version.id,
                                 comment_type="general", body=comment.strip(), created_by=user.id))
        if action == "mark_ready_for_ai":
            # Accepting a version closes everything still open on this opportunity, including comments
            # raised on earlier versions that the owner has now addressed.
            for c in db.execute(select(ReviewComment).where(ReviewComment.opportunity_id == opp.id,
                                                            ReviewComment.status == "open")).scalars():
                c.status, c.resolved_at = "closed", now

    previous = opp.status
    opp.status = t.target
    if user is not None:
        opp.updated_by = user.id
    history = WorkflowHistory(opportunity_id=opp.id, version_id=version.id, action=action, from_status=previous,
                              to_status=t.target, actor_id=user.id if user else None, comment=comment)
    db.add(history)
    audit.record(db, "opportunity.status_changed", actor=user, actor_username=None if user else SYSTEM, request=request,
                 entity_type="opportunity", entity_id=opp.id, opportunity_id=opp.id,
                 details={"action": action, "from": previous, "to": str(t.target), "version": version.version_number})
    _notify_for(db, opp, action, version, user, comment)
    return history


def _notify_for(db: Session, opp: Opportunity, action: str, version: OpportunityVersion, user: User | None,
                comment: str | None) -> None:
    ref = f"{opp.opportunity_number} · v{version.version_number}"
    reviewer_ids = [opp.manager_id, opp.director_id]
    if action == "submit":
        notify(db, reviewer_ids, "opportunity.submitted", f"New DeepDive to review: {opp.title}",
               body=f"{ref} was submitted by {user.full_name}.", opportunity_id=opp.id)
    elif action == "request_changes":
        notify(db, [opp.owner_id], "review.changes_requested", f"Changes requested: {opp.title}",
               body=(comment or "")[:500], opportunity_id=opp.id)
    elif action == "mark_ready_for_ai":
        notify(db, [opp.owner_id], "opportunity.ready_for_ai", f"Ready for AI analysis: {opp.title}", body=ref,
               opportunity_id=opp.id)
    elif action == "start_ai_analysis":
        notify(db, [opp.owner_id, *reviewer_ids], "ai.started", f"AI analysis started: {opp.title}", body=ref,
               opportunity_id=opp.id)
    elif action == "ai_completed":
        notify(db, [opp.owner_id, *reviewer_ids], "ai.completed", f"AI analysis completed: {opp.title}", body=ref,
               opportunity_id=opp.id)
