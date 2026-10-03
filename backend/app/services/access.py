"""Object-level access policy for opportunities. Every read/write path goes through here."""
import uuid

from sqlalchemy import Select, exists, false, func, or_, select
from sqlalchemy.orm import Session

from app.core.enums import MANAGEMENT_ROLES, OpportunityStatus, RoleKey
from app.core.errors import not_found
from app.models import Opportunity, OpportunityAccess, OpportunityVersion, Team, User

EDITABLE_STATUSES = {OpportunityStatus.DRAFT, OpportunityStatus.CHANGES_REQUESTED}
# A new version can be opened at any point before the AI is running, and after its recommendations.
VERSIONABLE_STATUSES = {OpportunityStatus.DRAFT, OpportunityStatus.CHANGES_REQUESTED, OpportunityStatus.SUBMITTED,
                        OpportunityStatus.IN_REVIEW, OpportunityStatus.READY_FOR_AI,
                        OpportunityStatus.AI_RECOMMENDATIONS}
# "Active" is everything a team is still working on; Completed leaves the active list.
ACTIVE_STATUSES = {s for s in OpportunityStatus if s != OpportunityStatus.COMPLETED}
AI_VISIBLE_TO_PRESALES = {OpportunityStatus.AI_RECOMMENDATIONS, OpportunityStatus.COMPLETED}


def scope_opportunities(stmt: Select, user: User) -> Select:
    """Which opportunities a user may see.

    Management roles see everything in this phase; the branch is kept per role so a narrower scope
    (for example a Portfolio Manager seeing only their own portfolio) can be introduced later.
    """
    role = user.role_key
    if role == RoleKey.ADMIN or role in MANAGEMENT_ROLES:
        return stmt
    if role == RoleKey.PRESALES_ACCOUNT:
        granted = exists().where(
            OpportunityAccess.opportunity_id == Opportunity.id,
            OpportunityAccess.user_id == user.id,
            or_(OpportunityAccess.expires_at.is_(None), OpportunityAccess.expires_at > func.now()),
        )
        return stmt.where(or_(Opportunity.owner_id == user.id, granted))
    return stmt.where(false())


def get_visible_opportunity(db: Session, user: User, opportunity_id: uuid.UUID, *, for_update: bool = False) -> Opportunity:
    stmt = scope_opportunities(select(Opportunity).where(Opportunity.id == opportunity_id), user)
    if for_update:
        stmt = stmt.with_for_update(of=Opportunity)
    opp = db.execute(stmt).unique().scalar_one_or_none()
    if opp is None:
        raise not_found("Opportunity")
    return opp


def is_reviewer(user: User, opp: Opportunity) -> bool:
    """Who may review this opportunity. All management roles in this phase."""
    return user.role_key in MANAGEMENT_ROLES


# Kept for callers that still speak of the team director.
is_team_director = is_reviewer


def can_edit_content(user: User, opp: Opportunity, version: OpportunityVersion | None = None) -> bool:
    """The owner and any management role may edit, as long as the version is open.

    A version that has been submitted is locked for everyone; the way forward is a new version.
    """
    is_owner = user.role_key == RoleKey.PRESALES_ACCOUNT and opp.owner_id == user.id
    if not (is_owner or user.role_key in MANAGEMENT_ROLES):
        return False
    if opp.status not in EDITABLE_STATUSES:
        return False
    if version is not None and (version.is_locked or version.id != opp.current_version_id):
        return False
    return True


def can_create_version(user: User, opp: Opportunity) -> bool:
    """Presales Account, Portfolio Manager and Director can all open a new version.

    This is the only route once a version has gone to review, which is what keeps the reviewed
    content and its comments intact.
    """
    is_owner = user.role_key == RoleKey.PRESALES_ACCOUNT and opp.owner_id == user.id
    if not (is_owner or user.role_key in MANAGEMENT_ROLES):
        return False
    return opp.status in VERSIONABLE_STATUSES


def can_view_ai(user: User, opp: Opportunity) -> bool:
    if user.role_key == RoleKey.PRESALES_ACCOUNT:
        return True   # the owner follows the AI status and reads the recommendations when they are ready
    return True


def can_delete(user: User, opp: Opportunity) -> bool:
    if user.role_key == RoleKey.PRESALES_ACCOUNT:
        return opp.owner_id == user.id
    return user.role_key == RoleKey.ADMIN or user.role_key in MANAGEMENT_ROLES
