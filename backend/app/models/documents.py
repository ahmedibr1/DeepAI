import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import DocumentCategory
from app.db import Base
from app.models.base import enum_check, uuid_pk


class OpportunityDocument(Base):
    """Uploaded customer/opportunity file. Bytes live in S3-compatible storage; this row is the metadata."""

    __tablename__ = "opportunity_documents"
    __table_args__ = (
        CheckConstraint(enum_check("category", DocumentCategory), name="category"),
        CheckConstraint("scan_status IN ('pending','clean','infected','error','skipped')", name="scan_status"),
        CheckConstraint("extraction_status IN ('pending','running','done','failed','not_required')", name="extraction_status"),
        Index("ix_documents_opp_active", "opportunity_id", postgresql_where="deleted_at IS NULL"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    opportunity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunity_versions.id"), nullable=False, index=True)
    logical_document_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)  # groups re-uploads of one file
    doc_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_extension: Mapped[str] = mapped_column(String(16), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(160), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # Not unique: when a new version carries a document forward, both rows point at the same stored bytes.
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    scan_status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    extraction_status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    page_count: Mapped[int | None] = mapped_column(Integer)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))

    uploader: Mapped["User"] = relationship(foreign_keys=[uploaded_by], lazy="joined")  # noqa: F821
    version: Mapped["OpportunityVersion"] = relationship(lazy="joined")  # noqa: F821
