"""Role-based access control.

Two layers, both enforced on the backend:
1. Permissions (what a role may do at all) — `require()` dependency on every route.
2. Object policy (which records) — `app.services.access` scopes every opportunity query and check.
"""
from enum import StrEnum

from app.core.enums import MANAGEMENT_ROLES, SALES_ROLES, RoleKey


class Perm(StrEnum):
    USER_MANAGE = "user.manage"
    TEAM_MANAGE = "team.manage"
    AUDIT_VIEW = "audit.view"
    AI_SETTINGS_MANAGE = "ai_settings.manage"
    OPP_VIEW_ALL = "opportunity.view_all"
    OPP_VIEW_TEAM = "opportunity.view_team"
    OPP_VIEW_OWN = "opportunity.view_own"
    OPP_CREATE = "opportunity.create"
    OPP_EDIT_OWN = "opportunity.edit_own"
    OPP_SUBMIT = "opportunity.submit"
    OPP_DELETE_OWN = "opportunity.delete_own"
    OPP_DELETE_ANY = "opportunity.delete_any"
    DOC_UPLOAD = "document.upload"
    DOC_VIEW = "document.view"
    REVIEW_VIEW = "review.view"
    REVIEW_COMMENT = "review.comment"
    REVIEW_DECIDE = "review.decide"
    AI_TRIGGER = "ai.trigger"
    AI_VIEW = "ai.view"
    DASHBOARD_EXECUTIVE = "dashboard.executive"


# Presales GM, Portfolio Presales Director and Portfolio Presales Manager have identical rights in this
# phase. They are listed separately so a later phase can narrow a scope without touching callers.
MANAGEMENT_PERMISSIONS = frozenset({
    Perm.OPP_VIEW_ALL, Perm.DOC_VIEW, Perm.REVIEW_VIEW, Perm.REVIEW_COMMENT, Perm.REVIEW_DECIDE,
    Perm.AI_TRIGGER, Perm.AI_VIEW, Perm.DASHBOARD_EXECUTIVE, Perm.OPP_DELETE_ANY,
})

PRESALES_PERMISSIONS = frozenset({
    Perm.OPP_VIEW_OWN, Perm.OPP_CREATE, Perm.OPP_EDIT_OWN, Perm.OPP_SUBMIT, Perm.OPP_DELETE_OWN,
    Perm.DOC_UPLOAD, Perm.DOC_VIEW, Perm.REVIEW_VIEW, Perm.AI_VIEW,
})

# The Admin reaches every part of the portal, but creating and submitting opportunities stays with the
# Presales Account who owns the work; an Admin has no portfolio to file one under.
ADMIN_PERMISSIONS = frozenset(Perm) - {Perm.OPP_CREATE, Perm.OPP_SUBMIT}

# Sales see the opportunities they are commercially responsible for, and read the AI result; nothing else.
SALES_PERMISSIONS = frozenset({Perm.OPP_VIEW_ALL, Perm.DOC_VIEW, Perm.REVIEW_VIEW, Perm.AI_VIEW})

ROLE_PERMISSIONS: dict[RoleKey, frozenset[Perm]] = {
    RoleKey.ADMIN: ADMIN_PERMISSIONS,
    **{role: MANAGEMENT_PERMISSIONS for role in MANAGEMENT_ROLES},
    RoleKey.PRESALES_ACCOUNT: PRESALES_PERMISSIONS,
    **{role: SALES_PERMISSIONS for role in SALES_ROLES},
}


def permissions_for(role: RoleKey) -> frozenset[Perm]:
    return ROLE_PERMISSIONS.get(role, frozenset())
