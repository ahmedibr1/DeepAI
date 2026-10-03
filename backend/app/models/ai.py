import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import AiRunStatus, EvidenceClass, Priority, Readiness
from app.db import Base
from app.models.base import enum_check, uuid_pk


class AiAnalysisRun(Base):
    """One analysis of one opportunity version. Results are write-once (enforced by a database trigger)."""

    __tablename__ = "ai_analysis_runs"
    __table_args__ = (
        CheckConstraint(enum_check("status", AiRunStatus), name="status"),
        Index("ix_ai_runs_opp_time", "opportunity_id", "queued_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    opportunity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("opportunity_versions.id"), nullable=False, index=True)
    triggered_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=AiRunStatus.QUEUED, nullable=False)
    llm_model: Mapped[str | None] = mapped_column(String(160))
    llm_model_revision: Mapped[str | None] = mapped_column(String(80))
    embedding_model: Mapped[str | None] = mapped_column(String(160))
    prompt_version: Mapped[str | None] = mapped_column(String(40))
    output_schema_version: Mapped[str | None] = mapped_column(String(40))
    parameters: Mapped[dict | None] = mapped_column(JSONB)
    input_manifest: Mapped[dict | None] = mapped_column(JSONB)  # document ids + sha256, review ids, deepdive hash
    result_json: Mapped[dict | None] = mapped_column(JSONB)
    result_sha256: Mapped[str | None] = mapped_column(String(64))
    validation_errors: Mapped[list | None] = mapped_column(JSONB)
    error_message: Mapped[str | None] = mapped_column(Text)
    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AiFinding(Base):
    __tablename__ = "ai_findings"
    __table_args__ = (
        CheckConstraint(enum_check("severity", Priority), name="severity"),
        CheckConstraint(enum_check("evidence_class", EvidenceClass), name="evidence_class"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_analysis_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    section: Mapped[str] = mapped_column(String(60), nullable=False)  # e.g. customer_requirement_gaps
    category: Mapped[str] = mapped_column(String(60), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    evidence_class: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    finding: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[str | None] = mapped_column(Text)
    business_impact: Mapped[str | None] = mapped_column(Text)
    recommended_action: Mapped[str | None] = mapped_column(Text)
    suggested_owner: Mapped[str | None] = mapped_column(String(160))
    citations: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class AiRecommendation(Base):
    __tablename__ = "ai_recommendations"
    __table_args__ = (CheckConstraint(enum_check("overall_readiness", Readiness), name="overall_readiness"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_analysis_runs.id", ondelete="CASCADE"), nullable=False, unique=True)
    overall_readiness: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    readiness_areas: Mapped[dict] = mapped_column(JSONB, nullable=False)
    required_actions: Mapped[list] = mapped_column(JSONB, nullable=False)
    missing_information: Mapped[list] = mapped_column(JSONB, nullable=False)
    management_recommendation: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AiSetting(Base):
    """Admin-managed AI configuration (endpoint, model names). Secrets stay in Kubernetes Secrets."""

    __tablename__ = "ai_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
