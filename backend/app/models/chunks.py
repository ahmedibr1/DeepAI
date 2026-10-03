import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import uuid_pk

EMBEDDING_DIM = 1024   # Qwen3-Embedding truncated (Matryoshka) so pgvector HNSW can index it


class DocumentChunk(Base):
    """A retrievable piece of a source, with the provenance a citation needs."""

    __tablename__ = "document_chunks"
    __table_args__ = (
        CheckConstraint("source_kind IN ('document','deepdive','review')", name="source_kind"),
        Index("ix_chunks_version_source", "version_id", "source_kind"),
        Index("ix_chunks_fts", "search_vector", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    opportunity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunity_versions.id", ondelete="CASCADE"), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("opportunity_documents.id", ondelete="CASCADE"), index=True)
    document_name: Mapped[str] = mapped_column(String(255), nullable=False)
    document_category: Mapped[str | None] = mapped_column(String(40))
    field_path: Mapped[str | None] = mapped_column(String(160))     # DeepDive field, e.g. vendors[2].scope
    page_number: Mapped[int | None] = mapped_column(Integer)
    slide_number: Mapped[int | None] = mapped_column(Integer)
    sheet_name: Mapped[str | None] = mapped_column(String(120))
    section_path: Mapped[str | None] = mapped_column(String(400))
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    location_label: Mapped[str] = mapped_column(String(600), nullable=False)   # "RFP.pdf — Page 37 — Section 4.2"
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    embedding_model: Mapped[str | None] = mapped_column(String(160))
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))
    search_vector: Mapped[str | None] = mapped_column(TSVECTOR)
    meta: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AiJob(Base):
    """Work queue for long AI tasks. Claimed with SELECT ... FOR UPDATE SKIP LOCKED, so no broker is needed."""

    __tablename__ = "ai_jobs"
    __table_args__ = (
        CheckConstraint("status IN ('queued','running','succeeded','failed','cancelled')", name="status"),
        Index("ix_ai_jobs_claim", "status", "run_after"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[str] = mapped_column(String(40), nullable=False)      # ingest | analyze
    run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ai_analysis_runs.id", ondelete="CASCADE"), index=True)
    opportunity_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"))
    version_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("opportunity_versions.id", ondelete="CASCADE"))
    payload: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text)
    worker_id: Mapped[str | None] = mapped_column(String(80))
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
