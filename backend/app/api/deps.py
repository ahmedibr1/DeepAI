import hmac
import uuid

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.rbac import Perm, permissions_for
from app.core.security import decode_session_token
from app.db import get_db
from app.models import User

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def verify_csrf(request: Request) -> None:
    """Double-submit cookie check for every state-changing request made with the session cookie."""
    if request.method not in UNSAFE_METHODS:
        return
    s = get_settings()
    cookie = request.cookies.get(s.csrf_cookie) or ""
    header = request.headers.get("x-csrf-token") or ""
    if not cookie or not hmac.compare_digest(cookie, header):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing or invalid CSRF token.")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    s = get_settings()
    token = request.cookies.get(s.session_cookie)
    claims = decode_session_token(token) if token else None
    if not claims:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    try:
        user = db.get(User, uuid.UUID(claims["sub"]))
    except ValueError:
        user = None
    if user is None or not user.is_active or user.token_version != claims["tv"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has ended. Sign in again.")
    verify_csrf(request)
    request.state.user = user
    return user


def require(*perms: Perm):
    def checker(user: User = Depends(current_user)) -> User:
        granted = permissions_for(user.role_key)
        if not all(p in granted for p in perms):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission to do this.")
        return user
    return checker


def require_any(*perms: Perm):
    def checker(user: User = Depends(current_user)) -> User:
        if not set(perms) & permissions_for(user.role_key):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission to do this.")
        return user
    return checker
