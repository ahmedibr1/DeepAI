"""Runtime configuration. Every secret comes from the environment (Kubernetes Secrets in production)."""
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PORTAL_", env_file=".env", extra="ignore")

    environment: str = "production"
    database_url: str = Field(..., description="postgresql+psycopg://user:pass@host:5432/db")

    # Sessions
    jwt_secret: str = Field(..., min_length=32)
    jwt_algorithm: str = "HS256"
    session_minutes: int = 60
    cookie_secure: bool = True
    cookie_domain: str | None = None
    session_cookie: str = "pp_session"
    csrf_cookie: str = "pp_csrf"

    # Login protection
    login_max_attempts: int = 5
    lockout_minutes: int = 15
    password_min_length: int = 12

    # Opportunities
    opportunity_number_pattern: str = r"^[A-Z0-9][A-Z0-9\-_/]{2,40}$"
    max_deepdive_bytes: int = 2_000_000

    # Documents
    max_upload_mb: int = 100
    allowed_document_extensions: list[str] = ["pdf", "docx", "xlsx", "pptx", "doc", "xls", "ppt", "txt", "csv", "msg", "eml", "png", "jpg", "jpeg"]
    max_documents_per_opportunity: int = 100
    retention_days: int = 0  # 0 = keep until an admin purges

    # Storage: "local" (a directory / PersistentVolume) or "s3" (any S3-compatible store)
    storage_backend: str = "local"
    local_storage_path: str = "/var/lib/portal/documents"
    s3_bucket: str = "presales-portal-documents"
    s3_endpoint_url: str | None = None
    s3_region: str = "us-east-1"
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_use_ssl: bool = True


    cors_origins: list[str] = []

    @field_validator("jwt_secret")
    @classmethod
    def _no_placeholder_secret(cls, v: str) -> str:
        if v.lower().startswith("change-me"):
            raise ValueError("PORTAL_JWT_SECRET must be replaced with a random value")
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
