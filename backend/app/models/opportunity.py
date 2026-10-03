import uuid
from datetime import datetime

from sqlalchemy import (BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String,
                        Text, UniqueConstraint, func, text)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import OpportunityStatus, Readiness
from app.db import Base
from app.models.base import Timestamped, enum_check, uuid_pk
from app.models.identity import Team, User


class Opportunity(Timestamped, Base):
    __tablename__ = "opportunities"
    __table_args__ = (
        CheckConstraint(enum_check("status", OpportunityStatus), name="status"),
        CheckConstraint("ai_readiness IS NULL OR " + enum_check("ai_readiness", Readiness), name="ai_readiness"),
        Index("ix_opportunities_account_lower", text("lower(account_name)")),
        Index("ix_opportunities_updated_at", "updated_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    opportunity_number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    account_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Master fields shown in the monitor; set on the opportunity record, never in the DeepDive.
    opportunity_type: Mapped[str | None] = mapped_column(String(60))
    vertical: Mapped[str | None] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=OpportunityStatus.DRAFT, index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    team_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teams.id"), index=True)
    # Recorded on the opportunity so the review line stays stable if a person later changes team.
    manager_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    director_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("opportunity_versions.id", use_alter=True, name="fk_opportunities_current_version")
    )
    ai_readiness: Mapped[str | None] = mapped_column(String(32), index=True)
    has_critical_findings: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    owner: Mapped[User] = relationship(foreign_keys=[owner_id], lazy="joined")
    manager: Mapped[User | None] = relationship(foreign_keys=[manager_id], lazy="joined")
    director: Mapped[User | None] = relationship(foreign_keys=[director_id], lazy="joined")
    team: Mapped[Team | None] = relationship(foreign_keys=[team_id], lazy="joined")
    current_version: Mapped["OpportunityVersion | None"] = relationship(
        foreign_keys=[current_version_id], post_update=True, lazy="joined"
    )


class OpportunityVersion(Timestamped, Base):
    """One immutable-once-locked snapshot of the DeepDive. Reviews and AI runs point at a version."""

    __tablename__ = "opportunity_versions"
    __table_args__ = (UniqueConstraint("opportunity_id", "version_number", name="uq_version_number"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    opportunity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    based_on_version_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("opportunity_versions.id"))
    change_notes: Mapped[str | None] = mapped_column(Text)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revision: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # optimistic concurrency
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)

    creator: Mapped[User] = relationship(foreign_keys=[created_by], lazy="joined")
    updater: Mapped[User] = relationship(foreign_keys=[updated_by], lazy="joined")
    deepdive: Mapped["DeepDiveData"] = relationship(back_populates="version", uselist=False, cascade="all, delete-orphan")


class DeepDiveData(Base):
    __tablename__ = "deepdive_data"

    version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunity_versions.id", ondelete="CASCADE"), primary_key=True)
    schema_version: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    version: Mapped[OpportunityVersion] = relationship(back_populates="deepdive")


class OpportunityAccess(Base):
    """Explicit read grant for users who would not otherwise see an opportunity."""

    __tablename__ = "opportunity_access"

    opportunity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    access_level: Mapped[str] = mapped_column(String(16), default="view", nullable=False)
    granted_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorkflowHistory(Base):
    __tablename__ = "workflow_history"
    __table_args__ = (Index("ix_workflow_history_opp_time", "opportunity_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    opportunity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("opportunity_versions.id"))
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))  # NULL = system (AI worker)
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    actor: Mapped[User | None] = relationship(lazy="joined")
