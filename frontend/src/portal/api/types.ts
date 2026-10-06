export type RoleKey = "admin" | "cco" | "presales_gm" | "portfolio_director" | "portfolio_manager"
  | "presales_account" | "sales_gm" | "sales_director" | "account_manager";
export type Status =
  | "draft" | "submitted" | "in_review"
  | "ready_for_ai" | "ai_analysis" | "ai_recommendations" | "completed";

export interface UserRef { id: string; username: string; full_name: string }
export interface Team {
  id: string; name: string; is_active: boolean;
  director: UserRef | null; manager: UserRef | null; sales_gm?: UserRef | null; member_count: number;
}

export interface Me {
  id: string; username: string; full_name: string; email: string | null;
  role: RoleKey; role_label: string; team: Team | null; permissions: string[]; must_change_password: boolean;
}

export interface OpportunityListItem {
  id: string; opportunity_number: string; title: string; account_name: string;
  opportunity_type: string | null; vertical: string | null;
  status: Status; status_label: string; owner: UserRef; team_name: string | null;
  manager: UserRef | null; director: UserRef | null; ai_status: string; ai_status_label: string;
  current_version: number | null; ai_readiness: string | null; has_critical_findings: boolean;
  created_at: string; updated_at: string;
  /** "manual": added by hand and flagged, never changed by the opportunities sheet. "sheet": kept in step with it. */
  source?: "manual" | "sheet";
  strategic?: boolean; previous_projects?: boolean; entry_criteria?: EntryCriteria;
}

export interface WorkflowAction { action: string; label: string; requires_comment: boolean; enabled: boolean }

export interface OpportunityDetail extends OpportunityListItem {
  current_version_id: string | null; can_edit: boolean; can_create_version: boolean; can_view_ai: boolean;
  can_delete: boolean; is_archived: boolean;
  /** The opportunity's shared folder (name only; access stays in this browser) and what was last read from it. */
  folder_name?: string | null; folder_signature?: string | null;
  actions: WorkflowAction[];
}

export interface VersionSummary {
  id: string; version_number: number; change_notes: string | null; is_locked: boolean; revision: number;
  created_at: string; updated_at: string; submitted_at: string | null; locked_at: string | null;
  created_by: UserRef; updated_by: UserRef; is_current: boolean;
}
export interface VersionDetail extends VersionSummary { data: Record<string, unknown> }

export interface HistoryItem {
  id: number; action: string; from_status: Status | null; to_status: Status; from_label: string | null; to_label: string;
  actor: UserRef | null; comment: string | null; version_number: number | null; created_at: string;
}

export interface Page<T> { items: T[]; total: number; page: number; page_size: number }

export interface DashboardCard {
  key: string; label: string; value: number; tone?: "coral" | "green" | "red";
  note?: string | null;
  segments?: { label: string; value: number }[]; format?: "compact";
  filter?: Record<string, string | string[]>;
}

export interface MonitorRow {
  criteria?: EntryCriteria;
  id: string; opportunity_number: string; title: string; account_name: string; status: Status; status_label: string;
  opportunity_type: string | null; vertical: string | null; portfolio: string | null;
  owner: string | null; manager: string | null; director: string | null;
  estimated_value: number;
  presales_received: string | null; days_with_presales: number | null;
  submission_date: string | null; days_remaining: number | null; is_overdue_submission: boolean;
  attention_count: number; support_count: number; risk_count: number;
  nearest_due_date: string | null; is_overdue: boolean; days_since_update: number;
  scope: string; internal: string[]; vendors: string[];
  ps_duration: string | null; ms_duration: string | null; competitors: string[];
  support: { need: string; priority: string; from: string; due_date: string | null }[];
  risks: { risk: string; category: string; impact: string; mitigation: string; owner: string; due_date: string | null }[];
}

export interface AttentionItem {
  id: string; opportunity_number: string; title: string; account_name: string; status: Status;
  owner: string | null; manager: string | null; director: string | null;
  nearest_due_date: string | null; is_overdue: boolean; overdue_days: number; undated_count: number;
  days_since_update: number; support_count: number; risk_count: number;
  support: { need: string; priority: string; from: string; owner: string; due_date: string | null; status: string }[];
  risks: { risk: string; category: string; impact: string; mitigation: string; owner: string; due_date: string | null; status: string }[];
}

/** DeepDive entry criteria: the dashboard shows opportunities that meet at least one. */
export interface EntryCriteria { value: boolean; previous_projects: boolean; strategic: boolean; qualifies: boolean }
export interface DashboardSummary {
  entry?: { min_value: number; active: number; qualifying: number; value: number; previous_projects: number; strategic: number };
  role: RoleKey;
  kind: "management" | "account";
  cards: DashboardCard[];
  attention?: MonitorRow[];
  monitor?: MonitorRow[];
  portfolios?: { id: string; name: string }[];
  to_complete?: OpportunityListItem[];
  in_review?: OpportunityListItem[];
  ai_available?: OpportunityListItem[];
  unread_notifications: number;
}

export interface NotificationItem { id: string; type: string; title: string; body: string | null; opportunity_id: string | null; read_at: string | null; created_at: string }

export interface AdminUser {
  id: string; username: string; full_name: string; email: string | null; role: RoleKey; team_id: string | null;
  team_name: string | null; is_active: boolean; must_change_password: boolean; last_login_at: string | null; locked: boolean; created_at: string;
}

export interface AuditEntry {
  id: number; occurred_at: string; actor_username: string | null; action: string; outcome: string;
  entity_type: string | null; entity_id: string | null; opportunity_id: string | null; ip_address: string | null;
  details: Record<string, unknown> | null;
}

export interface Reference {
  roles: { key: RoleKey; label: string }[];
  statuses: { key: Status; label: string }[];
  directors: UserRef[];
  managers: UserRef[];
  owners: UserRef[];
  document_categories: { key: string; label: string }[];
  comment_types: { key: string; label: string }[];
  priorities: string[];
  deepdive_sections: { key: string; label: string }[];
  max_upload_mb: number;
}

export interface DocumentItem {
  id: string; file_name: string; file_extension: string; mime_type: string; size_bytes: number;
  category: string; doc_version: number; sha256: string; uploaded_at: string; uploaded_by: UserRef;
  version_number: number | null; can_delete: boolean;
}

export interface ReviewComment {
  id: string; comment_type: string; section: string | null; body: string; priority: string | null;
  owner_name: string | null; due_date: string | null; status: "open" | "addressed" | "closed";
  created_at: string; updated_at: string; resolved_at: string | null; created_by: UserRef; created_by_role?: string;
  version_id: string; version_number: number | null; can_manage: boolean;
}

export interface ReviewDecision {
  version_id: string; version_number: number | null; reviewer: string; reviewer_role?: string;
  decision: string | null; decided_at: string | null; summary: string | null;
}

export interface ReviewOut {
  can_comment: boolean; current_version_id: string | null; open_count: number;
  decisions: ReviewDecision[]; comments: ReviewComment[];
}

export interface AiCitation { chunk_id: string; quote: string }

export interface AiFinding {
  id: string; section: string; category: string; severity: string; evidence_class: string;
  title: string; finding: string; evidence: string; business_impact: string; recommended_action: string;
  suggested_owner: string; citations: AiCitation[];
}

export interface AiArea { status: "green" | "amber" | "red"; summary: string; evidence: string; citations: AiCitation[] }

export interface AiRecommendation {
  overall_readiness: string; confidence: number | null; readiness_areas: Record<string, AiArea>;
  required_actions: { priority: string; action: string; reason: string; owner: string; due: string; source: string }[];
  missing_information: { item: string; why_it_matters: string; where_to_get_it: string }[];
  management_recommendation: string;
}

export interface AiRunSummary {
  id: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  version_id: string; version_number: number | null; llm_model: string | null; embedding_model: string | null;
  prompt_version: string | null; schema_version: string | null; queued_at: string; started_at: string | null;
  completed_at: string | null; error_message: string | null; triggered_by: string | null; warning_count: number;
}

export interface AiRunDetail extends AiRunSummary {
  input_manifest: { documents: { file_name: string; category: string; sha256: string }[]; deepdive_sha256: string | null; version_number: number } | null;
  executive_summary: string | null;
  confidence: number | null;
  director_comment_analysis: { comment_id: string; comment_summary: string; addressed: string; explanation: string; citations: AiCitation[] }[];
  validation_warnings: { kind: string; where: string; detail: string }[];
  findings: AiFinding[];
  recommendation: AiRecommendation | null;
}

export interface AiSource { id: string; location: string; source_kind: string; document_name: string; text: string; document_id: string | null }
