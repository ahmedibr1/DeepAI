from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.config import get_settings
from app.core.enums import ROLE_LABELS
from app.core.rbac import permissions_for
from app.core.security import (create_session_token, hash_password, needs_rehash, new_csrf_token, password_problems,
                               verify_password)
from app.db import get_db
from app.models import User
from app.schemas.common import ChangePasswordIn, LoginIn, MeOut, TeamOut
from app.services import audit

router = APIRouter(prefix="/auth", tags=["auth"])
GENERIC_LOGIN_ERROR = "Incorrect username or password."


def me_out(user: User) -> MeOut:
    team = None
    if user.team:
        team = TeamOut(id=user.team.id, name=user.team.name, is_active=user.team.is_active,
                       director=user.team.director)
    return MeOut(id=user.id, username=user.username, full_name=user.full_name, email=user.email, role=user.role.key,
                 role_label=ROLE_LABELS[user.role_key], team=team,
                 permissions=sorted(p.value for p in permissions_for(user.role_key)),
                 must_change_password=user.must_change_password)


def _set_session(response: Response, user: User) -> None:
    s = get_settings()
    token, exp = create_session_token(user.id, user.token_version)
    common = dict(secure=s.cookie_secure, domain=s.cookie_domain, samesite="strict", path="/")
    response.set_cookie(s.session_cookie, token, httponly=True, expires=exp, **common)
    response.set_cookie(s.csrf_cookie, new_csrf_token(), httponly=False, expires=exp, **common)


@router.post("/login", response_model=MeOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> MeOut:
    s = get_settings()
    now = datetime.now(UTC)
    user = db.execute(select(User).where(func.lower(User.username) == body.username.strip().lower())).unique().scalar_one_or_none()

    if user and user.locked_until and user.locked_until > now:
        verify_password(None, body.password)  # equal timing
        audit.record(db, "auth.login", actor=user, request=request, outcome="denied", details={"reason": "locked"})
        db.commit()
        raise HTTPException(status.HTTP_423_LOCKED, "Too many failed attempts. Try again later or ask an Admin to unlock your account.")

    ok = verify_password(user.password_hash if user else None, body.password)
    if not ok or user is None or not user.is_active:
        if user is not None and ok is False:
            user.failed_login_count += 1
            if user.failed_login_count >= s.login_max_attempts:
                user.locked_until = now + timedelta(minutes=s.lockout_minutes)
                user.failed_login_count = 0
        audit.record(db, "auth.login", actor=user, actor_username=None if user else body.username[:80], request=request,
                     outcome="failure", details={"reason": "inactive" if (user and ok) else "bad_credentials"})
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, GENERIC_LOGIN_ERROR)

    user.failed_login_count, user.locked_until, user.last_login_at = 0, None, now
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    audit.record(db, "auth.login", actor=user, request=request)
    db.commit()
    _set_session(response, user)
    return me_out(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = get_settings()
    audit.record(db, "auth.logout", actor=user, request=request)
    db.commit()
    for name in (s.session_cookie, s.csrf_cookie):
        response.delete_cookie(name, path="/", domain=s.cookie_domain)
    response.status_code = 204
    return response


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user)) -> MeOut:
    return me_out(user)


@router.post("/change-password", response_model=MeOut)
def change_password(body: ChangePasswordIn, request: Request, response: Response, user: User = Depends(current_user),
                    db: Session = Depends(get_db)) -> MeOut:
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect.")
    problems = password_problems(body.new_password)
    if body.new_password == body.current_password:
        problems.append("Choose a password you have not just used.")
    if problems:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"message": "Password does not meet the policy.", "problems": problems})
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    user.password_changed_at = datetime.now(UTC)
    user.token_version += 1  # sign out other sessions
    audit.record(db, "auth.password_changed", actor=user, request=request, entity_type="user", entity_id=user.id)
    db.commit()
    _set_session(response, user)
    return me_out(user)
