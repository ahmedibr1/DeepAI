from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_any
from app.core.config import get_settings
from app.core.enums import (MANAGEMENT_ROLES, ROLE_LABELS, STATUS_LABELS, CommentType, DocumentCategory,
                             Priority, RoleKey)
from app.core.rbac import Perm, ROLE_PERMISSIONS
from app.db import get_db
from app.models import Role, Team, User
from app.schemas.common import UserRef
from app.services.workflow import TRANSITIONS

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("/reference")
def reference(db: Session = Depends(get_db),
              user: User = Depends(require_any(Perm.OPP_VIEW_ALL, Perm.OPP_VIEW_TEAM, Perm.OPP_VIEW_OWN, Perm.USER_MANAGE))):
    """Lookup data for filters and admin forms. Directory data is limited to what the caller may filter by."""
    role = user.role_key
    directors, managers, owners = [], [], []
    if role == RoleKey.ADMIN or role in MANAGEMENT_ROLES:
        by_role = lambda key: db.execute(select(User).join(Role).where(Role.key == key).order_by(User.full_name)).unique().scalars().all()  # noqa: E731
        directors = by_role(RoleKey.PORTFOLIO_DIRECTOR)
        managers = by_role(RoleKey.PORTFOLIO_MANAGER)
        owners = by_role(RoleKey.PRESALES_ACCOUNT)
    return {
        "roles": [{"key": r.value, "label": ROLE_LABELS[r]} for r in RoleKey],
        "statuses": [{"key": s.value, "label": l} for s, l in STATUS_LABELS.items()],
        "directors": [UserRef.model_validate(d).model_dump(mode="json") for d in directors],
        "managers": [UserRef.model_validate(m).model_dump(mode="json") for m in managers],
        "owners": [UserRef.model_validate(o).model_dump(mode="json") for o in owners],
        "rbac": {r.value: sorted(p.value for p in perms) for r, perms in ROLE_PERMISSIONS.items()}
        if Perm.USER_MANAGE in ROLE_PERMISSIONS[role] else None,
        "document_categories": [{"key": c.value, "label": c.value.replace("_", " ").title()} for c in DocumentCategory],
        "comment_types": [{"key": c.value, "label": c.value.replace("_", " ").capitalize()} for c in CommentType],
        "priorities": [p.value for p in Priority],
        "deepdive_sections": [
            {"key": "opportunity", "label": "Opportunity"}, {"key": "scope", "label": "Scope"},
            {"key": "stakeholders", "label": "Stakeholders, partners and vendors"},
            {"key": "strategy", "label": "Winning strategy"}, {"key": "risks", "label": "Risks"},
            {"key": "checklist", "label": "Readiness checklist"}, {"key": "support", "label": "Support needed"},
            {"key": "documents", "label": "Opportunity documents"}],
        "max_upload_mb": get_settings().max_upload_mb,
        "workflow": [{"action": t.action, "label": t.label, "from": sorted(s.value for s in t.sources), "to": t.target.value,
                      "phase": t.phase} for t in TRANSITIONS.values()],
    }
