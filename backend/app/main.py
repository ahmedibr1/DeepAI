import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.api.routes import admin, ai, auth, dashboard, documents, meta, notifications, opportunities, reviews
from app.core.config import get_settings
from app.db import SessionLocal

log = logging.getLogger("portal")


def create_app() -> FastAPI:
    s = get_settings()
    docs = s.environment != "production"
    app = FastAPI(title="Presales DeepDive Portal API", version="1.0.0",
                  docs_url="/api/docs" if docs else None, redoc_url=None,
                  openapi_url="/api/openapi.json" if docs else None)

    if s.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True,
                           allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["content-type", "x-csrf-token"])

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        response = await call_next(request)
        response.headers["x-request-id"] = request.state.request_id
        response.headers["x-content-type-options"] = "nosniff"
        response.headers["referrer-policy"] = "same-origin"
        response.headers["cache-control"] = "no-store"
        return response

    @app.exception_handler(DBAPIError)
    async def db_guard(request: Request, exc: DBAPIError):
        # Database-enforced governance (immutable AI runs, append-only audit, locked versions)
        if getattr(exc.orig, "sqlstate", None) == "42501":
            return JSONResponse(status_code=409, content={"detail": {"message": "This record is locked and cannot be changed.", "code": "immutable"}})
        log.exception("database error", extra={"request_id": getattr(request.state, "request_id", None)})
        return JSONResponse(status_code=500, content={"detail": "Unexpected database error."})

    for r in (auth.router, admin.router, opportunities.router, documents.router, reviews.router, ai.router,
              dashboard.router, notifications.router, meta.router):
        app.include_router(r, prefix="/api")

    @app.get("/api/health/live", include_in_schema=False)
    def live():
        return {"status": "ok"}

    @app.get("/api/health/ready", include_in_schema=False)
    def ready():
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        return {"status": "ready"}

    return app


app = create_app()
