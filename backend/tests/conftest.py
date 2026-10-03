import json
import os
import secrets
import tempfile
import tempfile
import uuid
from pathlib import Path

os.environ.setdefault("PORTAL_DATABASE_URL", "postgresql+psycopg://portal:portal@localhost/portal_test")
os.environ.setdefault("PORTAL_JWT_SECRET", secrets.token_urlsafe(48))
os.environ["PORTAL_COOKIE_SECURE"] = "false"
os.environ["PORTAL_ENVIRONMENT"] = "test"
os.environ.setdefault("PORTAL_STORAGE_BACKEND", "local")
os.environ.setdefault("PORTAL_LOCAL_STORAGE_PATH", tempfile.mkdtemp(prefix="portal-docs-"))
os.environ.setdefault("PORTAL_LOCAL_STORAGE_PATH", tempfile.mkdtemp(prefix="portal-docs-"))

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.core.security import hash_password
from app.db import SessionLocal, engine
from app.main import app
from app.models import Role, Team, User

PASSWORD = "Str0ngPassw0rd!"
BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean_tables(migrated_db):
    yield
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only"))
        conn.execute(text("ALTER TABLE deepdive_data DISABLE TRIGGER deepdive_locked_immutable"))
        conn.execute(text("TRUNCATE document_chunks, ai_jobs CASCADE"))
        conn.execute(text("""TRUNCATE notification_deliveries, notifications, audit_logs, ai_findings, ai_recommendations,
            ai_analysis_runs, review_comments, director_reviews, opportunity_documents, workflow_history, opportunity_access,
            deepdive_data RESTART IDENTITY CASCADE"""))
        conn.execute(text("UPDATE opportunities SET current_version_id = NULL"))
        conn.execute(text("TRUNCATE opportunity_versions, opportunities, teams, users CASCADE"))
        conn.execute(text("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only"))
        conn.execute(text("ALTER TABLE deepdive_data ENABLE TRIGGER deepdive_locked_immutable"))


def make_user(username: str, role: str, team_id: uuid.UUID | None = None, must_change: bool = False) -> User:
    with SessionLocal() as db:
        role_id = db.execute(select(Role.id).where(Role.key == role)).scalar_one()
        u = User(username=username, full_name=username.replace("_", " ").title(), role_id=role_id, team_id=team_id,
                 password_hash=hash_password(PASSWORD), must_change_password=must_change)
        db.add(u)
        db.commit()
        db.refresh(u)
        return u


def make_team(name: str, director_id: uuid.UUID | None, manager_id: uuid.UUID | None = None) -> Team:
    with SessionLocal() as db:
        t = Team(name=name, director_id=director_id, manager_id=manager_id)
        db.add(t)
        db.commit()
        db.refresh(t)
        return t


class Api:
    """TestClient wrapper that signs in and sends the CSRF header like the portal frontend does."""

    def __init__(self, username: str | None = None, password: str = PASSWORD):
        self.c = TestClient(app, base_url="http://testserver")
        if username:
            r = self.c.post("/api/auth/login", json={"username": username, "password": password})
            assert r.status_code == 200, r.text

    def _h(self):
        return {"x-csrf-token": self.c.cookies.get("pp_csrf") or ""}

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def delete(self, url, **kw):
        return self.c.delete(url, headers=self._h(), **kw)

    def post(self, url, json=None, **kw):
        return self.c.post(url, json=json, headers=self._h(), **kw)

    def put(self, url, json=None, **kw):
        return self.c.put(url, json=json, headers=self._h(), **kw)

    def patch(self, url, json=None, **kw):
        return self.c.patch(url, json=json, headers=self._h(), **kw)


@pytest.fixture
def org():
    """Admin, GM, two directors with teams, three presales users."""
    admin = make_user("admin", "admin")
    gm = make_user("gm", "presales_gm")
    d1 = make_user("director_one", "portfolio_director")
    d2 = make_user("director_two", "portfolio_director")
    m1 = make_user("manager_one", "portfolio_manager")
    t1 = make_team("Portfolio One", d1.id, m1.id)
    t2 = make_team("Portfolio Two", d2.id)
    p1 = make_user("presales_one", "presales_account", t1.id)
    p1b = make_user("presales_one_b", "presales_account", t1.id)
    p2 = make_user("presales_two", "presales_account", t2.id)
    return dict(admin=admin, gm=gm, d1=d1, d2=d2, m1=m1, t1=t1, t2=t2, p1=p1, p1b=p1b, p2=p2)


@pytest.fixture
def complete_deepdive():
    return json.loads((Path(__file__).parent / "complete_deepdive.json").read_text())


def create_opp(api: Api, number: str = "OP-2026-159388") -> dict:
    r = api.post("/api/opportunities", json={"opportunity_number": number, "title": "Environment and Sustainability Solution",
                                               "account_name": "Red Sea Global"})
    assert r.status_code == 201, r.text
    return r.json()
