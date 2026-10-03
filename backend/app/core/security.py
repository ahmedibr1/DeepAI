"""Password hashing (Argon2id), session tokens (JWT in an HttpOnly cookie) and CSRF tokens."""
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

_hasher = PasswordHasher()  # Argon2id, RFC 9106 recommended parameters
# A real hash of a random value: keeps login timing constant when the username does not exist.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        ok = _hasher.verify(password_hash or _DUMMY_HASH, password)
        return ok and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def password_problems(password: str) -> list[str]:
    s = get_settings()
    problems = []
    if len(password) < s.password_min_length:
        problems.append(f"Use at least {s.password_min_length} characters.")
    if not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
        problems.append("Use both letters and numbers.")
    return problems


def create_session_token(user_id: uuid.UUID, token_version: int) -> tuple[str, datetime]:
    s = get_settings()
    now = datetime.now(UTC)
    exp = now + timedelta(minutes=s.session_minutes)
    payload = {"sub": str(user_id), "tv": token_version, "iat": now, "exp": exp, "jti": uuid.uuid4().hex}
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm), exp


def decode_session_token(token: str) -> dict | None:
    s = get_settings()
    try:
        return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm], options={"require": ["sub", "exp", "tv"]})
    except jwt.PyJWTError:
        return None


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)
