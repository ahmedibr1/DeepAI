"""Role-specific dashboards.

Management ("what needs my attention?"): four KPIs plus the Support Needed / Risks monitoring list.
Presales Account ("what do I need to work on?"): their own work queue, without management KPIs.
"""
import uuid

from sqlalchemy import func, or_, select
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_any
from app.core.enums import MANAGEMENT_ROLES, OpportunityStatus as St, RoleKey
from app.core.rbac import Perm
from app.db import get_db
from app.models import Notification, Opportunity, ReviewComment, User
from app.api.routes.opportunities import list_item
from app.services import support_risks
from app.services.access import scope_opportunities

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

ACTIVE = [St.DRAFT, St.SUBMITTED, St.IN_REVIEW, St.CHANGES_REQUESTED, St.READY_FOR_AI, St.AI_ANALYSIS, St.AI_RECOMMENDATIONS]
AWAITING_REVIEW = [St.SUBMITTED, St.IN_REVIEW]


@router.get("/summary")
def summary(db: Session = Depends(get_db),
            user: User = Depends(require_any(Perm.OPP_VIEW_ALL, Perm.OPP_VIEW_TEAM, Perm.OPP_VIEW_OWN))):
    def query(*where):
        stmt = scope_opportunities(select(Opportunity), user).where(Opportunity.is_archived.is_(False))
        for clause in where:
            stmt = stmt.where(clause)
        return stmt

    def rows(*where, limit=25, order=Opportunity.updated_at.desc()):
        return [list_item(o) for o in db.execute(query(*where).order_by(order).limit(limit)).unique().scalars()]

    def count(*where) -> int:
        return db.scalar(select(func.count()).select_from(query(*where).subquery())) or 0

    unread = db.scalar(select(func.count()).select_from(Notification)
                       .where(Notification.user_id == user.id, Notification.read_at.is_(None))) or 0

    if user.role_key in MANAGEMENT_ROLES or user.role_key == RoleKey.ADMIN:
        monitor = support_risks.monitor_rows(db, user)
        attention = [r for r in monitor if r["attention_count"] > 0]
        # A Portfolio Manager or Director sees what is routed to them; the GM oversees everything.
        personal = user.role_key in (RoleKey.PORTFOLIO_DIRECTOR, RoleKey.PORTFOLIO_MANAGER)
        mine = or_(Opportunity.manager_id == user.id, Opportunity.director_id == user.id)
        awaiting_mine = count(Opportunity.status.in_(AWAITING_REVIEW), mine) if personal else count(Opportunity.status.in_(AWAITING_REVIEW))
        awaiting_all = count(Opportunity.status.in_(AWAITING_REVIEW))

        # Shared by every management role
        active_card = {"key": "active", "label": "Active Opportunities", "value": count(Opportunity.status.in_(ACTIVE)),
                       "filter": {"active": "1"}}
        attention_card = {"key": "attention", "label": "Opportunities Needing Attention", "value": len(attention),
                          "filter": {"attention": "1"}, "tone": "red"}

        # The review queue belongs to the Director, who acts on it
        director_cards = [
            {"key": "awaiting", "label": "Awaiting My Review", "value": awaiting_mine,
             "filter": {"status": [st.value for st in AWAITING_REVIEW], **({"assigned_to_me": "1"} if personal else {})},
             "tone": "coral",
             "note": (f"{awaiting_all} in review overall" if personal and awaiting_all != awaiting_mine else None)},
            {"key": "ready_for_ai", "label": "Ready for AI", "value": count(Opportunity.status == St.READY_FOR_AI),
             "filter": {"status": [St.READY_FOR_AI.value]}},
        ]

        # Two breakdown cards everyone sees: the mix of opportunity types, and the spread across the org
        types = {"RFP": 0, "RFI": 0, "Non-RFP": 0}
        for r in monitor:
            key = (r["opportunity_type"] or "").strip().upper()
            types["RFP" if key == "RFP" else "RFI" if key == "RFI" else "Non-RFP"] += 1
        mix_card = {"key": "type_mix", "label": "RFP | RFI | Non-RFP", "value": len(monitor),
                    "segments": [{"label": k, "value": v} for k, v in types.items()],
                    "filter": {"active": "1"}}

        # The Director also carries the review queue; everyone else gets the two breakdowns only.
        # The type mix sits right after Active Opportunities; the Director's queue follows it.
        ai_card = {"key": "ai", "label": "AI Recommendations Available",
                   "value": count(Opportunity.status.in_([St.AI_RECOMMENDATIONS, St.COMPLETED])),
                   "filter": {"status": [St.AI_RECOMMENDATIONS.value, St.COMPLETED.value]}, "tone": "green"}
        middle = ([mix_card, *director_cards] if user.role_key == RoleKey.PORTFOLIO_DIRECTOR
                  else [mix_card, ai_card])

        return {
            "role": user.role_key.value,
            "kind": "management",
            "cards": [active_card, *middle, attention_card],
            "attention": attention,
            "monitor": monitor,
            "unread_notifications": unread,
        }

    # Presales Account
    open_comments = db.scalar(
        select(func.count()).select_from(ReviewComment)
        .join(Opportunity, Opportunity.id == ReviewComment.opportunity_id)
        .where(Opportunity.owner_id == user.id, ReviewComment.status == "open")) or 0
    ai_ready = count(Opportunity.status.in_([St.AI_RECOMMENDATIONS, St.COMPLETED]))
    own_types = {"RFP": 0, "RFI": 0, "Non-RFP": 0}
    for (kind,) in db.execute(query(Opportunity.status.in_(ACTIVE)).with_only_columns(Opportunity.opportunity_type)).all():
        key = (kind or "").strip().upper()
        own_types["RFP" if key == "RFP" else "RFI" if key == "RFI" else "Non-RFP"] += 1
    return {
        "role": user.role_key.value,
        "kind": "account",
        "cards": [
            {"key": "mine", "label": "My Active Opportunities", "value": count(Opportunity.status.in_(ACTIVE)),
             "filter": {"active": "1"}},
            {"key": "type_mix", "label": "RFP | RFI | Non-RFP", "value": count(Opportunity.status.in_(ACTIVE)),
             "segments": [{"label": k, "value": v} for k, v in own_types.items()], "filter": {"active": "1"}},
            {"key": "not_submitted", "label": "Not Yet Submitted", "value": count(Opportunity.status == St.DRAFT),
             "filter": {"status": [St.DRAFT.value]}},
            {"key": "changes", "label": "Returned for Changes", "value": count(Opportunity.status == St.CHANGES_REQUESTED),
             "filter": {"status": [St.CHANGES_REQUESTED.value]}, "tone": "coral"},
            {"key": "comments", "label": "Review Comments to Address", "value": open_comments, "filter": {"open_comments": "1"}},
            {"key": "ai", "label": "AI Recommendations Available", "value": ai_ready,
             "filter": {"status": [St.AI_RECOMMENDATIONS.value, St.COMPLETED.value]}, "tone": "green"},
        ],
        "to_complete": rows(Opportunity.status.in_([St.DRAFT, St.CHANGES_REQUESTED]), limit=10,
                            order=Opportunity.updated_at.asc()),
        "in_review": rows(Opportunity.status.in_([St.SUBMITTED, St.IN_REVIEW, St.READY_FOR_AI, St.AI_ANALYSIS]), limit=10),
        "ai_available": rows(Opportunity.status.in_([St.AI_RECOMMENDATIONS, St.COMPLETED]), limit=10),
        "unread_notifications": unread,
    }


@router.get("/attention")
def attention(q: str | None = None, portfolio_id: uuid.UUID | None = None, db: Session = Depends(get_db),
              user: User = Depends(require_any(Perm.DASHBOARD_EXECUTIVE))):
    """Opportunity Attention Monitor: every active opportunity, ordered by customer submission date."""
    return {
        "rows": support_risks.monitor_rows(db, user, query=q, team_id=portfolio_id),
        "portfolios": support_risks.portfolios(db, user),
    }
