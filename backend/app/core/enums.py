from enum import StrEnum


class RoleKey(StrEnum):
    ADMIN = "admin"                                  # technical administrator (users, teams, audit)
    CCO = "cco"
    PRESALES_GM = "presales_gm"
    PORTFOLIO_DIRECTOR = "portfolio_director"        # Presales Director
    PORTFOLIO_MANAGER = "portfolio_manager"          # Presales Manager
    PRESALES_ACCOUNT = "presales_account"            # Presales Lead — owns the DeepDive
    SALES_GM = "sales_gm"
    SALES_DIRECTOR = "sales_director"
    ACCOUNT_MANAGER = "account_manager"


ROLE_LABELS = {
    RoleKey.ADMIN: "Admin",
    RoleKey.CCO: "CCO",
    RoleKey.PRESALES_GM: "Presales GM",
    RoleKey.PORTFOLIO_DIRECTOR: "Presales Director",
    RoleKey.PORTFOLIO_MANAGER: "Presales Manager",
    RoleKey.PRESALES_ACCOUNT: "Presales Lead",
    RoleKey.SALES_GM: "Sales GM",
    RoleKey.SALES_DIRECTOR: "Sales Director",
    RoleKey.ACCOUNT_MANAGER: "Account Manager",
}

# Sales roles follow the opportunities of their vertical; they never edit presales content.
SALES_ROLES = (RoleKey.SALES_GM, RoleKey.SALES_DIRECTOR, RoleKey.ACCOUNT_MANAGER)

# The three management roles share one permission set for now, but stay separate in the model so their
# scopes can diverge later without a migration.
MANAGEMENT_ROLES = (RoleKey.CCO, RoleKey.PRESALES_GM, RoleKey.PORTFOLIO_DIRECTOR, RoleKey.PORTFOLIO_MANAGER)

AI_STATUS_LABELS = {
    "not_analysed": "AI Not Analysed",
    "requested": "AI Analysis Requested",
    "processing": "AI Processing",
    "completed": "AI Completed",
}


class OpportunityStatus(StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"                  # Submitted for Director Review
    IN_REVIEW = "in_review"                  # Director Review
    CHANGES_REQUESTED = "changes_requested"
    READY_FOR_AI = "ready_for_ai"
    AI_ANALYSIS = "ai_analysis"
    AI_RECOMMENDATIONS = "ai_recommendations"
    COMPLETED = "completed"


STATUS_LABELS = {
    OpportunityStatus.DRAFT: "Draft",
    OpportunityStatus.SUBMITTED: "Submitted for Review",
    OpportunityStatus.IN_REVIEW: "In Review",
    OpportunityStatus.CHANGES_REQUESTED: "Changes Requested",
    OpportunityStatus.READY_FOR_AI: "Ready for AI",
    OpportunityStatus.AI_ANALYSIS: "AI Analysis",
    OpportunityStatus.AI_RECOMMENDATIONS: "AI Recommendations",
    OpportunityStatus.COMPLETED: "Completed",
}


class DocumentCategory(StrEnum):
    RFP = "rfp"
    RFI_RFQ = "rfi_rfq"
    SOW = "scope_of_work"
    REQUIREMENTS = "customer_requirements"
    BOQ = "boq"
    TECH_SPEC = "technical_specifications"
    CLARIFICATION = "customer_clarification"
    EMAIL = "email"
    OTHER = "other"


class CommentType(StrEnum):
    GENERAL = "general"
    SECTION = "section"
    CRITICAL_ISSUE = "critical_issue"
    MISSING_INFORMATION = "missing_information"
    REQUIRED_ACTION = "required_action"


class Priority(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AiRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Readiness(StrEnum):
    READY = "ready"
    READY_WITH_ACTIONS = "ready_with_actions"
    NOT_READY = "not_ready"


class EvidenceClass(StrEnum):
    FACT = "fact"
    DIRECTOR_OBSERVATION = "director_observation"
    AI_INFERENCE = "ai_inference"
    MISSING_INFORMATION = "missing_information"
