from sqlalchemy import select, text

from app.db import SessionLocal, engine
from app.models import AuditLog
from tests.conftest import PASSWORD, Api, make_user


def test_login_sets_httponly_session_and_csrf_cookie():
    make_user("alice", "presales_account")
    api = Api()
    r = api.c.post("/api/auth/login", json={"username": "ALICE", "password": PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert body["role"] == "presales_account" and "opportunity.create" in body["permissions"]
    set_cookie = r.headers.get_list("set-cookie")
    session = next(c for c in set_cookie if c.startswith("pp_session="))
    csrf = next(c for c in set_cookie if c.startswith("pp_csrf="))
    assert "HttpOnly" in session and "SameSite=strict" in session
    assert "HttpOnly" not in csrf
    assert "password_hash" not in r.text


def test_wrong_password_is_generic_and_audited():
    make_user("bob", "presales_account")
    api = Api()
    r1 = api.c.post("/api/auth/login", json={"username": "bob", "password": "nope"})
    r2 = api.c.post("/api/auth/login", json={"username": "nobody", "password": "nope"})
    assert r1.status_code == r2.status_code == 401
    assert r1.json() == r2.json()  # no username enumeration
    with SessionLocal() as db:
        outcomes = db.execute(select(AuditLog.outcome).where(AuditLog.action == "auth.login")).scalars().all()
    assert outcomes.count("failure") == 2


def test_lockout_after_repeated_failures():
    make_user("carol", "presales_account")
    api = Api()
    for _ in range(5):
        assert api.c.post("/api/auth/login", json={"username": "carol", "password": "bad"}).status_code == 401
    r = api.c.post("/api/auth/login", json={"username": "carol", "password": PASSWORD})
    assert r.status_code == 423


def test_unsafe_requests_require_csrf_header(org):
    api = Api("presales_one")
    r = api.c.post("/api/opportunities", json={"opportunity_number": "OP-1", "title": "x", "account_name": "y"})
    assert r.status_code == 403 and "CSRF" in r.text


def test_disabled_user_session_is_revoked(org):
    presales = Api("presales_one")
    assert presales.get("/api/auth/me").status_code == 200
    admin = Api("admin")
    assert admin.patch(f"/api/admin/users/{org['p1'].id}", json={"is_active": False}).status_code == 200
    assert presales.get("/api/auth/me").status_code == 401
    assert Api().c.post("/api/auth/login", json={"username": "presales_one", "password": PASSWORD}).status_code == 401


def test_change_password_policy_and_rotation(org):
    api = Api("presales_one")
    weak = api.post("/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "short"})
    assert weak.status_code == 422
    ok = api.post("/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "An0therStrongPass"})
    assert ok.status_code == 200 and ok.json()["must_change_password"] is False
    assert api.get("/api/auth/me").status_code == 200  # new cookie issued
    assert Api().c.post("/api/auth/login", json={"username": "presales_one", "password": PASSWORD}).status_code == 401


def test_audit_log_is_append_only_in_database(org):
    Api("admin")
    import pytest
    from sqlalchemy.exc import DBAPIError
    with pytest.raises(DBAPIError):
        with engine.begin() as conn:
            conn.execute(text("UPDATE audit_logs SET action = 'tampered'"))
    with pytest.raises(DBAPIError):
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM audit_logs"))
