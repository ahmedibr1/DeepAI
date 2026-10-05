/* Portal rules restated for the browser demo: same roles, permissions, scoping and workflow as the
   FastAPI backend (app/core/rbac.py, app/services/access.py, app/services/workflow.py). */
export type RoleKey = "admin" | "cco" | "presales_gm" | "portfolio_director" | "portfolio_manager"
  | "presales_account" | "sales_gm" | "sales_director" | "account_manager";

export const ROLE_LABELS: Record<RoleKey, string> = {
  admin: "Admin", cco: "CCO", presales_gm: "Presales GM", portfolio_director: "Presales Director",
  portfolio_manager: "Presales Manager", presales_account: "Presales Lead",
  sales_gm: "Sales GM", sales_director: "Sales Director", account_manager: "Account Manager",
};

export const MANAGEMENT_ROLES: RoleKey[] = ["cco", "presales_gm", "portfolio_director", "portfolio_manager"];
/** Sales follow their vertical's opportunities; they never edit presales content. */
export const SALES_ROLES: RoleKey[] = ["sales_gm", "sales_director", "account_manager"];

export const AI_STATUS_LABELS: Record<string, string> = {
  not_analysed: "AI Not Analysed", requested: "AI Analysis Requested",
  processing: "AI Processing", partial: "AI Partially Analysed", completed: "AI Completed",
};

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", submitted: "Submitted for Review", in_review: "In Review",
  ready_for_ai: "Ready for AI", ai_analysis: "AI Analysis",
  ai_recommendations: "AI Recommendations", completed: "Completed",
};
export const STATUSES = Object.keys(STATUS_LABELS);

// The three management roles share one permission set in this phase, but stay separate in the model.
const SALES_VIEW = ["opportunity.view_all", "document.view", "review.view", "ai.view"];
const MANAGEMENT = ["opportunity.view_all", "document.view", "review.view", "review.comment", "review.decide",
  "ai.trigger", "ai.view", "dashboard.executive", "opportunity.delete_any"];

export const PERMISSIONS: Record<RoleKey, string[]> = {
  // The Admin is a superuser: every capability of every role.
  admin: ["user.manage", "team.manage", "audit.view", "ai_settings.manage", "opportunity.view_all",
          "opportunity.view_team", "opportunity.view_own", "opportunity.edit_own", "opportunity.delete_own", "opportunity.delete_any", "document.upload",
          "document.view", "review.view", "review.comment", "review.decide", "ai.trigger", "ai.view",
          "dashboard.executive"],
  cco: MANAGEMENT,
  presales_gm: MANAGEMENT,
  // The Presales Director runs the single-user portal, so they also create and edit opportunities.
  portfolio_director: [...MANAGEMENT, "opportunity.create", "opportunity.edit_own", "document.upload"],
  portfolio_manager: MANAGEMENT,
  presales_account: ["opportunity.view_own", "opportunity.create", "opportunity.edit_own", "opportunity.submit",
                     "opportunity.delete_own", "document.upload", "document.view", "review.view", "ai.view"],
  sales_gm: SALES_VIEW,
  sales_director: SALES_VIEW,
  account_manager: SALES_VIEW,
};

export interface Transition {
  action: string; sources: string[]; target: string; actors: string[]; label: string;
  requires_comment?: boolean; phase?: number;
}

export const TRANSITIONS: Transition[] = [
  { action: "submit", sources: ["draft"], target: "submitted", actors: ["owner"], label: "Submit to Review" },
  { action: "start_ai_analysis", sources: ["ready_for_ai"], target: "ai_analysis", actors: ["reviewer", "admin"], label: "Run AI analysis" },
  { action: "complete", sources: ["draft", "submitted", "ready_for_ai", "ai_analysis", "ai_recommendations"],
    target: "completed", actors: ["reviewer", "admin"], label: "Close opportunity" },
  { action: "reopen", sources: ["completed"], target: "draft", actors: ["reviewer", "admin"], label: "Reopen opportunity" },
];

/* Server-side completeness check (mirrors app/services/deepdive_validation.py) */
const SIMPLE_REQUIRED: Record<string, string> = {
  customer: "Customer / account name", oppName: "Opportunity name", oppNumber: "Opportunity number",
  value: "Estimated value (SAR)", presalesReceived: "Presales received", submissionDate: "Submission date",
  presalesOwner: "Presales owner", accountManager: "Account manager", background: "Opportunity background / history",
  sow: "Scope of work", solution: "Proposed solution / deliverables", psDuration: "PS duration", msDuration: "MS duration",
  driver: "Customer decision driver", differentiator: "Our differentiator", proactive: "Was this proactive?",
};
const LIST_RULES: [string, string, string[]][] = [
  ["requirements", "Customer business need / pain point", ["text"]],
  ["internal", "Internal stakeholders", ["unit", "scope"]],
  ["vendors", "Partners and vendors", ["name", "reg", "pricing", "scope"]],
  ["competitors", "Competitors", ["name"]],
  ["winTech", "How to win — technically", ["owner", "date", "action"]],
  ["winFin", "How to win — financially", ["owner", "date", "action"]],
  ["riskTech", "Technical risks", ["owner", "date", "impact", "risk", "mitigation"]],
  ["riskFin", "Financial risks", ["owner", "date", "impact", "risk", "mitigation"]],
  ["support", "Support needed", ["need", "from", "priority"]],
];
const ROW_FIELDS = ["item", "provider", "communicated", "quoteRec", "tpRec", "quoteVal", "tpVal", "comments"];

const blank = (v: unknown) => (Array.isArray(v) ? v.length === 0 : v === null || v === undefined || String(v).trim() === "");

export function missingFields(d: Record<string, any>): string[] {
  const out: string[] = [];
  Object.entries(SIMPLE_REQUIRED).forEach(([k, label]) => { if (blank(d[k])) out.push(label); });
  if (d.proactive === "Yes" && blank(d.proactiveType)) out.push("Engagement type");
  LIST_RULES.forEach(([key, label, fields]) => {
    const items = Array.isArray(d[key]) ? d[key] : [];
    if (!items.length) { out.push(`${label} (add at least 1)`); return; }
    items.forEach((item: Record<string, unknown>, i: number) => {
      fields.forEach((f) => { if (blank(item?.[f])) out.push(`${label} ${i + 1} — ${f}`); });
      if (key === "vendors" && item?.internal === true && blank(item?.justification)) out.push(`${label} ${i + 1} — justification`);
    });
  });
  const groups = Array.isArray(d.groups) ? d.groups : [];
  if (!groups.length) out.push("Readiness checklist (add at least 1 group)");
  groups.forEach((g: Record<string, any>, gi: number) => {
    if (blank(g?.name)) out.push(`Checklist group ${gi + 1} — name`);
    const rows = Array.isArray(g?.rows) ? g.rows : [];
    if (!rows.length) out.push(`Checklist group ${gi + 1} (add at least 1 component)`);
    rows.forEach((r: Record<string, unknown>, ri: number) => {
      ROW_FIELDS.forEach((f) => { if (blank(r?.[f])) out.push(`Checklist group ${gi + 1} row ${ri + 1} — ${f}`); });
    });
  });
  return out;
}

export const DOCUMENT_CATEGORIES = [
  { value: "rfp", label: "RFP" },
  { value: "rfq", label: "RFQ" },
  { value: "rfi", label: "RFI" },
  { value: "sow", label: "Scope of Work (SoW)" },
  { value: "clarification", label: "Customer clarification" },
  { value: "customer_other", label: "Other customer document" },
  { value: "tp", label: "Technical Proposal (TP)" },
  { value: "cp", label: "Commercial Proposal (CP)" },
  { value: "ta", label: "Tender Analyzer (TA)" },
  { value: "quotation", label: "Quotation" },
  { value: "other", label: "Supporting document" },
];
export const COMMENT_TYPES = ["general", "section", "critical_issue", "missing_information", "required_action"];
export const PRIORITIES = ["critical", "high", "medium", "low"];
export const DEEPDIVE_SECTIONS: [string, string][] = [
  ["opportunity", "Opportunity"], ["scope", "Scope"], ["stakeholders", "Stakeholders, partners and vendors"],
  ["strategy", "Winning strategy"], ["risks", "Risks"], ["checklist", "Readiness checklist"],
  ["support", "Support needed"], ["documents", "Opportunity documents"],
];
export const ALLOWED_EXTENSIONS = ["pdf", "docx", "xlsx", "pptx", "doc", "xls", "ppt", "txt", "csv", "msg", "eml", "png", "jpg", "jpeg"];
export const MAX_UPLOAD_MB = 100;

/** First bytes each file type must start with — the same check the API makes. */
export const MAGIC: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  docx: [[0x50, 0x4b, 0x03, 0x04]], xlsx: [[0x50, 0x4b, 0x03, 0x04]], pptx: [[0x50, 0x4b, 0x03, 0x04]],
  doc: [[0xd0, 0xcf, 0x11, 0xe0]], xls: [[0xd0, 0xcf, 0x11, 0xe0]], ppt: [[0xd0, 0xcf, 0x11, 0xe0]], msg: [[0xd0, 0xcf, 0x11, 0xe0]],
  png: [[0x89, 0x50, 0x4e, 0x47]], jpg: [[0xff, 0xd8, 0xff]], jpeg: [[0xff, 0xd8, 0xff]],
};
export const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", eml: "message/rfc822", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
};


/** Support Needed / Risks pulled straight from a DeepDive — the same rule the API applies. */
const HIGH = ["high", "critical"];
export function attentionItems(data: Record<string, any>) {
  const support = (data.support ?? []).filter((i: any) => HIGH.includes(String(i?.priority ?? "").toLowerCase()))
    .map((i: any) => ({ need: i.need, priority: i.priority, from: i.from, owner: i.from, due_date: i.date || null, status: "open" }));
  const risks = [
    ...(data.riskTech ?? []).map((i: any) => ({ ...i, category: "Technical" })),
    ...(data.riskFin ?? []).map((i: any) => ({ ...i, category: "Financial / Commercial" })),
  ].filter((i: any) => HIGH.includes(String(i?.impact ?? "").toLowerCase()))
    .map((i: any) => ({ risk: i.risk, category: i.category, impact: i.impact, mitigation: i.mitigation,
                        owner: i.owner, due_date: i.date || null, status: "open" }));
  return { support, risks };
}
