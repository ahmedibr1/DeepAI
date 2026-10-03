import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import current_user, require
from app.core.enums import MANAGEMENT_ROLES, RoleKey
from app.core.errors import conflict, not_found, unprocessable
from app.core.rbac import ROLE_PERMISSIONS, Perm
from app.core.security import hash_password, password_problems
from app.db import get_db
from app.models import AiSetting, AuditLog, Role, Team, User, Vertical
from app.schemas.common import (AuditOut, Page, ResetPasswordIn, TeamCreateIn, TeamOut, TeamUpdateIn, UserCreateIn, UserOut,
                                UserUpdateIn)
from app.services import audit

router = APIRouter(prefix="/admin", tags=["admin"])


def _user_out(u: User) -> UserOut:
    return UserOut(id=u.id, username=u.username, full_name=u.full_name, email=u.email, role=u.role.key, team_id=u.team_id,
                   team_name=u.team.name if u.team else None, is_active=u.is_active,
                   must_change_password=u.must_change_password, last_login_at=u.last_login_at,
                   locked=bool(u.locked_until and u.locked_until > datetime.now(UTC)), created_at=u.created_at)


def _role(db: Session, key: str) -> Role:
    try:
        RoleKey(key)
    except ValueError:
        raise unprocessable("Unknown role.")
    return db.execute(select(Role).where(Role.key == key)).scalar_one()


def _check_team_assignment(db: Session, role_key: str, team_id: uuid.UUID | None) -> None:
    if team_id is not None:
        if db.get(Team, team_id) is None:
            raise unprocessable("Portfolio not found.")
        if role_key != RoleKey.PRESALES_ACCOUNT:
            raise unprocessable("Only Presales Account users belong to a portfolio. "
                                "Managers and Directors are assigned to it on the Portfolios page.")


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require(Perm.USER_MANAGE))):
    users = db.execute(select(User).order_by(func.lower(User.full_name))).unique().scalars().all()
    return [_user_out(u) for u in users]


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserCreateIn, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(require(Perm.USER_MANAGE))):
    problems = password_problems(body.temporary_password)
    if problems:
        raise unprocessable("Temporary password does not meet the policy.", problems=problems)
    role = _role(db, body.role)
    _check_team_assignment(db, body.role, body.team_id)
    user = User(username=body.username.strip(), full_name=body.full_name.strip(), email=body.email, role_id=role.id,
                team_id=body.team_id, password_hash=hash_password(body.temporary_password), must_change_password=True)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise conflict("That username is already taken.")
    audit.record(db, "user.created", actor=admin, request=request, entity_type="user", entity_id=user.id,
                 details={"username": user.username, "role": body.role, "team_id": str(body.team_id) if body.team_id else None})
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, body: UserUpdateIn, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(require(Perm.USER_MANAGE))):
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User")
    changes: dict = {}
    if body.full_name is not None:
        user.full_name = body.full_name.strip(); changes["full_name"] = user.full_name
    if body.email is not None:
        user.email = body.email; changes["email"] = body.email
    new_role = body.role or user.role.key
    if body.role and body.role != user.role.key:
        if user.id == admin.id:
            raise unprocessable("You cannot change your own role.")
        leads = db.scalar(select(func.count()).select_from(Team)
                          .where((Team.director_id == user.id) | (Team.manager_id == user.id)))
        if user.role.key in (RoleKey.PORTFOLIO_DIRECTOR, RoleKey.PORTFOLIO_MANAGER) and leads:
            raise unprocessable("This user is still assigned to a portfolio. Reassign the portfolio first.")
        user.role_id = _role(db, body.role).id
        user.token_version += 1
        changes["role"] = body.role
    if body.clear_team or new_role != RoleKey.PRESALES_ACCOUNT:
        if user.team_id is not None:
            changes["team_id"] = None
        user.team_id = None
    if body.team_id is not None:
        _check_team_assignment(db, new_role, body.team_id)
        user.team_id = body.team_id; changes["team_id"] = str(body.team_id)
    if body.is_active is not None and body.is_active != user.is_active:
        if user.id == admin.id and not body.is_active:
            raise unprocessable("You cannot disable your own account.")
        user.is_active = body.is_active
        user.token_version += 1
        changes["is_active"] = body.is_active
    if body.unlock:
        user.locked_until, user.failed_login_count = None, 0; changes["unlocked"] = True
    audit.record(db, "user.updated", actor=admin, request=request, entity_type="user", entity_id=user.id, details=changes)
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.post("/users/{user_id}/reset-password", status_code=204)
def reset_password(user_id: uuid.UUID, body: ResetPasswordIn, request: Request, db: Session = Depends(get_db),
                   admin: User = Depends(require(Perm.USER_MANAGE))):
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User")
    problems = password_problems(body.temporary_password)
    if problems:
        raise unprocessable("Temporary password does not meet the policy.", problems=problems)
    user.password_hash = hash_password(body.temporary_password)
    user.must_change_password = True
    user.token_version += 1
    user.locked_until, user.failed_login_count = None, 0
    audit.record(db, "user.password_reset", actor=admin, request=request, entity_type="user", entity_id=user.id)
    db.commit()


def _team_out(db: Session, t: Team) -> TeamOut:
    count = db.scalar(select(func.count()).select_from(User).where(User.team_id == t.id)) or 0
    return TeamOut(id=t.id, name=t.name, is_active=t.is_active, director=t.director, manager=t.manager, member_count=count)


def _check_role(db: Session, user_id: uuid.UUID, expected: RoleKey, label: str) -> None:
    u = db.get(User, user_id)
    if u is None or u.role.key != expected or not u.is_active:
        raise unprocessable(f"The {label} must be an active {label}.")


@router.get("/teams", response_model=list[TeamOut])
def list_teams(db: Session = Depends(get_db), _: User = Depends(require(Perm.TEAM_MANAGE))):
    return [_team_out(db, t) for t in db.execute(select(Team).order_by(Team.name)).unique().scalars()]


@router.post("/teams", response_model=TeamOut, status_code=201)
def create_team(body: TeamCreateIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(require(Perm.TEAM_MANAGE))):
    if body.director_id:
        _check_role(db, body.director_id, RoleKey.PORTFOLIO_DIRECTOR, "Portfolio Presales Director")
    if body.manager_id:
        _check_role(db, body.manager_id, RoleKey.PORTFOLIO_MANAGER, "Portfolio Presales Manager")
    team = Team(name=body.name.strip(), director_id=body.director_id, manager_id=body.manager_id)
    db.add(team)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise conflict("A team with that name exists, or that director already leads a team.")
    audit.record(db, "team.created", actor=admin, request=request, entity_type="team", entity_id=team.id,
                 details={"name": team.name, "director_id": str(body.director_id) if body.director_id else None,
                 "manager_id": str(body.manager_id) if body.manager_id else None})
    db.commit()
    return _team_out(db, team)


@router.patch("/teams/{team_id}", response_model=TeamOut)
def update_team(team_id: uuid.UUID, body: TeamUpdateIn, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(require(Perm.TEAM_MANAGE))):
    team = db.get(Team, team_id)
    if team is None:
        raise not_found("Team")
    changes: dict = {}
    if body.name:
        team.name = body.name.strip(); changes["name"] = team.name
    if body.clear_director:
        team.director_id = None; changes["director_id"] = None
    elif body.director_id:
        _check_role(db, body.director_id, RoleKey.PORTFOLIO_DIRECTOR, "Portfolio Presales Director")
        team.director_id = body.director_id; changes["director_id"] = str(body.director_id)
    if body.clear_manager:
        team.manager_id = None; changes["manager_id"] = None
    elif body.manager_id:
        _check_role(db, body.manager_id, RoleKey.PORTFOLIO_MANAGER, "Portfolio Presales Manager")
        team.manager_id = body.manager_id; changes["manager_id"] = str(body.manager_id)
    if body.is_active is not None:
        team.is_active = body.is_active; changes["is_active"] = body.is_active
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise conflict("That director already leads another team.")
    audit.record(db, "team.updated", actor=admin, request=request, entity_type="team", entity_id=team.id, details=changes)
    db.commit()
    return _team_out(db, team)


@router.get("/audit-logs", response_model=Page[AuditOut])
def audit_logs(action: str | None = None, actor: str | None = None, opportunity_id: uuid.UUID | None = None,
               date_from: datetime | None = None, date_to: datetime | None = None,
               page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
               db: Session = Depends(get_db), _: User = Depends(require(Perm.AUDIT_VIEW))):
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action.ilike(f"{action}%"))
    if actor:
        stmt = stmt.where(AuditLog.actor_username.ilike(f"%{actor}%"))
    if opportunity_id:
        stmt = stmt.where(AuditLog.opportunity_id == opportunity_id)
    if date_from:
        stmt = stmt.where(AuditLog.occurred_at >= date_from)
    if date_to:
        stmt = stmt.where(AuditLog.occurred_at <= date_to)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.execute(stmt.order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc())
                      .offset((page - 1) * page_size).limit(page_size)).scalars().all()
    return Page(items=[AuditOut.model_validate(r) for r in rows], total=total, page=page, page_size=page_size)


# ---------------------------------------------------------------- verticals


@router.get("/verticals")
def list_verticals(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Readable by anyone signed in: the create-opportunity form uses this list."""
    rows = db.execute(select(Vertical).order_by(Vertical.name)).scalars().all()
    return [{"id": str(v.id), "name": v.name, "is_active": v.is_active} for v in rows]


@router.post("/verticals", status_code=201)
def create_vertical(body: dict, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require(Perm.TEAM_MANAGE))):
    name = str(body.get("name", "")).strip()
    if len(name) < 2:
        raise unprocessable("Enter a vertical name.")
    if db.scalar(select(func.count()).select_from(Vertical).where(func.lower(Vertical.name) == name.lower())):
        raise conflict("That vertical already exists.", code="duplicate_vertical")
    v = Vertical(id=uuid.uuid4(), name=name, is_active=True)
    db.add(v)
    db.flush()
    audit.record(db, "vertical.created", actor=user, request=request, entity_type="vertical", entity_id=v.id,
                 details={"name": name})
    db.commit()
    return {"id": str(v.id), "name": v.name, "is_active": v.is_active}


@router.patch("/verticals/{vertical_id}")
def update_vertical(vertical_id: uuid.UUID, body: dict, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require(Perm.TEAM_MANAGE))):
    v = db.get(Vertical, vertical_id)
    if v is None:
        raise not_found("Vertical not found.")
    changes = {}
    if body.get("name"):
        v.name = str(body["name"]).strip()[:120]
        changes["name"] = v.name
    if "is_active" in body:
        v.is_active = bool(body["is_active"])
        changes["is_active"] = v.is_active
    audit.record(db, "vertical.updated", actor=user, request=request, entity_type="vertical", entity_id=v.id,
                 details=changes)
    db.commit()
    return {"id": str(v.id), "name": v.name, "is_active": v.is_active}


@router.delete("/verticals/{vertical_id}", status_code=204)
def delete_vertical(vertical_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require(Perm.TEAM_MANAGE))):
    v = db.get(Vertical, vertical_id)
    if v is None:
        raise not_found("Vertical not found.")
    audit.record(db, "vertical.deleted", actor=user, request=request, entity_type="vertical", entity_id=v.id,
                 details={"name": v.name})
    db.delete(v)
    db.commit()


# ---------------------------------------------------------------- AI prompt


DEFAULT_AI_SETTINGS = {
    "generation": {"temperature": 0.2, "max_output_tokens": 4000, "response_format": "json"},
    "retrieval": {"top_k": 12, "min_score": 0.25, "rerank": False},
    "fine_tuning": {"base_model": "", "adapter": "", "status": "not_started", "dataset": "", "notes": ""},
}


def _ai_settings(db: Session) -> dict:
    """One record holding everything the analysis runs with, so new options can be added without a migration."""
    from app.ai.prompts import PROMPT_VERSION, SYSTEM_PROMPT
    from app.core.config import settings

    stored = {row.key: row.value for row in db.execute(select(AiSetting)).scalars()}
    prompt_row = stored.get("system_prompt")
    config = {**DEFAULT_AI_SETTINGS, **(stored.get("config") or {})}
    return {
        "system_prompt": (prompt_row or {}).get("text") or SYSTEM_PROMPT,
        "prompt_is_default": prompt_row is None,
        "prompt_version": PROMPT_VERSION,
        "llm_model": settings.llm_model,
        "embedding_model": settings.embeddings_model,
        "generation": {**DEFAULT_AI_SETTINGS["generation"], **config.get("generation", {})},
        "retrieval": {**DEFAULT_AI_SETTINGS["retrieval"], **config.get("retrieval", {})},
        "fine_tuning": {**DEFAULT_AI_SETTINGS["fine_tuning"], **config.get("fine_tuning", {})},
    }


@router.get("/ai-settings")
def get_ai_settings(db: Session = Depends(get_db), user: User = Depends(require(Perm.AI_VIEW))):
    """Everything the AI analysis runs with. Readable by anyone with AI access, editable by an Admin."""
    data = _ai_settings(db)
    data["can_edit"] = Perm.AI_SETTINGS_MANAGE in ROLE_PERMISSIONS.get(user.role_key, frozenset())
    return data


@router.put("/ai-settings")
def update_ai_settings(body: dict, request: Request, db: Session = Depends(get_db),
                       user: User = Depends(require(Perm.AI_SETTINGS_MANAGE))):
    changed = {}
    if "system_prompt" in body:
        prompt = str(body["system_prompt"]).strip()
        if len(prompt) < 50:
            raise unprocessable("The prompt is too short to be useful.")
        row = db.get(AiSetting, "system_prompt")
        if row is None:
            db.add(AiSetting(key="system_prompt", value={"text": prompt}, updated_by=user.id))
        else:
            row.value = {"text": prompt}
            row.updated_by = user.id
        changed["system_prompt"] = len(prompt)

    sections = {k: body[k] for k in ("generation", "retrieval", "fine_tuning") if isinstance(body.get(k), dict)}
    if sections:
        row = db.get(AiSetting, "config")
        current = dict(row.value) if row else {}
        for name, values in sections.items():
            current[name] = {**current.get(name, {}), **values}
        if row is None:
            db.add(AiSetting(key="config", value=current, updated_by=user.id))
        else:
            row.value = current
            row.updated_by = user.id
        changed.update({k: list(v) for k, v in sections.items()})

    if not changed:
        raise unprocessable("Nothing to save.")
    audit.record(db, "ai_settings.updated", actor=user, request=request, entity_type="ai_settings", details=changed)
    db.commit()
    return _ai_settings(db)
