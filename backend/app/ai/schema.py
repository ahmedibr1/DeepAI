"""The contract the AI must return. Validated before anything is stored; invalid output fails the run."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "1.0"

EVIDENCE_CLASSES = ["fact", "director_observation", "ai_inference", "missing_information"]
SEVERITIES = ["critical", "high", "medium", "low"]
READINESS = ["ready", "ready_with_actions", "not_ready"]
AREA_STATUS = ["green", "amber", "red"]
NOT_FOUND = "Not found in the provided opportunity information."


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Citation(Strict):
    chunk_id: str = Field(description="Identifier of a supplied source chunk, exactly as given.")
    quote: str = Field(default="", max_length=400, description="Short supporting extract from that chunk.")


class Finding(Strict):
    title: str = Field(max_length=300)
    finding: str
    category: str = Field(max_length=60)
    severity: str
    evidence_class: str
    evidence: str = ""
    business_impact: str = ""
    recommended_action: str = ""
    suggested_owner: str = ""
    citations: list[Citation] = Field(default_factory=list)


class RequirementGap(Strict):
    requirement: str
    coverage: str = Field(description="covered | partially_covered | not_covered | contradicted")
    explanation: str
    severity: str
    citations: list[Citation] = Field(default_factory=list)


class DirectorCommentAnalysis(Strict):
    comment_id: str
    comment_summary: str
    addressed: str = Field(description="addressed | partially_addressed | not_addressed | unclear")
    explanation: str
    citations: list[Citation] = Field(default_factory=list)


class AreaAssessment(Strict):
    status: str
    summary: str
    evidence: str = ""
    citations: list[Citation] = Field(default_factory=list)


class RecommendedAction(Strict):
    priority: str
    action: str
    reason: str
    owner: str = ""
    due: str = ""
    source: str = ""


class MissingInformation(Strict):
    item: str
    why_it_matters: str
    where_to_get_it: str = ""


class AnalysisResult(Strict):
    """Top-level AI output for one opportunity version."""

    executive_summary: str
    overall_readiness: str
    confidence: float = Field(ge=0, le=1)
    critical_findings: list[Finding] = Field(default_factory=list)
    deepdive_gaps: list[Finding] = Field(default_factory=list)
    customer_requirement_gaps: list[RequirementGap] = Field(default_factory=list)
    director_comment_analysis: list[DirectorCommentAnalysis] = Field(default_factory=list)
    technical_analysis: AreaAssessment
    commercial_analysis: AreaAssessment
    partner_analysis: AreaAssessment
    risk_analysis: list[Finding] = Field(default_factory=list)
    missing_information: list[MissingInformation] = Field(default_factory=list)
    recommended_actions: list[RecommendedAction] = Field(default_factory=list)
    management_recommendation: str
    readiness_areas: dict[str, AreaAssessment] = Field(default_factory=dict)


AREA_KEYS = ["opportunity_understanding", "technical_readiness", "commercial_readiness", "partner_readiness",
             "proposal_readiness", "risk_readiness", "director_concerns", "customer_requirement_coverage"]


def json_schema() -> dict:
    """JSON Schema handed to the model for constrained decoding (vLLM guided output)."""
    return AnalysisResult.model_json_schema()
