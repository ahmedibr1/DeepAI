import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import CommentType, Priority
from app.db import Base
from app.models.base import Timestamped, enum_check, uuid_pk


class DirectorReview(Timestamped, Base):
    __tablename__ = "director_reviews"
    __table_args__ = (
        UniqueConstraint("version_id", "reviewer_id", name="uq_review_version_reviewer"),
        CheckConstraint("decision IS NULL OR decision IN ('changes_requested','ready_for_ai')", name="decision"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    opportunity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False, index=True)
    version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunity_versions.id"), nullable=False)
    reviewer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    decision: Mapped[str | None] = mapped_column(String(32))
    summary: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ReviewComment(Timestamped, Base):
    __tablename__ = "review_comments"
    __table_args__ = (
        CheckConstraint(enum_check("comment_type", CommentType), name="comment_type"),
        CheckConstraint("priority IS NULL OR " + enum_check("priority", Priority), name="priority"),
        CheckConstraint("status IN ('open','addressed','closed')", name="status"),
        Index("ix_review_comments_opp_version", "opportunity_id", "version_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    review_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("director_reviews.id", ondelete="CASCADE"), nullable=False, index=True)
    opportunity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunity_versions.id"), nullable=False)
    comment_type: Mapped[str] = mapped_column(String(32), nullable=False)
    section: Mapped[str | None] = mapped_column(String(60))  # DeepDive section key, e.g. "scope", "vendors"
    body: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[str | None] = mapped_column(String(16))
    owner_name: Mapped[str | None] = mapped_column(String(160))
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="open", nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
