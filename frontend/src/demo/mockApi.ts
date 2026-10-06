/* Browser-only stand-in for the portal API, used by the demo build.
 * It stores everything in localStorage and applies the same permission, scoping, workflow,
 * versioning and validation rules as the FastAPI backend. There is no real security here:
 * the demo exists so the Phase 1 workflow can be tried without installing anything.
 */
import SEED from "./seedData.json";
import { analyse as analyseWorkspace, type Finding } from "./analyst";
import { analysisInputs, eligibility, snapshot } from "./workspace";
import { analyse, checkGrounding, chunkText, SAMPLE_RFP, type DemoChunk } from "./demoAi";
// builderHtml.ts is generated at build time by scripts/gen-demo-builder.mjs
import { AI_STATUS_LABELS, ALLOWED_EXTENSIONS, attentionItems, COMMENT_TYPES, DEEPDIVE_SECTIONS, DOCUMENT_CATEGORIES,
         MAGIC, MANAGEMENT_ROLES, MAX_UPLOAD_MB, SALES_ROLES, MIME, missingFields, PERMISSIONS, PRIORITIES, ROLE_LABELS,
         STATUS_LABELS, TRANSITIONS, type RoleKey } from "./rules";

// The key carries the shape version: when the demo model changes, older saved data is ignored rather
// than half-loaded, so nobody gets a broken page after an update.
const KEY = "pp-demo-v6";
const AI_DEFAULTS = {
  generation: { temperature: 0.2, max_output_tokens: 4000, response_format: "json" },
  retrieval: { top_k: 12, min_score: 0.25, rerank: false },
  fine_tuning: { base_model: "", adapter: "", status: "not_started", dataset: "", notes: "" },
};

const DEMO_PROMPT = `You are a presales analyst for solutions by stc. Read the DeepDive, the management review comments
and the customer documents provided, and report only what those sources support.

Rules:
- Every finding must cite the passage it came from.
- Say "Not found in the provided opportunity information" rather than guessing.
- Separate confirmed information, management observations, AI inference and missing information.
- Judge readiness across opportunity understanding, technical, commercial, partner, proposal, risk,
  director concerns and customer requirement coverage.`;
for (const stale of ["pp-demo-v1", "pp-demo-v2", "pp-demo-v3", "pp-demo-v4", "pp-demo-v5"]) {
  try { localStorage.removeItem(stale); } catch { /* storage may be unavailable */ }
}
export const DEMO_PASSWORD = "Demo2026pass";

interface DUser { id: string; username: string; full_name: string; vertical_id?: string | null; email: string | null; role: RoleKey; team_id: string | null; is_active: boolean; must_change_password: boolean; locked: boolean; last_login_at: string | null; created_at: string; password: string }
interface DTeam { id: string; name: string; director_id: string | null; manager_id: string | null; sales_gm_id?: string | null; is_active: boolean }
interface DVersion { id: string; opportunity_id: string; version_number: number; change_notes: string | null; is_locked: boolean; locked_at: string | null; submitted_at: string | null; revision: number; created_at: string; updated_at: string; created_by: string; updated_by: string; data: Record<string, any> }
interface DOpp { session_confirmed_by?: string | null; session_confirmed_at?: string | null; session_confirmed_version_id?: string | null; id: string; opportunity_number: string; title: string; account_name: string; opportunity_type?: string | null; vertical?: string | null; status: string; owner_id: string; team_id: string | null; manager_id: string | null; director_id: string | null; is_archived?: boolean; source?: "manual" | "sheet"; strategic?: boolean; previous_projects?: boolean; folder_name?: string | null; folder_signature?: string | null; current_version_id: string; ai_readiness: string | null; has_critical_findings: boolean; created_at: string; updated_at: string }
interface DHistory { id: number; opportunity_id: string; version_id: string; action: string; from_status: string | null; to_status: string; actor_id: string | null; comment: string | null; created_at: string }
interface DNotification { id: string; user_id: string; type: string; title: string; body: string | null; opportunity_id: string | null; read_at: string | null; created_at: string }
interface DAudit { id: number; occurred_at: string; actor_username: string | null; action: string; outcome: string; entity_type: string | null; entity_id: string | null; opportunity_id: string | null; ip_address: string | null; details: Record<string, unknown> | null }
interface DDocument { id: string; opportunity_id: string; version_id: string; logical_id: string; doc_version: number; category: string; file_name: string; file_extension: string; mime_type: string; size_bytes: number; sha256: string; uploaded_by: string; uploaded_at: string; deleted_at: string | null }
interface DComment { id: string; opportunity_id: string; version_id: string; comment_type: string; section: string | null; body: string; priority: string | null; owner_name: string | null; due_date: string | null; status: "open" | "addressed" | "closed"; created_by: string; created_at: string; updated_at: string; resolved_at: string | null }
interface DDecision { id: string; opportunity_id: string; version_id: string; reviewer_id: string; decision: string | null; summary: string | null; decided_at: string | null; created_at: string }
interface DRun { id: string; opportunity_id: string; version_id: string; triggered_by: string; status: string; llm_model: string; embedding_model: string; prompt_version: string; schema_version: string; queued_at: string; started_at: string | null; completed_at: string | null; error_message: string | null; input_manifest: Record<string, unknown>; result: Record<string, unknown> | null; warnings: { kind: string; where: string; detail: string }[] }
interface DVertical { id: string; name: string; is_active: boolean; sales_director_id?: string | null }
interface DAnalysisRun { opportunity_id: string; kind: string; version_number: number; inputs: string;
  status: string; started_at: string; completed_at: string | null }
interface DTrackerItem {
  id: string; opportunity_id: string; finding_id: string; analysis: string; type: string; title: string;
  original: string; accepted: string; owner: string; status: string; accepted_by: string; accepted_at: string;
  source_version: number; related_requirement: string | null; customer_response: string | null;
}
/** Governance entries: a Risk or a Support Needed raised by management or sales for the next version. */
interface DGovernance {
  id: string; opportunity_id: string; kind: "risk" | "support"; title: string; detail: string;
  impact: string; owner: string; created_by: string; created_by_role: string; created_at: string;
  applied_to_version: number | null;
  status?: "open" | "closed"; due_date?: string | null; created_by_id?: string; closed_at?: string | null;
}
interface DB { users: DUser[]; governance?: DGovernance[]; findings?: Finding[]; analyses?: DAnalysisRun[]; tracker?: DTrackerItem[]; verticals?: DVertical[]; aiPrompt?: string; aiConfig?: Record<string, any>; teams: DTeam[]; opportunities: DOpp[]; versions: DVersion[]; history: DHistory[]; notifications: DNotification[]; audit: DAudit[]; documents: DDocument[]; comments: DComment[]; decisions: DDecision[]; runs: DRun[]; seq: number; session: string | null }

/** Uploaded bytes stay in memory for this tab only; the metadata is stored like everything else. */
const fileBytes = new Map<string, Blob>();

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Starting data: the opportunities from the CRM "Opportunity Advanced Find View", with the DeepDives already
    uploaded for KAU, King Saud University, IAU and the Islamic University. Regenerate it by importing the sheet and
    uploading the DeepDives in the demo, then saving the stored data. */
function seed(): DB {
  return clone(SEED) as unknown as DB;
}

let db: DB = load();
// Single-user portal: Ahmed AlOulah, the Presales Director, is always signed in and owns the work.
const SOLE_USERNAME = "a.aloulah";
{
  const sole = db.users.find((u) => u.username === SOLE_USERNAME);
  if (sole) {
    sole.team_id = sole.team_id ?? db.teams.find((t) => t.director_id === sole.id)?.id ?? null;
    db.session = sole.id;
  }
}
// Documents and review comments arrived with Phase 2; older saved demo data has no such lists.
for (const key of ["documents", "comments", "decisions", "runs", "findings", "analyses", "tracker", "governance"] as const) if (!db[key]) (db as unknown as Record<string, unknown[]>)[key] = [];

// Uploaded bytes live in memory only, so after a reload the seeded sample document is restored here.
for (const doc of db.documents) {
  if (doc.sha256 === "sample" && !fileBytes.has(doc.id)) fileBytes.set(doc.id, new Blob([SAMPLE_RFP], { type: "text/plain" }));
}

/** Lets the Documents tab offer a download without a server. */
(window as unknown as { __PORTAL_DEMO_DOWNLOAD__?: (id: string) => string }).__PORTAL_DEMO_DOWNLOAD__ = (id) => {
  const blob = fileBytes.get(id);
  return blob ? URL.createObjectURL(blob) : "#";
};
function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch { /* fall through to a fresh demo */ }
  const fresh = seed();
  persist(fresh);
  return fresh;
}
function persist(next: DB = db) { try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota: keep in memory */ } }
export function resetDemo() { localStorage.removeItem(KEY); fileBytes.clear(); db = seed(); persist(); }
export function demoAccounts() { return db.users.filter((u) => u.is_active).map((u) => ({ username: u.username, name: u.full_name, role: ROLE_LABELS[u.role] })); }

class HttpError extends Error { constructor(public status: number, public detail: unknown) { super("http"); } }
const err = (status: number, detail: unknown) => { throw new HttpError(status, detail); };

const user = (id: string | null) => db.users.find((u) => u.id === id) ?? null;
const me = () => user(db.session) ?? db.users.find((u) => u.username === SOLE_USERNAME) ?? null;
const team = (id: string | null) => db.teams.find((t) => t.id === id) ?? null;
const ref = (u: DUser | null) => (u ? { id: u.id, username: u.username, full_name: u.full_name } : null);
const can = (u: DUser, perm: string) => PERMISSIONS[u.role].includes(perm);
const requireUser = () => { const u = me(); if (!u) err(401, "Sign in to continue."); return u!; };
const requirePerm = (perm: string) => { const u = requireUser(); if (!can(u, perm)) err(403, "You do not have permission to do this."); return u; };

function audit(action: string, extra: Partial<DAudit> = {}) {
  db.audit.push({ id: db.seq++, occurred_at: now(), actor_username: me()?.username ?? null, action, outcome: "success",
    entity_type: null, entity_id: null, opportunity_id: null, ip_address: "127.0.0.1", details: null, ...extra });
}
function notify(userIds: (string | null)[], type: string, title: string, body: string | null, opportunity_id: string) {
  [...new Set(userIds.filter(Boolean) as string[])].forEach((id) =>
    db.notifications.push({ id: uid(), user_id: id, type, title, body, opportunity_id, read_at: null, created_at: now() }));
}

function visible(u: DUser): DOpp[] {
  // Management roles share one scope in this phase; Presales Account sees only their own.
  // Sales follow the opportunities they are commercially responsible for; presales see their own.
  if (u.role === "admin" || MANAGEMENT_ROLES.includes(u.role) || SALES_ROLES.includes(u.role)) return db.opportunities;
  return db.opportunities.filter((o) => o.owner_id === u.id);
}
function getOpp(u: DUser, id: string): DOpp {
  const o = visible(u).find((x) => x.id === id);
  if (!o) err(404, "Opportunity not found.");   // existence is not disclosed
  return o!;
}
const isReviewer = (u: DUser, _o: DOpp) => MANAGEMENT_ROLES.includes(u.role) || u.role === "admin";
const canDelete = (u: DUser, o: DOpp) => (u.role === "presales_account" ? o.owner_id === u.id : true);
const aiStatus = (o: DOpp) => {
  const done = new Set((db.analyses ?? []).filter((a) => a.opportunity_id === o.id && a.status === "completed").map((a) => a.kind));
  if (done.size >= 4) return "completed";
  if (done.size > 0) return "partial";
  return o.status === "ai_analysis" ? "processing" : o.status === "ready_for_ai" ? "requested" : "not_analysed";
};
// The owner and any management role may edit an open version; a submitted version is locked for everyone.
const canEdit = (u: DUser, o: DOpp, v: DVersion) =>
  ((u.role === "presales_account" && o.owner_id === u.id) || MANAGEMENT_ROLES.includes(u.role) || u.role === "admin")
  && o.status === "draft" && !v.is_locked && v.id === o.current_version_id;

/** Everything the analysis runs with, in the shape the AI Configuration page expects. */
function aiSettings() {
  return {
    system_prompt: db.aiPrompt ?? DEMO_PROMPT,
    prompt_is_default: !db.aiPrompt,
    prompt_version: "demo",
    llm_model: "demo-rule-based-analyst (browser)",
    embedding_model: "keyword match (browser)",
    generation: { ...AI_DEFAULTS.generation, ...(db.aiConfig?.generation ?? {}) },
    retrieval: { ...AI_DEFAULTS.retrieval, ...(db.aiConfig?.retrieval ?? {}) },
    fine_tuning: { ...AI_DEFAULTS.fine_tuning, ...(db.aiConfig?.fine_tuning ?? {}) },
  };
}

const findingOpp = (id: string) => id.split("::")[0];

/** Anyone who can open the opportunity may raise a Risk or a Support Needed item. */
const canRaiseGovernance = (u: DUser, o: DOpp) =>
  MANAGEMENT_ROLES.includes(u.role) || SALES_ROLES.includes(u.role) || u.role === "admin" || o.owner_id === u.id;
/** The person who raised an item, the owner of the opportunity and management may close, reopen or delete it. */
const canManageGovernance = (u: DUser, o: DOpp, g: DGovernance) =>
  g.created_by_id === u.id || o.owner_id === u.id || MANAGEMENT_ROLES.includes(u.role) || u.role === "admin";

/** Governance items flow into the open DeepDive version; submitted versions are never touched. */
function applyGovernance(o: DOpp) {
  const version = db.versions.find((v) => v.id === o.current_version_id);
  if (!version || version.is_locked) return;
  const pending = (db.governance ?? []).filter((g) => g.opportunity_id === o.id && g.applied_to_version === null);
  if (!pending.length) return;
  const data: Record<string, any> = { ...version.data };
  pending.forEach((g) => {
    if (g.kind === "risk") {
      data.riskTech = [...(data.riskTech ?? []), {
        risk: g.title, mitigation: g.detail || "To be defined with the owner", owner: g.owner,
        date: g.due_date ?? "", impact: g.impact, source: `Governance — ${g.created_by_role}`,
      }];
    } else {
      data.support = [...(data.support ?? []), {
        need: g.title, from: g.owner, priority: g.impact, date: g.due_date ?? "", source: `Governance — ${g.created_by_role}`,
      }];
    }
    g.applied_to_version = version.version_number;
  });
  version.data = data;
  version.updated_at = now();
}
const reviewerOf = (oppId: string, versionId: string) => {
  const d = db.decisions.find((x) => x.opportunity_id === oppId && x.version_id === versionId && !!x.decided_at);
  return d ? user(d.reviewer_id)?.full_name ?? null : null;
};

/** The four analyses of an opportunity, as the workspace shows them for its latest reviewed version. */
function analysesFor(o: DOpp) {
  const reviewed = versionsOf(o.id).sort((a, b) => b.version_number - a.version_number).find((v) => v.is_locked) ?? null;
  const docs = reviewed ? activeDocs(o.id, reviewed.id)
    .map((d) => ({ category: d.category, file_name: d.file_name, doc_version: d.doc_version })) : [];
  const runs: Record<string, { version_number: number; inputs: string; status: string }> = {};
  (db.analyses ?? []).filter((a) => a.opportunity_id === o.id).forEach((a) => {
    runs[a.kind] = { version_number: a.version_number, inputs: a.inputs, status: a.status };
  });
  return eligibility({ reviewed: reviewed ? { version_number: reviewed.version_number } : null, docs, runs });
}

/** Readiness of the latest reviewed version, built from the analyses, the tracker and the DeepDive. */
function readinessFor(o: DOpp) {
  const versions = versionsOf(o.id).sort((a, b) => b.version_number - a.version_number);
  const reviewed = versions.find((v) => v.is_locked) ?? null;
  const findings = (db.findings ?? []).filter((f) => findingOpp(f.id) === o.id);
  const tracker = (db.tracker ?? []).filter((t) => t.opportunity_id === o.id);
  const done = (kind: string) => (db.analyses ?? []).some((a) => a.opportunity_id === o.id && a.kind === kind && a.status === "completed");

  const rows: Record<string, string | null>[] = [];
  const add = (category: string, item: string, status: string, evidence: string, owner: string, source: string) =>
    rows.push({ category, item, status, evidence, owner, source, updated: now() });

  add("Scope", "All mandatory requirements addressed",
    done("technical") ? (findings.some((f) => f.analysis === "technical" && f.type === "Scope Gap" && f.status === "open") ? "attention" : "ready") : "waiting",
    reviewed ? `DeepDive v${reviewed.version_number}` : "—", "Presales Lead", "Technical Analysis");
  add("Technical", "Technical proposal reviewed against the customer documents",
    done("technical") ? "ready" : "waiting", snapshot(activeDocs(o.id, reviewed?.id ?? "")).find((x) => x.group === "tp")?.version ?? "TP not available",
    "Solution Architect", "Technical Analysis");
  add("Commercial", "Quotation aligned with the Commercial Proposal",
    done("commercial") ? (findings.some((f) => f.analysis === "commercial" && f.severity === "high" && f.status === "open") ? "attention" : "ready") : "waiting",
    snapshot(activeDocs(o.id, reviewed?.id ?? "")).find((x) => x.group === "cp")?.version ?? "CP not available",
    "Commercial Team", "Financial Analysis");
  tracker.filter((t) => t.status === "waiting_customer").forEach((t) =>
    add("Customer", t.title, "waiting", "AI Accepted Tracker", t.owner || "Presales Lead", "Early Analysis"));
  findings.filter((f) => f.status === "open" && f.severity === "high" && f.type.toLowerCase().includes("risk")).forEach((f) =>
    add("Risk", f.title, "open", f.evidence, "Presales Lead", f.analysis === "technical" ? "Technical Analysis" : "Early Analysis"));
  add("Governance", "Presales Director review completed", reviewed ? "ready" : "waiting",
    reviewed ? `Reviewed v${reviewed.version_number}` : "Not reviewed", "Presales Director", "Review & Governance");

  const score = (st: string) => (st === "ready" ? 1 : 0);
  const ready = rows.filter((r) => r.status === "ready").length;
  return {
    based_on: reviewed ? reviewed.version_number : null,
    summary: {
      overall: rows.every((r) => r.status === "ready") ? "ready" : rows.some((r) => r.status === "open") ? "attention" : "in_progress",
      technical: done("technical") ? "ready" : "waiting",
      commercial: done("commercial") ? "ready" : "waiting",
      clarifications: tracker.filter((t) => t.status === "waiting_customer").length,
      critical: findings.filter((f) => f.status === "open" && f.severity === "high").length,
      ready_count: ready, total: rows.length, score: Math.round((rows.reduce((a, r) => a + score(String(r.status)), 0) / Math.max(rows.length, 1)) * 100),
    },
    rows,
  };
}

const canEditAny = (u: DUser, o: DOpp) =>
  (u.role === "presales_account" && o.owner_id === u.id) || MANAGEMENT_ROLES.includes(u.role) || u.role === "admin";

const VERSIONABLE = ["draft", "submitted", "ready_for_ai", "ai_analysis", "ai_recommendations"];
const canCreateVersion = (u: DUser, o: DOpp) =>
  ((u.role === "presales_account" && o.owner_id === u.id) || MANAGEMENT_ROLES.includes(u.role) || u.role === "admin")
  && VERSIONABLE.includes(o.status);

const actorMatches = (t: (typeof TRANSITIONS)[number], u: DUser, o: DOpp) =>
  (t.actors.includes("owner") && u.role === "presales_account" && o.owner_id === u.id)
  || (t.actors.includes("reviewer") && isReviewer(u, o))
  || t.actors.includes(u.role);

const actionsFor = (u: DUser, o: DOpp) => TRANSITIONS.filter((t) => t.action !== "start_ai_analysis" && t.sources.includes(o.status) && actorMatches(t, u, o))
  .map((t) => ({ action: t.action, label: t.label, requires_comment: !!t.requires_comment, enabled: (t.phase ?? 1) <= 1 }));

const versionsOf = (oppId: string) => db.versions.filter((v) => v.opportunity_id === oppId).sort((a, b) => b.version_number - a.version_number);

/** The opportunity's Presales Lead: the name on its latest DeepDive (from the sheet's "Presales Lead" column or the
    Builder), falling back to the portal user who owns it. Shown wherever the portal says who owns an opportunity. */
function leadName(o: DOpp): string {
  const v = db.versions.find((x) => x.id === o.current_version_id);
  return String(v?.data?.presalesOwner ?? "").replace(/\s+/g, " ").trim() || user(o.owner_id)?.full_name || "—";
}
const leadRef = (o: DOpp) => ({ ...(ref(user(o.owner_id)) ?? { id: "", username: "" }), full_name: leadName(o) });

function oppOut(o: DOpp) {
  const v = db.versions.find((x) => x.id === o.current_version_id);
  const t = team(o.team_id);
  return { id: o.id, opportunity_number: o.opportunity_number, title: o.title, account_name: o.account_name, status: o.status,
    status_label: STATUS_LABELS[o.status], opportunity_type: o.opportunity_type ?? null, vertical: o.vertical ?? null,
    owner: leadRef(o), team_name: t?.name ?? null,
    manager: ref(user(o.manager_id)), director: ref(user(o.director_id)),
    ai_status: aiStatus(o), ai_status_label: AI_STATUS_LABELS[aiStatus(o)],
    current_version: v?.version_number ?? null, ai_readiness: o.ai_readiness,
    has_critical_findings: o.has_critical_findings, created_at: o.created_at, updated_at: o.updated_at,
    // Added by hand (flagged) or managed by the opportunities sheet. The sheet never touches manual ones.
    source: o.source ?? "sheet", strategic: !!o.strategic, previous_projects: !!o.previous_projects,
    entry_criteria: entryCriteria(o) };
}
function detailOut(u: DUser, o: DOpp) {
  const v = db.versions.find((x) => x.id === o.current_version_id)!;
  return { ...oppOut(o), current_version_id: o.current_version_id, can_edit: canEdit(u, o, v),
    can_create_version: canCreateVersion(u, o),
    can_delete: canDelete(u, o), is_archived: !!o.is_archived,
    can_view_ai: canViewAi(u, o),
    folder_name: o.folder_name ?? null, folder_signature: o.folder_signature ?? null,
    actions: actionsFor(u, o) };
}
function versionOut(v: DVersion, currentId: string) {
  return { id: v.id, version_number: v.version_number, change_notes: v.change_notes, is_locked: v.is_locked,
    revision: v.revision, created_at: v.created_at, updated_at: v.updated_at, submitted_at: v.submitted_at,
    locked_at: v.locked_at, created_by: ref(user(v.created_by)), updated_by: ref(user(v.updated_by)), is_current: v.id === currentId };
}
const meOut = (u: DUser) => {
  const t = team(u.team_id);
  return { id: u.id, username: u.username, full_name: u.full_name, email: u.email, role: u.role, role_label: ROLE_LABELS[u.role],
    team: t ? { id: t.id, name: t.name, is_active: t.is_active, director: ref(user(t.director_id)), member_count: db.users.filter((x) => x.team_id === t.id).length } : null,
    permissions: PERMISSIONS[u.role], must_change_password: u.must_change_password };
};

function transition(u: DUser, o: DOpp, action: string, comment?: string) {
  const t = TRANSITIONS.find((x) => x.action === action);
  if (!t) err(422, { message: `Unknown action '${action}'.` });
  if ((t!.phase ?? 1) > 1) err(409, { message: "This step becomes available in a later release of the portal.", code: "not_enabled" });
  if (!actorMatches(t!, u, o)) err(403, "You are not allowed to perform this step on this opportunity.");
  if (!t!.sources.includes(o.status)) err(409, { message: `Cannot '${t!.label}' while the opportunity is ${STATUS_LABELS[o.status]}.`, code: "invalid_transition" });
  if (t!.requires_comment && !comment?.trim()) err(422, { message: "A comment explaining the requested changes is required." });
  const v = db.versions.find((x) => x.id === o.current_version_id)!;
  if (action === "submit") {
    if (v.is_locked) err(409, { message: "This version was already submitted. Create a new version with your changes first.", code: "version_locked" });
    const missing = missingFields(v.data);
    if (missing.length) err(422, { message: "The DeepDive is incomplete.", code: "incomplete", missing: missing.slice(0, 200), count: missing.length });
    v.is_locked = true; v.locked_at = now(); v.submitted_at = now(); v.revision += 1;
  }
  if (action === "mark_ready_for_ai") {
    let decision = db.decisions.find((d) => d.version_id === v.id && d.reviewer_id === u.id);
    if (!decision) {
      decision = { id: uid(), opportunity_id: o.id, version_id: v.id, reviewer_id: u.id, decision: null, summary: null,
                   decided_at: null, created_at: now() };
      db.decisions.push(decision);
    }
    decision.decision = "ready_for_ai";
    decision.decided_at = now();
    if (comment?.trim()) {
      decision.summary = comment.trim();
      db.comments.push({ id: uid(), opportunity_id: o.id, version_id: v.id, comment_type: "general", section: null,
        body: comment.trim(), priority: null, owner_name: null, due_date: null, status: "open", created_by: u.id,
        created_at: now(), updated_at: now(), resolved_at: null });
    }
    if (action === "mark_ready_for_ai") {
      db.comments.filter((c) => c.opportunity_id === o.id && c.status === "open")
        .forEach((c) => { c.status = "closed"; c.resolved_at = now(); });
    }
  }
  if (action === "start_review" && !db.decisions.some((d) => d.version_id === v.id && d.reviewer_id === u.id)) {
    db.decisions.push({ id: uid(), opportunity_id: o.id, version_id: v.id, reviewer_id: u.id, decision: null,
      summary: null, decided_at: null, created_at: now() });
  }
  const from = o.status;
  o.status = t!.target; o.updated_at = now();
  db.history.push({ id: db.seq++, opportunity_id: o.id, version_id: v.id, action, from_status: from, to_status: t!.target,
    actor_id: u.id, comment: comment ?? null, created_at: now() });
  audit("opportunity.status_changed", { entity_type: "opportunity", entity_id: o.id, opportunity_id: o.id,
    details: { action, from, to: t!.target, version: v.version_number } });
  const directorId = team(o.team_id)?.director_id ?? null;
  const refLabel = `${o.opportunity_number} · v${v.version_number}`;
  if (action === "submit") notify([directorId], "opportunity.submitted", `New DeepDive to review: ${o.title}`, `${refLabel} was submitted by ${u.full_name}.`, o.id);
  if (action === "mark_ready_for_ai") notify([o.owner_id], "opportunity.ready_for_ai", `Ready for AI analysis: ${o.title}`, refLabel, o.id);
  persist();
}

const canViewAi = (_u: DUser, _o: DOpp) => true;   // the owner follows the status and reads the result

const FAR_FUTURE = "9999-12-31";
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
/** The scope of work with its lines kept (the dashboard lays out sections and sub-items), trimmed to a preview. */
const scopeLines = (text: string, maxLines = 30) => {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
  return lines.slice(0, maxLines).join("\n") + (lines.length > maxLines ? "\n…" : "");
};
/** "36 months" → "36 Months"; empty, "0" and "N/A" mean there is no such phase. */
const duration = (v: unknown): string | null => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!t || /^(0|n\/?a|none|-+|—)$/i.test(t)) return null;
  return t.replace(/\b(months?|years?|weeks?|days?)\b/gi, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
};
const names = (items: any[], ...fields: string[]) => (items ?? [])
  .map((i) => fields.map((f) => String(i?.[f] ?? "").trim()).find(Boolean)).filter(Boolean) as string[];

/** DeepDive entry criteria. An opportunity is on the dashboard when it meets at least one of them. */
const ENTRY_MIN_VALUE = 20_000_000;
function entryCriteria(o: DOpp) {
  const data: Record<string, any> = db.versions.find((v) => v.id === o.current_version_id)?.data ?? {};
  const value = Number(String(data.value ?? "").replace(/[^0-9.]/g, "")) || 0;
  const criteria = {
    value: value >= ENTRY_MIN_VALUE,
    previous_projects: !!o.previous_projects,
    // Opportunities added by hand count as flagged; any other is flagged with the ⚑ Flag button or on its Overview.
    strategic: !!o.strategic || (o.source ?? "sheet") === "manual",
  };
  return { ...criteria, qualifies: criteria.value || criteria.previous_projects || criteria.strategic };
}

/** Every active opportunity that meets the entry criteria, ordered by customer submission date. */
function monitorRows(u: DUser) {
  const today = new Date().toISOString().slice(0, 10);
  return visible(u)
    .filter((o) => !o.is_archived && o.status !== "completed" && entryCriteria(o).qualifies)
    .map((o) => {
      const version = db.versions.find((v) => v.id === o.current_version_id);
      const data: Record<string, any> = version?.data ?? {};
      const { support, risks } = attentionItems(data);
      const dates = [...support, ...risks].map((i) => i.due_date).filter(Boolean).sort() as string[];
      const nearest = dates[0] ?? null;
      const submission = String(data.submissionDate ?? "").slice(0, 10) || null;
      const received = String(data.presalesReceived ?? "").slice(0, 10) || null;
      const value = Number(String(data.value ?? "").replace(/,/g, "")) || 0;
      return {
        id: o.id, opportunity_number: o.opportunity_number, title: o.title, account_name: o.account_name,
        status: o.status, status_label: STATUS_LABELS[o.status],
        opportunity_type: o.opportunity_type ?? null, vertical: o.vertical ?? null,
        portfolio: team(o.team_id)?.name ?? null,
        owner: leadName(o), manager: user(o.manager_id)?.full_name ?? null,
        director: user(o.director_id)?.full_name ?? null,
        estimated_value: value,
        presales_received: received, days_with_presales: received ? dayDiff(received, today) : null,
        submission_date: submission, days_remaining: submission ? dayDiff(today, submission) : null,
        is_overdue_submission: !!submission && submission < today,
        attention_count: support.length + risks.length, support_count: support.length, risk_count: risks.length,
        nearest_due_date: nearest, is_overdue: !!nearest && nearest < today,
        days_since_update: Math.max(dayDiff(o.updated_at.slice(0, 10), today), 0),
        scope: scopeLines(data.sow ?? ""), internal: names(data.internal, "unit"), vendors: names(data.vendors, "name"),
        ps_duration: duration(data.psDuration), ms_duration: duration(data.msDuration),
        competitors: names(data.competitors, "name"),
        criteria: entryCriteria(o),
        support: [...support].sort((a, b) => (a.due_date ?? FAR_FUTURE).localeCompare(b.due_date ?? FAR_FUTURE)),
        risks: [...risks].sort((a, b) => (a.due_date ?? FAR_FUTURE).localeCompare(b.due_date ?? FAR_FUTURE)),
      };
    })
    .sort((a, b) => (a.submission_date ?? FAR_FUTURE).localeCompare(b.submission_date ?? FAR_FUTURE)
      || b.attention_count - a.attention_count || a.title.localeCompare(b.title));
}

function attentionFor(u: DUser) {
  const today = new Date().toISOString().slice(0, 10);
  return visible(u)
    .filter((o) => o.status !== "completed" && !o.is_archived)
    .map((o) => {
      const version = db.versions.find((v) => v.id === o.current_version_id);
      const { support, risks } = attentionItems(version?.data ?? {});
      if (!support.length && !risks.length) return null;
      const dates = [...support, ...risks].map((i) => i.due_date).filter(Boolean).sort() as string[];
      const nearest = dates[0] ?? null;
      const undated = [...support, ...risks].filter((i) => !i.due_date).length;
      const overdueDays = nearest && nearest < today
        ? Math.floor((Date.parse(today) - Date.parse(nearest)) / 86400000) : 0;
      const ageDays = Math.floor((Date.now() - Date.parse(o.updated_at)) / 86400000);
      return {
        id: o.id, opportunity_number: o.opportunity_number, title: o.title, account_name: o.account_name,
        status: o.status, owner: leadName(o), manager: user(o.manager_id)?.full_name ?? null,
        director: user(o.director_id)?.full_name ?? null, nearest_due_date: nearest,
        is_overdue: !!nearest && nearest < today, overdue_days: overdueDays, undated_count: undated,
        days_since_update: Math.max(ageDays, 0), support_count: support.length, risk_count: risks.length,
        support: [...support].sort((a, b) => Number(!!a.due_date) - Number(!!b.due_date)
          || (a.due_date ?? FAR_FUTURE).localeCompare(b.due_date ?? FAR_FUTURE)),
        risks: [...risks].sort((a, b) => Number(!!a.due_date) - Number(!!b.due_date)
          || (a.due_date ?? FAR_FUTURE).localeCompare(b.due_date ?? FAR_FUTURE)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const rank = (x: any) => (x.is_overdue ? 0 : x.nearest_due_date === null ? 1 : 2);
      return rank(a) - rank(b) || (a!.nearest_due_date ?? FAR_FUTURE).localeCompare(b!.nearest_due_date ?? FAR_FUTURE);
    });
}   // the owner follows the status and reads the result

/** Chunks live for the session, like the vector store does on the server. */
const chunkStore = new Map<string, DemoChunk[]>();

function runSummary(r: DRun) {
  return { id: r.id, status: r.status, version_id: r.version_id,
    version_number: db.versions.find((v) => v.id === r.version_id)?.version_number ?? null,
    llm_model: r.llm_model, embedding_model: r.embedding_model, prompt_version: r.prompt_version,
    schema_version: r.schema_version, queued_at: r.queued_at, started_at: r.started_at,
    completed_at: r.completed_at, error_message: r.error_message,
    triggered_by: user(r.triggered_by)?.full_name ?? null, warning_count: r.warnings.length };
}

async function buildChunks(o: DOpp, version: DVersion): Promise<DemoChunk[]> {
  const chunks: DemoChunk[] = [];
  let counter = 0;
  const nextId = () => `${version.id}-${counter++}`;
  for (const [path, value] of Object.entries(version.data)) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text && text.length > 2) {
      chunks.push({ id: nextId(), source_kind: "deepdive", document_name: `DeepDive v${version.version_number}`,
        location_label: `DeepDive v${version.version_number} — ${path}`, text: `${path}: ${text}`, field_path: path });
    }
  }
  for (const c of db.comments.filter((x) => x.opportunity_id === o.id)) {
    chunks.push({ id: nextId(), source_kind: "review", document_name: "Director review",
      location_label: `Director comment ${c.id} (${c.comment_type})`, field_path: c.id,
      text: `Director comment (${c.comment_type}): ${c.body}` });
  }
  for (const d of activeDocs(o.id)) {
    const blob = fileBytes.get(d.id);
    if (!blob) continue;
    if (!["txt", "csv", "eml"].includes(d.file_extension)) {
      chunks.push({ id: nextId(), source_kind: "document", document_name: d.file_name,
        location_label: `${d.file_name} — not read in the demo`,
        text: `${d.file_name} is a ${d.file_extension.toUpperCase()} file. The browser demo reads text files only; `
          + "the portal itself extracts PDF, Word, PowerPoint and Excel with page and section references." });
      continue;
    }
    const text = await blob.text();
    chunkText(text, d.file_name, () => nextId()).forEach((c) => chunks.push({ ...c, id: nextId() }));
  }
  return chunks;
}

async function finishRun(runId: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 1500));            // let the "analysis in progress" state be visible
  const run = db.runs.find((r) => r.id === runId);
  if (!run) return;
  const o = db.opportunities.find((x) => x.id === run.opportunity_id)!;
  const version = db.versions.find((v) => v.id === run.version_id)!;
  try {
    const chunks = await buildChunks(o, version);
    chunkStore.set(o.id, chunks);
    const supplied = Object.fromEntries(chunks.map((c) => [c.id, c.text]));
    const result = analyse(chunks);
    run.warnings = checkGrounding(result, supplied);
    run.result = result as unknown as Record<string, unknown>;
    run.status = "succeeded";
    run.completed_at = now();
    o.ai_readiness = result.overall_readiness;
    o.has_critical_findings = result.findings.some((f) => f.severity === "critical");
    o.status = "ai_recommendations";
    o.updated_at = now();
    db.history.push({ id: db.seq++, opportunity_id: o.id, version_id: version.id, action: "ai_completed",
      from_status: "ai_analysis", to_status: "ai_recommendations", actor_id: null, comment: null, created_at: now() });
    notify([o.owner_id, team(o.team_id)?.director_id ?? null], "ai.completed", `AI analysis completed: ${o.title}`,
      `${o.opportunity_number} · v${version.version_number}`, o.id);
  } catch (e) {
    run.status = "failed";
    run.error_message = String(e);
    o.status = "ready_for_ai";
  }
  persist();
}

const canManageDocs = (u: DUser, o: DOpp) => o.owner_id === u.id && o.status === "draft";
const canViewDocs = (u: DUser, o: DOpp) => o.owner_id === u.id || isReviewer(u, o) || ["admin", "presales_gm"].includes(u.role);
// Documents belong to a version, like the DeepDive.
const activeDocs = (oppId: string, versionId?: string) => db.documents
  .filter((d) => d.opportunity_id === oppId && !d.deleted_at && (!versionId || d.version_id === versionId))
  .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));

function docOut(d: DDocument, canDelete: boolean) {
  return { id: d.id, file_name: d.file_name, file_extension: d.file_extension, mime_type: d.mime_type,
    size_bytes: d.size_bytes, category: d.category, doc_version: d.doc_version, sha256: d.sha256,
    uploaded_at: d.uploaded_at, uploaded_by: ref(user(d.uploaded_by)),
    version_number: db.versions.find((v) => v.id === d.version_id)?.version_number ?? null, can_delete: canDelete };
}
const commentOut = (c: DComment, canManage: boolean) => ({
  ...c, created_by: ref(user(c.created_by)),
  created_by_role: ROLE_LABELS[user(c.created_by)?.role ?? "presales_account"],
  version_number: db.versions.find((v) => v.id === c.version_id)?.version_number ?? null, can_manage: canManage });

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function storeUpload(u: DUser, o: DOpp, file: File, category: string) {
  if (!canManageDocs(u, o)) err(403, "Documents can be added by the opportunity owner while it is in Draft.");
  if (!DOCUMENT_CATEGORIES.some((c) => c.value === category)) err(422, { message: "Choose a document category." });
  const name = file.name.trim();
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(ext))
    err(422, { message: `${ext.toUpperCase() || "That file type"} is not accepted. Allowed: ${[...ALLOWED_EXTENSIONS].sort().join(", ")}.` });
  if (file.size === 0) err(422, { message: `“${name}” is empty.` });
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) err(422, { message: `“${name}” is larger than the ${MAX_UPLOAD_MB} MB limit.` });
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const expected = MAGIC[ext];
  if (expected && !expected.some((sig) => sig.every((byte, i) => head[i] === byte)))
    err(422, { message: `The contents of “${name}” do not match a ${ext.toUpperCase()} file.` });

  const previous = activeDocs(o.id, o.current_version_id).filter((d) => d.file_name === name).sort((a, b) => b.doc_version - a.doc_version)[0];
  const doc: DDocument = { id: uid(), opportunity_id: o.id, version_id: o.current_version_id,
    logical_id: previous?.logical_id ?? uid(), doc_version: previous ? previous.doc_version + 1 : 1, category,
    file_name: name, file_extension: ext, mime_type: MIME[ext] ?? "application/octet-stream", size_bytes: file.size,
    sha256: await sha256Hex(file), uploaded_by: u.id, uploaded_at: now(), deleted_at: null };
  if (previous) previous.deleted_at = now();
  fileBytes.set(doc.id, file.slice());
  db.documents.push(doc);
  o.updated_at = now();
  audit("document.uploaded", { entity_type: "opportunity_document", entity_id: doc.id, opportunity_id: o.id,
    details: { file_name: name, category, size_bytes: file.size, sha256: doc.sha256, doc_version: doc.doc_version } });
  persist();
  return docOut(doc, true);
}

/* ---------------- routing ---------------- */
type Handler = (m: RegExpMatchArray, body: any, q: URLSearchParams) => unknown;

/** Creates an opportunity with its first DeepDive version. "sheet" ones are kept in step with the opportunities sheet. */
function newOpportunity(u: DUser, f: { number: string; title: string; account: string; type?: string | null;
  vertical?: string | null; value?: string; submissionDate?: string; presalesReceived?: string; presalesLead?: string;
  accountManager?: string; sow?: string }, source: "manual" | "sheet") {
  const t = now();
  const o: DOpp = { id: uid(), opportunity_number: f.number, title: f.title, account_name: f.account,
    opportunity_type: f.type ?? null, vertical: f.vertical ?? null, source,
    status: "draft", owner_id: u.id, team_id: u.team_id, manager_id: team(u.team_id)?.manager_id ?? null,
    director_id: team(u.team_id)?.director_id ?? null, current_version_id: "", ai_readiness: null,
    has_critical_findings: false, created_at: t, updated_at: t };
  const v: DVersion = { id: uid(), opportunity_id: o.id, version_number: 1,
    change_notes: source === "sheet" ? "Created from the opportunities sheet" : "Initial version", is_locked: false,
    locked_at: null, submitted_at: null, revision: 0, created_at: t, updated_at: t, created_by: u.id, updated_by: u.id,
    data: { customer: o.account_name, oppName: o.title, oppNumber: f.number, presalesOwner: f.presalesLead || u.full_name,
            accountManager: f.accountManager ?? "", value: f.value ?? "", background: "", sow: f.sow ?? "",
            submissionDate: f.submissionDate ?? "", presalesReceived: f.presalesReceived ?? "" } };
  o.current_version_id = v.id;
  db.opportunities.push(o); db.versions.push(v);
  db.history.push({ id: db.seq++, opportunity_id: o.id, version_id: v.id, action: "create", from_status: null, to_status: "draft",
    actor_id: u.id, comment: source === "sheet" ? "Created from the opportunities sheet" : null, created_at: t });
  audit("opportunity.created", { entity_type: "opportunity", entity_id: o.id, opportunity_id: o.id, details: { number: f.number, source } });
  audit("version.created", { entity_type: "opportunity_version", entity_id: v.id, opportunity_id: o.id, details: { version: 1 } });
  return o;
}

interface SheetRow { number: string; title: string; account: string; type?: string; vertical?: string; value?: string;
  submission_date?: string; presales_received?: string; presales_lead?: string; account_manager?: string; sow?: string;
  strategic?: string; previous_projects?: string }
const yes = (v?: string) => ["yes", "y", "true", "1", "نعم", "x", "✓"].includes(String(v ?? "").trim().toLowerCase());

/** Compares the opportunities sheet (the CRM "Opportunity Advanced Find View") with the portal. Rows not yet in
    the portal become active opportunities; every other opportunity missing from the sheet is archived (and
    restored if it comes back). Only opportunities created by hand with "Create opportunity" are never touched.
    Opportunities that predate the source flag (e.g. demo data) are treated as sheet-managed. */
function sheetPlan(rows: SheetRow[]) {
  const seen = new Map<string, SheetRow>();
  const invalid: { row: number; reason: string }[] = [];
  rows.forEach((r, i) => {
    const number = String(r.number ?? "").replace(/\s+/g, "").toUpperCase();
    if (!number) { invalid.push({ row: i + 2, reason: "No opportunity number" }); return; }
    if (!/^[A-Z0-9][A-Z0-9\-_/]{2,40}$/.test(number)) { invalid.push({ row: i + 2, reason: `Number “${r.number}” is not valid` }); return; }
    if (!String(r.title ?? "").trim()) { invalid.push({ row: i + 2, reason: `${number}: no opportunity name` }); return; }
    if (seen.has(number)) { invalid.push({ row: i + 2, reason: `${number} appears more than once` }); return; }
    seen.set(number, { ...r, number, title: String(r.title).trim(), account: String(r.account ?? "").trim() || "—" });
  });
  const byNumber = new Map(db.opportunities.map((o) => [o.opportunity_number, o]));
  const brief = (o: DOpp | SheetRow) => ("opportunity_number" in o
    ? { number: o.opportunity_number, title: o.title, account: o.account_name }
    : { number: o.number, title: o.title, account: o.account });
  const add = [...seen.values()].filter((r) => !byNumber.has(r.number));
  const restore = db.opportunities.filter((o) => (o.source ?? "sheet") === "sheet" && o.is_archived && seen.has(o.opportunity_number));
  const archive = db.opportunities.filter((o) => (o.source ?? "sheet") === "sheet" && !o.is_archived
    && o.status !== "completed" && !seen.has(o.opportunity_number));
  const manual = db.opportunities.filter((o) => (o.source ?? "sheet") === "manual" && seen.has(o.opportunity_number));
  const unchanged = db.opportunities.filter((o) => (o.source ?? "sheet") === "sheet" && !o.is_archived && seen.has(o.opportunity_number));
  return { seen, add, restore, archive, manual, unchanged, invalid,
    summary: { rows: rows.length, add: add.map(brief), restore: restore.map(brief), archive: archive.map(brief),
               manual: manual.map(brief), unchanged: unchanged.length, invalid } };
}


/** Records a new DeepDive version holding `data`. The current version is kept as it was (locked). A still-empty
    first draft (never saved) is filled in place instead, so a fresh opportunity does not start with a blank v1. */
function recordVersion(u: DUser, o: DOpp, data: Record<string, any>, note: string, action: string) {
  const current = db.versions.find((x) => x.id === o.current_version_id)!;
  const t = now();
  const master = { oppNumber: o.opportunity_number, oppName: o.title, customer: o.account_name };
  let v: DVersion;
  if (!current.is_locked && current.revision === 0 && current.version_number === 1) {
    v = current;
    v.data = { ...current.data, ...data, ...master };
    v.change_notes = note; v.revision += 1;
  } else {
    if (!current.is_locked) { current.is_locked = true; current.locked_at = t; }
    v = { id: uid(), opportunity_id: o.id, version_number: Math.max(...versionsOf(o.id).map((x) => x.version_number)) + 1,
      change_notes: note, is_locked: false, locked_at: null, submitted_at: null, revision: 1, created_at: t, updated_at: t,
      created_by: u.id, updated_by: u.id, data: { ...data, ...master } };
    activeDocs(o.id, current.id).forEach((d) => db.documents.push({ ...d, id: uid(), version_id: v.id }));
    db.versions.push(v); o.current_version_id = v.id;
  }
  // Every recorded version is a reference point: it is locked straight away and only ever replaced by a newer one.
  v.is_locked = true; v.locked_at = t; v.submitted_at = t; v.updated_at = t; v.updated_by = u.id;
  o.updated_at = t;
  db.history.push({ id: db.seq++, opportunity_id: o.id, version_id: v.id, action, from_status: o.status, to_status: o.status,
    actor_id: u.id, comment: `v${v.version_number}: ${note}`, created_at: t });
  audit("version.created", { entity_type: "opportunity_version", entity_id: v.id, opportunity_id: o.id,
    details: { version: v.version_number, note } });
  return v;
}

const routes: [string, RegExp, Handler][] = [
  ["POST", /^\/auth\/login$/, (_m, body) => {
    const u = db.users.find((x) => x.username.toLowerCase() === String(body.username ?? "").trim().toLowerCase());
    if (!u || u.password !== body.password || !u.is_active) { audit("auth.login", { actor_username: body.username, outcome: "failure" }); persist(); err(401, "Incorrect username or password."); }
    db.session = u!.id; u!.last_login_at = now();
    audit("auth.login"); persist();
    return meOut(u!);
  }],
  // Single-user portal: there is no one else to sign in as, so signing out keeps the session.
  ["POST", /^\/auth\/logout$/, () => null],
  ["GET", /^\/auth\/me$/, () => meOut(requireUser())],
  ["POST", /^\/auth\/change-password$/, (_m, body) => {
    const u = requireUser();
    if (u.password !== body.current_password) err(400, "Current password is incorrect.");
    const p = String(body.new_password ?? "");
    const problems = [ ...(p.length < 12 ? ["Use at least 12 characters."] : []),
      ...(/[a-zA-Z]/.test(p) && /\d/.test(p) ? [] : ["Use both letters and numbers."]) ];
    if (problems.length) err(422, { message: "Password does not meet the policy.", problems });
    u.password = p; u.must_change_password = false;
    audit("auth.password_changed", { entity_type: "user", entity_id: u.id }); persist();
    return meOut(u);
  }],

  ["GET", /^\/meta\/reference$/, () => {
    const u = requireUser();
    const directors = db.users.filter((x) => x.role === "portfolio_director");
    // Presales Leads, by the names on the opportunities' DeepDives.
    const owners = [...new Set(db.opportunities.filter((o) => !o.is_archived).map(leadName))]
      .sort((a, b) => a.localeCompare(b)).map((n) => ({ id: n, username: n, full_name: n }));
    return { roles: (Object.keys(ROLE_LABELS) as RoleKey[]).map((k) => ({ key: k, label: ROLE_LABELS[k] })),
      statuses: Object.entries(STATUS_LABELS).map(([key, label]) => ({ key, label })),
      directors: directors.map(ref),
      owners: u.role === "presales_account" ? [] : owners,
      managers: db.users.filter((x) => x.role === "portfolio_manager").map(ref),
      document_categories: DOCUMENT_CATEGORIES.map((c) => ({ key: c.value, label: c.label })),
      comment_types: COMMENT_TYPES.map((key) => ({ key, label: key.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase()) })),
      priorities: PRIORITIES,
      deepdive_sections: DEEPDIVE_SECTIONS.map(([key, label]) => ({ key, label })),
      max_upload_mb: MAX_UPLOAD_MB };
  }],

  ["GET", /^\/opportunities$/, (_m, _b, q) => {
    const u = requireUser();
    let rows = visible(u).filter((o) => !!o.is_archived === (q.get("archived") === "1"));
    const statuses = q.getAll("status");
    const text = (q.get("q") ?? "").toLowerCase();
    if (text) rows = rows.filter((o) => `${o.title} ${o.account_name} ${o.opportunity_number}`.toLowerCase().includes(text));
    const like = (k: string, val: string | null) => { if (val) rows = rows.filter((o) => (o as any)[k].toLowerCase().includes(val.toLowerCase())); };
    like("account_name", q.get("account")); like("opportunity_number", q.get("number"));
    if (statuses.length) rows = rows.filter((o) => statuses.includes(o.status));
    if (q.get("owner_id")) rows = rows.filter((o) => leadName(o) === q.get("owner_id"));
    if (q.get("director_id")) rows = rows.filter((o) => team(o.team_id)?.director_id === q.get("director_id"));
    if (q.get("critical")) rows = rows.filter((o) => o.has_critical_findings);
    if (q.get("active")) rows = rows.filter((o) => o.status !== "completed");
    if (q.get("assigned_to_me")) rows = rows.filter((o) => o.manager_id === u.id || o.director_id === u.id);
    if (q.get("open_comments")) rows = rows.filter((o) => db.comments.some((c) => c.opportunity_id === o.id && c.status === "open"));
    if (q.get("attention")) {
      const ids = new Set(attentionFor(u).map((a) => a!.id));
      rows = rows.filter((o) => ids.has(o.id));
    }
    const readiness = q.get("ai_readiness");
    if (readiness) rows = rows.filter((o) => (readiness === "none" ? !o.ai_readiness : o.ai_readiness === readiness));
    const page = Number(q.get("page") ?? 1), size = Number(q.get("page_size") ?? 25);
    const sorted = [...rows].sort((a, b) => (q.get("sort") === "updated_at" ? a.updated_at.localeCompare(b.updated_at) : b.updated_at.localeCompare(a.updated_at)));
    return { items: sorted.slice((page - 1) * size, page * size).map(oppOut), total: rows.length, page, page_size: size };
  }],
  ["POST", /^\/opportunities$/, (_m, body) => {
    const u = requirePerm("opportunity.create");
    if (!u.team_id) err(422, { message: "Your account is not assigned to a Presales Director's team yet. Ask an Admin to assign you." });
    const number = String(body.opportunity_number ?? "").replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9\-_/]{2,40}$/.test(number)) err(422, { message: "Opportunity number format is not valid (e.g. OP-2026-159388)." });
    if (db.opportunities.some((o) => o.opportunity_number === number)) err(409, { message: `Opportunity ${number} already exists.`, code: "duplicate_number" });
    const o = newOpportunity(u, { number, title: String(body.title).trim(), account: String(body.account_name).trim(),
      type: body.opportunity_type ?? null, vertical: body.vertical ?? null }, "manual");
    persist();
    return detailOut(u, o);
  }],
  ["POST", /^\/opportunities\/import-sheet$/, (_m, body) => {
    const u = requirePerm("opportunity.create");
    const rows = Array.isArray(body?.rows) ? (body.rows as SheetRow[]) : [];
    if (!rows.length) err(422, { message: "The sheet has no opportunity rows." });
    const plan = sheetPlan(rows);
    if (!body.apply) return plan.summary;
    const t = now();
    plan.add.map((r) => newOpportunity(u, { number: r.number, title: r.title, account: r.account, type: r.type || null,
      vertical: r.vertical || null, value: r.value, submissionDate: r.submission_date, presalesReceived: r.presales_received,
      presalesLead: r.presales_lead, accountManager: r.account_manager, sow: r.sow }, "sheet"))
      .forEach((o, i) => { const r = plan.add[i]; o.strategic = yes(r.strategic); o.previous_projects = yes(r.previous_projects); });
    // Sheet columns, when present, keep the two flags of sheet-managed opportunities up to date.
    plan.unchanged.concat(plan.restore).forEach((o) => {
      const r = plan.seen.get(o.opportunity_number);
      if (r?.strategic !== undefined && r.strategic !== "") o.strategic = yes(r.strategic);
      if (r?.previous_projects !== undefined && r.previous_projects !== "") o.previous_projects = yes(r.previous_projects);
    });
    plan.archive.forEach((o) => {
      o.is_archived = true; o.updated_at = t;
      db.history.push({ id: db.seq++, opportunity_id: o.id, version_id: o.current_version_id, action: "archived", from_status: o.status,
        to_status: o.status, actor_id: u.id, comment: "Archived: no longer in the opportunities sheet", created_at: t });
    });
    plan.restore.forEach((o) => {
      o.is_archived = false; o.updated_at = t;
      db.history.push({ id: db.seq++, opportunity_id: o.id, version_id: o.current_version_id, action: "restored", from_status: o.status,
        to_status: o.status, actor_id: u.id, comment: "Restored: back in the opportunities sheet", created_at: t });
    });
    audit("opportunities.sheet_imported", { details: { added: plan.add.length, archived: plan.archive.length,
      restored: plan.restore.length, skipped_manual: plan.manual.length, invalid: plan.invalid.length } });
    persist();
    return { ...plan.summary, applied: true };
  }],
  ["GET", /^\/opportunities\/([^/]+)$/, (m) => { const u = requireUser(); return detailOut(u, getOpp(u, m[1])); }],
  ["PATCH", /^\/opportunities\/([^/]+)\/flags$/, (m, body) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    if (typeof body?.strategic === "boolean") o.strategic = body.strategic;
    if (typeof body?.previous_projects === "boolean") o.previous_projects = body.previous_projects;
    o.updated_at = now();
    audit("opportunity.flags_updated", { entity_type: "opportunity", entity_id: o.id, opportunity_id: o.id,
      details: { strategic: o.strategic, previous_projects: o.previous_projects } });
    persist();
    return detailOut(u, o);
  }],
  // ---------------------------------------------------------------- shared folder
  ["POST", /^\/opportunities\/([^/]+)\/folder$/, (m, body) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    o.folder_name = body?.name ? String(body.name) : null;
    if (!o.folder_name) o.folder_signature = null;
    audit("opportunity.folder_linked", { entity_type: "opportunity", entity_id: o.id, opportunity_id: o.id, details: { folder: o.folder_name } });
    persist();
    return { folder_name: o.folder_name };
  }],
  ["POST", /^\/opportunities\/([^/]+)\/folder-import$/, (m, body) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    // Manual uploads always record a version and leave the folder's last-read marker alone.
    const manual = !!body?.manual;
    const signature = String(body?.signature ?? "");
    if (!manual && signature && signature === o.folder_signature) return { changed: false };
    const current = db.versions.find((x) => x.id === o.current_version_id)!;
    const data: Record<string, any> = body?.data && typeof body.data === "object" ? clone(body.data) : clone(current.data);
    if (Array.isArray(body?.groups)) data.groups = body.groups;
    const files = [body?.files?.deepdive, body?.files?.checklist].filter(Boolean).join(" + ");
    const v = recordVersion(u, o, data, `${manual ? "Uploaded" : "From the shared folder"}: ${files || "DeepDive files"}`,
      manual ? "manual_upload" : "folder_import");
    if (!manual) o.folder_signature = signature || null;
    // A new DeepDive from the Presales Lead goes back to review (and a new DeepDive session) before AI analysis.
    if (o.status !== "completed" && o.status !== "submitted") {
      const from = o.status; o.status = "submitted";
      db.history.push({ id: db.seq++, opportunity_id: o.id, version_id: v.id, action: "submit", from_status: from,
        to_status: "submitted", actor_id: u.id, comment: manual ? "New DeepDive uploaded" : "New DeepDive from the shared folder", created_at: now() });
    }
    persist();
    return { changed: true, version_number: v.version_number, version_id: v.id };
  }],
  ["GET", /^\/opportunities\/([^/]+)\/versions$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    return versionsOf(o.id).map((v) => versionOut(v, o.current_version_id));
  }],
  ["GET", /^\/opportunities\/([^/]+)\/versions\/([^/]+)$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    const v = db.versions.find((x) => x.id === m[2] && x.opportunity_id === o.id);
    if (!v) err(404, "Version not found.");
    return { ...versionOut(v!, o.current_version_id), data: v!.data };
  }],
  ["PUT", /^\/opportunities\/([^/]+)\/versions\/([^/]+)\/deepdive$/, (m, body) => {
    const u = requireUser();
    const o = getOpp(u, m[1]);
    const v = db.versions.find((x) => x.id === m[2] && x.opportunity_id === o.id);
    if (!v) err(404, "Version not found.");
    if (!canEdit(u, o, v!)) {
      if (v!.is_locked) err(409, { message: "This version is locked. Create a new version to make changes.", code: "version_locked" });
      err(403, "You cannot edit this DeepDive in its current state.");
    }
    if (v!.revision !== body.revision) err(409, { message: "Someone else saved this DeepDive. Reload to see the latest changes.", code: "stale_revision", current_revision: v!.revision });
    // The opportunity record is the master for these fields, whatever the builder sends.
    const data = { ...body.data, oppNumber: o.opportunity_number, oppName: o.title, customer: o.account_name,
                   presalesOwner: user(o.owner_id)?.full_name ?? "" };
    v!.data = data; v!.revision += 1; v!.updated_at = now(); v!.updated_by = u.id; o.updated_at = now();
    audit("opportunity.updated", { entity_type: "opportunity_version", entity_id: v!.id, opportunity_id: o.id, details: { version: v!.version_number, revision: v!.revision } });
    persist();
    return versionOut(v!, o.current_version_id);
  }],
  ["POST", /^\/opportunities\/([^/]+)\/versions$/, (m, body) => {
    const u = requireUser();
    const o = getOpp(u, m[1]);
    if (!canCreateVersion(u, o)) err(403, "A new version can be opened by the opportunity owner, the Portfolio "
      + "Presales Manager or the Portfolio Presales Director.");
    if (!String(body.change_notes ?? "").trim()) err(422, { message: "Describe what changes in this version." });
    const current = db.versions.find((x) => x.id === o.current_version_id)!;
    if (!current.is_locked) { current.is_locked = true; current.locked_at = now(); }
    const t = now();
    const v: DVersion = { id: uid(), opportunity_id: o.id, version_number: Math.max(...versionsOf(o.id).map((x) => x.version_number)) + 1,
      change_notes: String(body.change_notes).trim(), is_locked: false, locked_at: null, submitted_at: null, revision: 0,
      created_at: t, updated_at: t, created_by: u.id, updated_by: u.id,
      data: { ...clone(current.data), oppNumber: o.opportunity_number } };   // full copy, same number
    // The new version starts with the documents of the one it was copied from.
    activeDocs(o.id, current.id).forEach((d) => db.documents.push({ ...d, id: uid(), version_id: v.id }));
    db.versions.push(v); o.current_version_id = v.id; o.updated_at = t;
    applyGovernance(o);                 // governance items raised since the last version land here
    if (o.status !== "draft") {
      // The reviewed version stays as it was; the opportunity returns to Draft for the new one.
      const from = o.status;
      o.status = "draft";
      db.history.push({ id: db.seq++, opportunity_id: o.id, version_id: v.id, action: "new_version",
        from_status: from, to_status: "draft", actor_id: u.id,
        comment: `Version ${v.version_number} opened by ${u.full_name}`, created_at: now() });
      notify([o.owner_id, o.manager_id, o.director_id], "opportunity.new_version",
        `New version opened: ${o.title}`, `${o.opportunity_number} · v${v.version_number}`, o.id);
    }
    audit("version.created", { entity_type: "opportunity_version", entity_id: v.id, opportunity_id: o.id, details: { version: v.version_number, based_on: current.version_number } });
    persist();
    return versionOut(v, o.current_version_id);
  }],
  ["GET", /^\/opportunities\/([^/]+)\/history$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    return db.history.filter((h) => h.opportunity_id === o.id).sort((a, b) => b.id - a.id).map((h) => ({
      id: h.id, action: h.action, from_status: h.from_status, to_status: h.to_status,
      from_label: h.from_status ? STATUS_LABELS[h.from_status] : null, to_label: STATUS_LABELS[h.to_status],
      actor: ref(user(h.actor_id)), comment: h.comment,
      version_number: db.versions.find((v) => v.id === h.version_id)?.version_number ?? null, created_at: h.created_at }));
  }],
  ["POST", /^\/opportunities\/([^/]+)\/transitions$/, (m, body) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    transition(u, o, body.action, body.comment);
    return detailOut(u, o);
  }],

  ["PATCH", /^\/opportunities\/([^/]+)$/, (m, body) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    if (!(canEditAny(u, o) || MANAGEMENT_ROLES.includes(u.role))) err(403, "You cannot change this opportunity.");
    (["title", "account_name", "opportunity_type", "vertical"] as const).forEach((f) => {
      if (body[f] !== undefined && body[f] !== null) (o as unknown as Record<string, unknown>)[f] = String(body[f]).trim() || null;
    });
    audit("opportunity.updated", { entity_type: "opportunity", entity_id: o.id, opportunity_id: o.id, details: body });
    persist();
    return detailOut(u, o);
  }],
  ["GET", /^\/admin\/verticals$/, () => { requireUser();
    return (db.verticals ?? []).map((v) => ({ ...v,
      sales_director: ref(user(v.sales_director_id ?? null)),
      // a Sales Director can also carry accounts, so anyone assigned to the vertical is listed
      account_managers: db.users.filter((u) => u.vertical_id === v.id).map(ref) })); }],
  ["POST", /^\/admin\/verticals$/, (_m, body) => {
    requirePerm("team.manage");
    const name = String(body.name ?? "").trim();
    if (name.length < 2) err(422, "Enter a vertical name.");
    if ((db.verticals ?? []).some((v) => v.name.toLowerCase() === name.toLowerCase()))
      err(409, { message: "That vertical already exists.", code: "duplicate_vertical" });
    const v = { id: uid(), name, is_active: true };
    db.verticals = [...(db.verticals ?? []), v];
    audit("vertical.created", { entity_type: "vertical", entity_id: v.id, details: { name } });
    persist();
    return v;
  }],
  ["PATCH", /^\/admin\/verticals\/([^/]+)$/, (m, body) => {
    requirePerm("team.manage");
    const v = (db.verticals ?? []).find((x) => x.id === m[1]);
    if (!v) err(404, "Vertical not found.");
    if (body.name) v!.name = String(body.name).trim();
    if (body.is_active !== undefined) v!.is_active = !!body.is_active;
    audit("vertical.updated", { entity_type: "vertical", entity_id: v!.id, details: body });
    persist();
    return v;
  }],
  ["DELETE", /^\/admin\/verticals\/([^/]+)$/, (m) => {
    requirePerm("team.manage");
    const v = (db.verticals ?? []).find((x) => x.id === m[1]);
    if (!v) err(404, "Vertical not found.");
    db.verticals = (db.verticals ?? []).filter((x) => x.id !== m[1]);
    audit("vertical.deleted", { entity_type: "vertical", entity_id: v!.id, details: { name: v!.name } });
    persist();
    return null;
  }],
  ["GET", /^\/admin\/ai-settings$/, () => {
    const u = requirePerm("ai.view");
    return { ...aiSettings(), can_edit: PERMISSIONS[u.role].includes("ai_settings.manage") };
  }],
  ["PUT", /^\/admin\/ai-settings$/, (_m, body) => {
    requirePerm("ai_settings.manage");
    if (body.system_prompt !== undefined) {
      const prompt = String(body.system_prompt).trim();
      if (prompt.length < 50) err(422, "The prompt is too short to be useful.");
      db.aiPrompt = prompt;
    }
    db.aiConfig = {
      generation: { ...AI_DEFAULTS.generation, ...(db.aiConfig?.generation ?? {}), ...(body.generation ?? {}) },
      retrieval: { ...AI_DEFAULTS.retrieval, ...(db.aiConfig?.retrieval ?? {}), ...(body.retrieval ?? {}) },
      fine_tuning: { ...AI_DEFAULTS.fine_tuning, ...(db.aiConfig?.fine_tuning ?? {}), ...(body.fine_tuning ?? {}) },
    };
    audit("ai_settings.updated", { entity_type: "ai_settings", details: { sections: Object.keys(body) } });
    persist();
    return aiSettings();
  }],
  ["POST", /^\/opportunities\/([^/]+)\/archive$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    if (!canDelete(u, o)) err(403, "You can archive your own opportunities only.");
    o.is_archived = true;               // soft: nothing attached to it is removed
    o.updated_at = now();
    audit("opportunity.archived", { entity_type: "opportunity", entity_id: o.id, opportunity_id: o.id,
      details: { number: o.opportunity_number, status: o.status } });
    persist();
    return detailOut(u, o);
  }],
  ["POST", /^\/opportunities\/([^/]+)\/restore$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    if (!canDelete(u, o)) err(403, "You cannot restore this opportunity.");
    o.is_archived = false;
    audit("opportunity.restored", { entity_type: "opportunity", entity_id: o.id, details: { number: o.opportunity_number } });
    persist();
    return detailOut(u, o);
  }],
  ["DELETE", /^\/opportunities\/([^/]+)$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    if (!canDelete(u, o)) err(403, "You can delete your own opportunities only.");
    // Anything that has been submitted is archived rather than destroyed.
    const wasSubmitted = db.versions.some((v) => v.opportunity_id === o.id && v.submitted_at);
    if (wasSubmitted && u.role !== "admin") {
      o.is_archived = true;
      o.updated_at = now();
      audit("opportunity.archived", { entity_type: "opportunity", entity_id: o.id,
        details: { number: o.opportunity_number, status: o.status } });
      persist();
      return { outcome: "archived" };
    }
    db.versions = db.versions.filter((v) => v.opportunity_id !== o.id);
    db.documents.filter((d) => d.opportunity_id === o.id).forEach((d) => fileBytes.delete(d.id));
    db.documents = db.documents.filter((d) => d.opportunity_id !== o.id);
    db.comments = db.comments.filter((c) => c.opportunity_id !== o.id);
    db.decisions = db.decisions.filter((d) => d.opportunity_id !== o.id);
    db.runs = db.runs.filter((r) => r.opportunity_id !== o.id);
    db.history = db.history.filter((h) => h.opportunity_id !== o.id);
    db.opportunities = db.opportunities.filter((x) => x.id !== o.id);
    audit("opportunity.deleted", { entity_type: "opportunity", entity_id: o.id,
      details: { number: o.opportunity_number, title: o.title, status: o.status } });
    persist();
    return { outcome: "deleted" };
  }],
  // ---------------------------------------------------------------- review & governance
  ["GET", /^\/opportunities\/([^/]+)\/governance$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    const latest = versionsOf(o.id).sort((a, b) => b.version_number - a.version_number)[0];
    const t = team(o.team_id);
    // Owner choices: the opportunity's people and the team's members, without duplicates.
    const ids = [o.owner_id, o.manager_id, o.director_id, t?.manager_id, t?.director_id,
      ...db.users.filter((x) => x.team_id === o.team_id && x.is_active).map((x) => x.id), u.id];
    const owners = [...new Set(ids.filter(Boolean) as string[])].map((id) => user(id)).filter(Boolean)
      .map((x) => ({ name: x!.full_name, role: ROLE_LABELS[x!.role] }));
    return {
      can_add: canRaiseGovernance(u, o),
      latest_version: latest?.version_number ?? null,
      latest_locked: !!latest?.is_locked,
      owners,
      items: (db.governance ?? []).filter((g) => g.opportunity_id === o.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((g) => ({ ...g, status: g.status ?? "open", due_date: g.due_date ?? null,
                       can_manage: canManageGovernance(u, o, g) })),
    };
  }],
  ["POST", /^\/opportunities\/([^/]+)\/governance$/, (m, body) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    if (!canRaiseGovernance(u, o)) err(403, "You cannot add items to this opportunity.");
    const kind = body.kind === "support" ? "support" : "risk";
    const title = String(body.title ?? "").trim();
    if (title.length < 4) err(422, { message: "Enter a title of at least 4 characters." });
    if (!String(body.detail ?? "").trim()) err(422, { message: "Describe the item, its impact and any required action." });
    if (String(body.detail ?? "").length > 1000) err(422, { message: "The description is limited to 1000 characters." });
    if (!String(body.owner ?? "").trim()) err(422, { message: "Choose an owner." });
    const item: DGovernance = {
      id: uid(), opportunity_id: o.id, kind, title, detail: String(body.detail ?? "").trim(),
      impact: String(body.impact ?? "High"), owner: String(body.owner ?? "").trim() || u.full_name,
      created_by: u.full_name, created_by_role: ROLE_LABELS[u.role], created_at: now(), applied_to_version: null,
      status: "open", due_date: String(body.due_date ?? "").slice(0, 10) || null, created_by_id: u.id, closed_at: null,
    };
    db.governance = [...(db.governance ?? []), item];
    audit("governance.added", { entity_type: "governance", entity_id: item.id, opportunity_id: o.id,
      details: { kind, title } });
    notify([o.owner_id], "governance.added", `${kind === "risk" ? "Risk" : "Support needed"} raised: ${o.title}`,
      `${item.created_by} (${item.created_by_role}): ${title}`, o.id);
    // Every item becomes part of the DeepDive at once, as a new version (the DeepDive stays the single reference).
    const current = db.versions.find((x) => x.id === o.current_version_id)!;
    const data: Record<string, any> = clone(current.data);
    const entry = kind === "risk"
      ? { risk: item.title, mitigation: item.detail || "To be defined with the owner", owner: item.owner, date: item.due_date ?? "",
          impact: item.impact, source: `Review & Governance — ${item.created_by_role}` }
      : { need: item.title, from: item.owner, priority: item.impact, date: item.due_date ?? "",
          source: `Review & Governance — ${item.created_by_role}` };
    if (kind === "risk") data.riskTech = [...(data.riskTech ?? []), entry];
    else data.support = [...(data.support ?? []), entry];
    const v = recordVersion(u, o, data, `${kind === "risk" ? "Risk" : "Support need"} added: ${item.title}`, "governance");
    item.applied_to_version = v.version_number;
    persist();
    return { ...item, version_number: v.version_number, data: v.data, opportunity_number: o.opportunity_number };
  }],

  ["POST", /^\/opportunities\/([^/]+)\/governance\/([^/]+)\/status$/, (m, body) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    const g = (db.governance ?? []).find((x) => x.id === m[2] && x.opportunity_id === o.id);
    if (!g) err(404, "Item not found.");
    if (!canManageGovernance(u, o, g!)) err(403, "Only the person who added it, the owner or management can change it.");
    g!.status = body.status === "closed" ? "closed" : "open";
    g!.closed_at = g!.status === "closed" ? now() : null;
    audit(`governance.${g!.status === "closed" ? "closed" : "reopened"}`, { entity_type: "governance", entity_id: g!.id,
      opportunity_id: o.id, details: { title: g!.title } });
    persist();
    return { ok: true };
  }],
  ["DELETE", /^\/opportunities\/([^/]+)\/governance\/([^/]+)$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    const g = (db.governance ?? []).find((x) => x.id === m[2] && x.opportunity_id === o.id);
    if (!g) err(404, "Item not found.");
    if (!canManageGovernance(u, o, g!)) err(403, "Only the person who added it, the owner or management can delete it.");
    db.governance = (db.governance ?? []).filter((x) => x.id !== g!.id);
    audit("governance.deleted", { entity_type: "governance", entity_id: g!.id, opportunity_id: o.id, details: { title: g!.title } });
    persist();
    return null;
  }],

  // ---------------------------------------------------------------- opportunity workspace
  ["GET", /^\/opportunities\/([^/]+)\/workspace$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    const versions = versionsOf(o.id).sort((a, b) => b.version_number - a.version_number);
    const current = versions.find((v) => v.id === o.current_version_id) ?? versions[0];
    const reviewedVersion = versions.find((v) => v.is_locked) ?? null;   // the submitted version the AI reads
    const docsOf = (versionId: string) => activeDocs(o.id, versionId)
      .map((d) => ({ category: d.category, file_name: d.file_name, doc_version: d.doc_version }));
    const reviewedDocs = reviewedVersion ? docsOf(reviewedVersion.id) : [];
    const runs: Record<string, { version_number: number; inputs: string; status: string }> = {};
    (db.analyses ?? []).filter((a) => a.opportunity_id === o.id).forEach((a) => {
      runs[a.kind] = { version_number: a.version_number, inputs: a.inputs, status: a.status };
    });
    const analyses = eligibility({ reviewed: reviewedVersion ? { version_number: reviewedVersion.version_number } : null,
                                   docs: reviewedDocs, runs });
    const comments = db.comments.filter((c) => c.opportunity_id === o.id);
    // Every submitted version needs its own session confirmation.
    const sessionConfirmed = !!reviewedVersion && o.session_confirmed_version_id === reviewedVersion.id;

    return {
      steps: [
        { key: "builder", title: "DeepDive Builder",
          status: current?.is_locked ? "completed" : missingFields(current?.data ?? {}).length ? "in_progress" : "completed",
          detail: current ? `v${current.version_number}${current.is_locked ? " submitted" : " in progress"}` : "" },
        { key: "review", title: "Review & Governance",
          status: sessionConfirmed ? "completed" : current?.is_locked ? "waiting" : "locked",
          detail: sessionConfirmed ? `Session confirmed for v${reviewedVersion!.version_number}`
            : current?.is_locked ? "Waiting for the DeepDive session" : "Submit a version to start the review" },
        { key: "ai", title: "AI Analysis",
          status: !sessionConfirmed ? "locked" : analyses.every((a) => a.status === "completed") ? "completed" : "ready",
          detail: sessionConfirmed
            ? `Session confirmed for v${reviewedVersion!.version_number} by ${user(o.session_confirmed_by ?? null)?.full_name ?? ""} · ${analyses.filter((a) => a.status === "completed").length} of ${analyses.length} analyses completed${(() => { const n = analyses.filter((a) => a.status === "ready" || a.status === "reanalysis_required").length; return n ? ` · ${n} ready to run` : ""; })()}`
            : reviewedVersion
              ? `Locked until the DeepDive session for v${reviewedVersion.version_number} is done`
              : "Locked until the DeepDive session is done" },
      ],
      current_version: current ? { id: current.id, version_number: current.version_number, is_locked: current.is_locked } : null,
      reviewed_version: reviewedVersion
        ? { id: reviewedVersion.id, version_number: reviewedVersion.version_number,
            reviewed_by: reviewerOf(o.id, reviewedVersion.id), snapshot: snapshot(docsOf(reviewedVersion.id)) }
        : null,
      snapshot: snapshot(docsOf(current?.id ?? "")),
      analyses,
      findings: (db.findings ?? []).filter((f) => f.id.includes("-") && findingOpp(f.id) === o.id),
      tracker: (db.tracker ?? []).filter((t) => t.opportunity_id === o.id),
      comment_count: comments.length,
      can_review: isReviewer(u, o) && !!current?.is_locked && !sessionConfirmed,
      session_confirmed: sessionConfirmed,
      session_version: reviewedVersion ? reviewedVersion.version_number : null,
      session_confirmed_by: user(o.session_confirmed_by ?? null)?.full_name ?? null,
      // Only the Presales Director or Manager confirms that the DeepDive session took place.
      can_confirm_session: ["portfolio_director", "portfolio_manager", "admin"].includes(u.role)
        && !!reviewedVersion && !sessionConfirmed,
      can_run_ai: (isReviewer(u, o) || u.role === "admin" || o.owner_id === u.id) && sessionConfirmed,
      can_accept: o.owner_id === u.id || isReviewer(u, o) || u.role === "admin",
    };
  }],
  ["POST", /^\/opportunities\/([^/]+)\/session-confirm$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    if (!["portfolio_director", "portfolio_manager", "admin"].includes(u.role))
      err(403, "The Presales Director or Presales Manager confirms the DeepDive session.");
    const submitted = versionsOf(o.id).sort((a, b) => b.version_number - a.version_number).find((v) => v.is_locked);
    if (!submitted) err(409, { message: "Submit a DeepDive version first.", code: "not_submitted" });
    o.session_confirmed_by = u.id;
    o.session_confirmed_at = now();
    o.session_confirmed_version_id = submitted!.id;   // a later version needs its own session
    // One step: the session confirmation opens the AI analysis, no separate review transitions.
    if (["submitted", "in_review"].includes(o.status)) {
      const from = o.status;
      o.status = "ready_for_ai";
      o.updated_at = now();
      db.history.push({ id: db.seq++, opportunity_id: o.id, version_id: o.current_version_id, action: "session_confirmed",
        from_status: from, to_status: "ready_for_ai", actor_id: u.id,
        comment: `DeepDive session confirmed by ${u.full_name}`, created_at: now() });
    }
    audit("deepdive.session_confirmed", { entity_type: "opportunity", entity_id: o.id, opportunity_id: o.id,
      details: { by: u.full_name } });
    notify([o.owner_id], "deepdive.session_confirmed", `DeepDive session confirmed: ${o.title}`,
      `${u.full_name} confirmed the session. AI Analysis is now open.`, o.id);
    persist();
    return { session_confirmed: true, by: u.full_name, at: o.session_confirmed_at };
  }],
  ["POST", /^\/opportunities\/([^/]+)\/analyses\/([^/]+)\/run$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]); const kind = m[2];
    const versions = versionsOf(o.id).sort((a, b) => b.version_number - a.version_number);
    const reviewed = versions.find((v) => v.is_locked);
    if (!reviewed) err(409, { message: "Submit the DeepDive for review first.", code: "not_submitted" });
    if (o.session_confirmed_version_id !== reviewed!.id)
      err(409, { message: `The DeepDive session for v${reviewed!.version_number} has not been confirmed yet.`,
                 code: "session_pending" });
    const docs = activeDocs(o.id, reviewed!.id)
      .map((d) => ({ category: d.category, file_name: d.file_name, doc_version: d.doc_version }));
    const state = eligibility({ reviewed: { version_number: reviewed!.version_number }, docs, runs: {} })
      .find((a) => a.kind === kind);
    if (!state || state.status === "not_eligible")
      err(409, { message: state ? state.reason : "Unknown analysis.", code: "not_eligible" });

    db.findings = (db.findings ?? []).filter((f) => !(findingOpp(f.id) === o.id && f.analysis === kind && f.status === "open"));
    const produced = analyseWorkspace(kind, {
      version: reviewed!.version_number, data: reviewed!.data, docs,
      comments: db.comments.filter((c) => c.opportunity_id === o.id).map((c) => ({ body: c.body, comment_type: c.comment_type })),
    }).map((f) => ({ ...f, id: `${o.id}::${f.id}` }));
    db.findings = [...(db.findings ?? []), ...produced];
    db.analyses = [...(db.analyses ?? []).filter((a) => !(a.opportunity_id === o.id && a.kind === kind)),
      { opportunity_id: o.id, kind, version_number: reviewed!.version_number, inputs: analysisInputs(kind, docs),
        status: "completed", started_at: now(), completed_at: now() }];
    audit("ai.analysis_completed", { entity_type: "ai_analysis", opportunity_id: o.id,
      details: { kind, version: reviewed!.version_number, findings: produced.length } });
    o.ai_readiness = "ready_with_actions";
    // The first completed analysis moves the opportunity on from "Ready for AI".
    if (o.status === "ready_for_ai") {
      o.status = "ai_recommendations"; o.updated_at = now();
      db.history.push({ id: db.seq++, opportunity_id: o.id, version_id: reviewed!.id, action: "ai_completed",
        from_status: "ready_for_ai", to_status: "ai_recommendations", actor_id: u.id,
        comment: `${analysesFor(o).find((a) => a.kind === kind)?.title ?? kind} completed`, created_at: now() });
    }
    persist();
    return { kind, findings: produced.length };
  }],
  ["POST", /^\/opportunities\/([^/]+)\/findings\/([^/]+)\/accept$/, (m, body) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    const f = (db.findings ?? []).find((x) => x.id === m[2]);
    if (!f) err(404, "Finding not found.");
    f!.status = "accepted";
    const versions = versionsOf(o.id).sort((a, b) => b.version_number - a.version_number);
    const reviewed = versions.find((v) => v.is_locked) ?? versions[0];
    const isQuestion = f!.type.toLowerCase().includes("question");
    db.tracker = [...(db.tracker ?? []), {
      id: uid(), opportunity_id: o.id, finding_id: f!.id, analysis: f!.analysis, type: f!.type, title: f!.title,
      original: f!.recommendation, accepted: String(body?.content ?? f!.recommendation).trim() || f!.recommendation,
      owner: String(body?.owner ?? user(o.owner_id)?.full_name ?? ""), status: isQuestion ? "waiting_customer" : "tracked",
      accepted_by: u.full_name, accepted_at: now(), source_version: reviewed?.version_number ?? 1,
      related_requirement: f!.related_requirement, customer_response: null,
    }];
    audit("ai.finding_accepted", { entity_type: "ai_finding", opportunity_id: o.id,
      details: { finding: f!.title, modified: !!body?.content } });
    persist();
    return { ok: true };
  }],
  ["POST", /^\/opportunities\/([^/]+)\/findings\/([^/]+)\/dismiss$/, (m) => {
    const u = requireUser(); getOpp(u, m[1]);
    const f = (db.findings ?? []).find((x) => x.id === m[2]);
    if (!f) err(404, "Finding not found.");
    f!.status = "dismissed";
    persist();
    return { ok: true };
  }],
  ["POST", /^\/opportunities\/([^/]+)\/findings\/([^/]+)\/restore$/, (m) => {
    const u = requireUser(); getOpp(u, m[1]);
    const f = (db.findings ?? []).find((x) => x.id === m[2]);
    if (!f) err(404, "Finding not found.");
    if (f!.status !== "dismissed") err(409, "Only a dismissed finding can be restored.");
    f!.status = "open";
    persist();
    return { ok: true };
  }],
  // AI Recommendations: every visible opportunity with its analyses and open findings, for the portfolio view.
  ["GET", /^\/ai\/portfolio$/, () => {
    const u = requireUser();
    return visible(u).filter((o) => !o.is_archived).map((o) => ({
      id: o.id, opportunity_number: o.opportunity_number, title: o.title, account_name: o.account_name,
      owner: leadName(o), status: o.status, status_label: STATUS_LABELS[o.status],
      submission_date: String((versionsOf(o.id).find((v) => v.id === o.current_version_id)?.data ?? {}).submissionDate ?? "").slice(0, 10) || null,
      analyses: analysesFor(o).map((a) => ({ kind: a.kind, title: a.title, status: a.status, missing: a.missing })),
      findings: (db.findings ?? []).filter((f) => findingOpp(f.id) === o.id)
        .map((f) => ({ id: f.id, analysis: f.analysis, type: f.type, severity: f.severity, title: f.title, status: f.status })),
    }));
  }],
  ["POST", /^\/opportunities\/([^/]+)\/tracker\/([^/]+)\/response$/, (m, body) => {
    const u = requireUser(); getOpp(u, m[1]);
    const item = (db.tracker ?? []).find((t) => t.id === m[2]);
    if (!item) err(404, "Tracker item not found.");
    item!.customer_response = String(body?.response ?? "").trim();
    item!.status = item!.customer_response ? "answered" : item!.status;
    audit("tracker.answered", { entity_type: "tracker_item", opportunity_id: m[1], details: { item: item!.title } });
    persist();
    return item;
  }],
  ["GET", /^\/opportunities\/([^/]+)\/readiness$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    return readinessFor(o);
  }],

  ["GET", /^\/dashboard\/attention$/, () => {
    const u = requirePerm("dashboard.executive");
    return { rows: monitorRows(u), portfolios: db.teams.map((t) => ({ id: t.id, name: t.name })) };
  }],
  ["GET", /^\/opportunities\/([^/]+)\/documents$/, (m, _b, q) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    if (!canViewDocs(u, o)) err(403, "You cannot open documents for this opportunity.");
    const selected = q.get("version_id") || o.current_version_id;
    const manage = canManageDocs(u, o) && selected === o.current_version_id;
    return activeDocs(o.id, selected).map((d) => docOut(d, manage));
  }],
  ["DELETE", /^\/opportunities\/([^/]+)\/documents\/([^/]+)$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    const doc = db.documents.find((d) => d.id === m[2] && d.opportunity_id === o.id && !d.deleted_at);
    if (!doc) err(404, "Document not found.");
    if (!canManageDocs(u, o)) err(403, "Documents can be removed by the owner before the opportunity is submitted.");
    doc!.deleted_at = now();
    fileBytes.delete(doc!.id);
    audit("document.deleted", { entity_type: "opportunity_document", entity_id: doc!.id, opportunity_id: o.id, details: { file_name: doc!.file_name } });
    persist();
    return null;
  }],

  ["GET", /^\/opportunities\/([^/]+)\/review$/, (m, _b, q) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    const selected = q.get("version_id") || o.current_version_id;
    const canComment = isReviewer(u, o) && selected === o.current_version_id;
    const comments = db.comments.filter((c) => c.opportunity_id === o.id && c.version_id === selected)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { can_comment: canComment, current_version_id: o.current_version_id, version_id: selected,
      open_count: comments.filter((c) => c.status === "open").length,
      decisions: db.decisions.filter((d) => d.opportunity_id === o.id && d.version_id === selected).sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((d) => ({ version_id: d.version_id, version_number: db.versions.find((v) => v.id === d.version_id)?.version_number ?? null,
                       reviewer: user(d.reviewer_id)?.full_name ?? "",
                       reviewer_role: ROLE_LABELS[user(d.reviewer_id)?.role ?? "presales_account"],
                       decision: d.decision, decided_at: d.decided_at, summary: d.summary })),
      comments: comments.map((c) => commentOut(c, canComment && c.created_by === u.id)) };
  }],
  ["POST", /^\/opportunities\/([^/]+)\/review\/comments$/, (m, body) => {
    const u = requirePerm("review.comment"); const o = getOpp(u, m[1]);
    if (!isReviewer(u, o)) err(403, "Only the Presales Director of this team can add review comments.");
    if (["critical_issue", "required_action"].includes(body.comment_type) && !body.priority)
      err(422, { message: "Set a priority for a required action or critical issue." });
    const c: DComment = { id: uid(), opportunity_id: o.id, version_id: body.version_id ?? o.current_version_id,
      comment_type: body.comment_type ?? "general", section: body.section ?? null, body: String(body.body).trim(),
      priority: body.priority ?? null, owner_name: body.owner_name ?? null, due_date: body.due_date ?? null,
      status: "open", created_by: u.id, created_at: now(), updated_at: now(), resolved_at: null };
    db.comments.push(c);
    audit("review.comment_added", { entity_type: "review_comment", entity_id: c.id, opportunity_id: o.id,
      details: { type: c.comment_type, section: c.section, priority: c.priority } });
    notify([o.owner_id], "review.comment", `New review comment: ${o.title}`, c.body.slice(0, 300), o.id);
    persist();
    return commentOut(c, true);
  }],
  ["PATCH", /^\/opportunities\/([^/]+)\/review\/comments\/([^/]+)$/, (m, body) => {
    const u = requirePerm("review.comment"); const o = getOpp(u, m[1]);
    const c = db.comments.find((x) => x.id === m[2] && x.opportunity_id === o.id);
    if (!c) err(404, "Comment not found.");
    if (c!.created_by !== u.id) err(403, "Only the author can change a review comment.");
    (["body", "section", "priority", "owner_name", "due_date"] as const).forEach((f) => {
      if (body[f] !== undefined && body[f] !== null) (c as unknown as Record<string, unknown>)[f] = body[f];
    });
    if (body.status) { c!.status = body.status; c!.resolved_at = body.status === "open" ? null : now(); }
    c!.updated_at = now();
    audit("review.comment_updated", { entity_type: "review_comment", entity_id: c!.id, opportunity_id: o.id, details: body });
    persist();
    return commentOut(c!, true);
  }],
  ["DELETE", /^\/opportunities\/([^/]+)\/review\/comments\/([^/]+)$/, (m) => {
    const u = requirePerm("review.comment"); const o = getOpp(u, m[1]);
    const c = db.comments.find((x) => x.id === m[2] && x.opportunity_id === o.id);
    if (!c) err(404, "Comment not found.");
    if (c!.created_by !== u.id) err(403, "Only the author can remove a review comment.");
    db.comments = db.comments.filter((x) => x.id !== c!.id);
    audit("review.comment_deleted", { entity_type: "review_comment", entity_id: c!.id, opportunity_id: o.id });
    persist();
    return null;
  }],

  ["POST", /^\/opportunities\/([^/]+)\/ai\/runs$/, (m) => {
    const u = requirePerm("ai.trigger"); const o = getOpp(u, m[1]);
    if (!(isReviewer(u, o) || u.role === "admin"))
      err(403, "AI analysis is started by the Presales Director of this team, or an Admin.");
    if (o.status !== "ready_for_ai")
      err(409, { message: "The opportunity must be marked Ready for AI before analysis can run.", code: "invalid_status" });
    const version = db.versions.find((v) => v.id === o.current_version_id)!;
    const documents = activeDocs(o.id);
    const run: DRun = {
      id: uid(), opportunity_id: o.id, version_id: version.id, triggered_by: u.id, status: "running",
      llm_model: "demo-rule-based-analyst (browser)", embedding_model: "keyword match (browser)",
      prompt_version: "demo", schema_version: "1.0", queued_at: now(), started_at: now(), completed_at: null,
      error_message: null, result: null, warnings: [],
      input_manifest: { version_number: version.version_number, deepdive_sha256: "demo",
        documents: documents.map((d) => ({ file_name: d.file_name, category: d.category, sha256: d.sha256 })) },
    };
    db.runs.push(run);
    audit("ai.requested", { entity_type: "ai_analysis_run", entity_id: run.id, opportunity_id: o.id,
      details: { version: version.version_number } });
    transition(u, o, "start_ai_analysis");
    void finishRun(run.id);            // runs just after this response, like the worker does
    persist();
    return runSummary(run);
  }],
  ["GET", /^\/opportunities\/([^/]+)\/ai\/runs$/, (m, _b, q) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    if (!canViewAi(u, o)) return [];
    const selected = q.get("version_id") || o.current_version_id;
    return db.runs.filter((r) => r.opportunity_id === o.id && r.version_id === selected)
      .sort((a, b) => b.queued_at.localeCompare(a.queued_at)).map(runSummary);
  }],
  ["GET", /^\/opportunities\/([^/]+)\/ai\/runs\/([^/]+)$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    if (!canViewAi(u, o)) err(403, "AI results become visible to you once the analysis is complete.");
    const run = db.runs.find((r) => r.id === m[2] && r.opportunity_id === o.id);
    if (!run) err(404, "AI analysis run not found.");
    const result = (run!.result ?? {}) as Record<string, any>;
    return { ...runSummary(run!), input_manifest: run!.input_manifest,
      executive_summary: result.executive_summary ?? null, confidence: result.confidence ?? null,
      director_comment_analysis: result.director_comment_analysis ?? [], validation_warnings: run!.warnings,
      findings: result.findings ?? [], recommendation: result.recommendation ?? null };
  }],
  ["GET", /^\/opportunities\/([^/]+)\/ai\/citations\/([^/]+)$/, (m) => {
    const u = requireUser(); const o = getOpp(u, m[1]);
    const chunk = (chunkStore.get(o.id) ?? []).find((c) => c.id === m[2]);
    if (!chunk) err(404, "Source not found.");
    return { id: chunk!.id, location: chunk!.location_label, source_kind: chunk!.source_kind,
             document_name: chunk!.document_name, text: chunk!.text, document_id: null };
  }],

  ["GET", /^\/dashboard\/summary$/, () => {
    const u = requireUser();
    const rows = visible(u);
    const unread = db.notifications.filter((n) => n.user_id === u.id && !n.read_at).length;
    const count = (statuses: string[]) => rows.filter((o) => statuses.includes(o.status)).length;
    const list = (statuses: string[], oldestFirst = false) => rows.filter((o) => statuses.includes(o.status))
      .sort((a, b) => (oldestFirst ? a.updated_at.localeCompare(b.updated_at) : b.updated_at.localeCompare(a.updated_at)))
      .slice(0, 10).map(oppOut);

    if (u.role === "admin" || MANAGEMENT_ROLES.includes(u.role)) {
      const monitor = monitorRows(u);
      const activeAll = rows.filter((o) => !o.is_archived && o.status !== "completed");
      const qualifying = new Set(monitor.map((r) => r.id));
      const attention = monitor.filter((r) => r.attention_count > 0);
      const personal = ["portfolio_director", "portfolio_manager"].includes(u.role);
      const inReview = rows.filter((o) => qualifying.has(o.id) && ["submitted", "in_review"].includes(o.status));
      const mineInReview = personal ? inReview.filter((o) => o.manager_id === u.id || o.director_id === u.id) : inReview;

      const types = { RFP: 0, RFI: 0, "Non-RFP": 0 } as Record<string, number>;
      monitor.forEach((r) => {
        const key = String(r.opportunity_type ?? "").trim().toUpperCase();
        types[key === "RFP" ? "RFP" : key === "RFI" ? "RFI" : "Non-RFP"] += 1;
      });

      const cards: Record<string, unknown>[] = [
        { key: "active", label: "Active Opportunities", value: monitor.length, filter: { active: "1" } },
        { key: "type_mix", label: "RFP | RFI | Non-RFP", value: monitor.length, filter: { active: "1" },
          segments: Object.entries(types).map(([label, value]) => ({ label, value })) },
      ];
      if (u.role === "portfolio_director") {
        cards.push(
          { key: "awaiting", label: "Awaiting My Review", value: mineInReview.length, tone: "coral",
            note: personal && inReview.length !== mineInReview.length ? `${inReview.length} in review overall` : null,
            filter: { status: ["submitted", "in_review"], ...(personal ? { assigned_to_me: "1" } : {}) } },
          { key: "ready_for_ai", label: "Ready for AI", value: rows.filter((o) => qualifying.has(o.id) && o.status === "ready_for_ai").length,
            filter: { status: ["ready_for_ai"] } },
        );
      }
      if (u.role !== "portfolio_director") {
        cards.push({ key: "ai", label: "AI Recommendations Available",
          value: rows.filter((o) => ["ai_recommendations", "completed"].includes(o.status)).length,
          filter: { status: ["ai_recommendations", "completed"] }, tone: "green" });
      }
      cards.push({ key: "attention", label: "Opportunities Needing Attention", value: attention.length,
        filter: { attention: "1" }, tone: "red" });

      const crit = activeAll.map(entryCriteria);
      const entry = { min_value: ENTRY_MIN_VALUE, active: activeAll.length, qualifying: monitor.length,
        value: crit.filter((c) => c.value).length, previous_projects: crit.filter((c) => c.previous_projects).length,
        strategic: crit.filter((c) => c.strategic).length };
      return { role: u.role, kind: "management", unread_notifications: unread, attention, monitor, cards, entry,
        portfolios: db.teams.map((t) => ({ id: t.id, name: t.name })) };
    }

    const activeOwn = rows.filter((o) => o.status !== "completed" && !o.is_archived);
    const ownTypes = { RFP: 0, RFI: 0, "Non-RFP": 0 } as Record<string, number>;
    activeOwn.forEach((o) => {
      const key = String(o.opportunity_type ?? "").trim().toUpperCase();
      ownTypes[key === "RFP" ? "RFP" : key === "RFI" ? "RFI" : "Non-RFP"] += 1;
    });
    const openComments = db.comments.filter((c) => c.status === "open"
      && rows.some((o) => o.id === c.opportunity_id)).length;
    return { role: u.role, kind: "account", unread_notifications: unread,
      cards: [
        { key: "mine", label: "My Active Opportunities", value: activeOwn.length, filter: { active: "1" } },
        { key: "type_mix", label: "RFP | RFI | Non-RFP", value: activeOwn.length, filter: { active: "1" },
          segments: Object.entries(ownTypes).map(([label, value]) => ({ label, value })) },
        { key: "not_submitted", label: "Not Yet Submitted", value: count(["draft"]), filter: { status: ["draft"] } },
        { key: "comments", label: "Review Comments to Address", value: openComments, filter: { open_comments: "1" } },
        { key: "ai", label: "AI Recommendations Available", value: count(["ai_recommendations", "completed"]),
          filter: { status: ["ai_recommendations", "completed"] }, tone: "green" },
      ],
      to_complete: list(["draft"], true),
      in_review: list(["submitted", "in_review", "ready_for_ai", "ai_analysis"]),
      ai_available: list(["ai_recommendations", "completed"]) };
  }],

  ["GET", /^\/notifications$/, () => {
    const u = requireUser();
    return db.notifications.filter((n) => n.user_id === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
  }],
  ["POST", /^\/notifications\/read-all$/, () => { const u = requireUser(); db.notifications.forEach((n) => { if (n.user_id === u.id) n.read_at ??= now(); }); persist(); return null; }],
  ["POST", /^\/notifications\/([^/]+)\/read$/, (m) => {
    const u = requireUser(); const n = db.notifications.find((x) => x.id === m[1] && x.user_id === u.id);
    if (!n) err(404, "Notification not found.");
    n!.read_at ??= now(); persist(); return null;
  }],

  ["GET", /^\/admin\/users$/, () => { requirePerm("user.manage");
    return db.users.map((u) => ({ id: u.id, username: u.username, full_name: u.full_name, email: u.email, role: u.role,
      role_label: ROLE_LABELS[u.role], team_id: u.team_id, team_name: team(u.team_id)?.name ?? null,
      vertical_name: (db.verticals ?? []).find((v) => v.id === u.vertical_id)?.name ?? null, is_active: u.is_active,
      must_change_password: u.must_change_password, last_login_at: u.last_login_at, locked: u.locked, created_at: u.created_at }));
  }],
  ["POST", /^\/admin\/users$/, (_m, body) => {
    requirePerm("user.manage");
    const p = String(body.temporary_password ?? "");
    if (p.length < 12 || !/[a-zA-Z]/.test(p) || !/\d/.test(p)) err(422, { message: "Temporary password does not meet the policy.", problems: ["Use at least 12 characters with letters and numbers."] });
    if (db.users.some((u) => u.username.toLowerCase() === String(body.username).toLowerCase())) err(409, { message: "That username is already taken." });
    if (body.team_id && body.role !== "presales_account") err(422, { message: "Only Account Presales users are members of a team. Directors lead teams instead." });
    const u: DUser = { id: uid(), username: String(body.username).trim(), full_name: String(body.full_name).trim(), email: body.email ?? null,
      role: body.role, team_id: body.team_id ?? null, is_active: true, must_change_password: true, locked: false,
      last_login_at: null, created_at: now(), password: p };
    db.users.push(u);
    audit("user.created", { entity_type: "user", entity_id: u.id, details: { username: u.username, role: u.role } });
    persist();
    return { ...u, team_name: team(u.team_id)?.name ?? null };
  }],
  ["PATCH", /^\/admin\/users\/([^/]+)$/, (m, body) => {
    const admin = requirePerm("user.manage");
    const u = db.users.find((x) => x.id === m[1]);
    if (!u) err(404, "User not found.");
    if (body.role && body.role !== u!.role && u!.id === admin.id) err(422, { message: "You cannot change your own role." });
    if (body.is_active === false && u!.id === admin.id) err(422, { message: "You cannot disable your own account." });
    if (body.full_name) u!.full_name = body.full_name;
    if (body.email !== undefined) u!.email = body.email;
    if (body.role) u!.role = body.role;
    if (body.clear_team || (body.role && body.role !== "presales_account")) u!.team_id = null;
    if (body.team_id) u!.team_id = body.team_id;
    if (body.is_active !== undefined) u!.is_active = body.is_active;
    if (body.unlock) u!.locked = false;
    audit("user.updated", { entity_type: "user", entity_id: u!.id, details: body });
    persist();
    return { ...u!, team_name: team(u!.team_id)?.name ?? null };
  }],
  ["POST", /^\/admin\/users\/([^/]+)\/reset-password$/, (m, body) => {
    requirePerm("user.manage");
    const u = db.users.find((x) => x.id === m[1]);
    if (!u) err(404, "User not found.");
    const p = String(body.temporary_password ?? "");
    if (p.length < 12 || !/[a-zA-Z]/.test(p) || !/\d/.test(p)) err(422, { message: "Temporary password does not meet the policy.", problems: ["Use at least 12 characters with letters and numbers."] });
    u!.password = p; u!.must_change_password = true; u!.locked = false;
    audit("user.password_reset", { entity_type: "user", entity_id: u!.id });
    persist();
    return null;
  }],
  ["GET", /^\/admin\/teams$/, () => {
    requireUser();
    return db.teams.map((t) => ({ id: t.id, name: t.name, is_active: t.is_active, director: ref(user(t.director_id)),
      manager: ref(user(t.manager_id)), sales_gm: ref(user(t.sales_gm_id ?? null)), member_count: db.users.filter((u) => u.team_id === t.id).length }));
  }],
  ["POST", /^\/admin\/teams$/, (_m, body) => {
    requirePerm("team.manage");
    if (body.director_id && db.teams.some((t) => t.director_id === body.director_id)) err(409, { message: "A team with that name exists, or that director already leads a team." });
    const t: DTeam = { id: uid(), name: String(body.name).trim(), director_id: body.director_id ?? null,
                       manager_id: body.manager_id ?? null, is_active: true };
    db.teams.push(t);
    audit("team.created", { entity_type: "team", entity_id: t.id, details: { name: t.name } });
    persist();
    return { ...t, director: ref(user(t.director_id)), manager: ref(user(t.manager_id)), sales_gm: ref(user((t as DTeam).sales_gm_id ?? null)), member_count: 0 };
  }],
  ["PATCH", /^\/admin\/teams\/([^/]+)$/, (m, body) => {
    requirePerm("team.manage");
    const t = db.teams.find((x) => x.id === m[1]);
    if (!t) err(404, "Team not found.");
    if (body.director_id && db.teams.some((x) => x.director_id === body.director_id && x.id !== t!.id)) err(409, { message: "That director already leads another team." });
    if (body.name) t!.name = body.name;
    if (body.clear_director) t!.director_id = null; else if (body.director_id) t!.director_id = body.director_id;
    if (body.clear_manager) t!.manager_id = null; else if (body.manager_id) t!.manager_id = body.manager_id;
    if (body.is_active !== undefined) t!.is_active = body.is_active;
    audit("team.updated", { entity_type: "team", entity_id: t!.id, details: body });
    persist();
    return { ...t!, director: ref(user(t!.director_id)), manager: ref(user(t!.manager_id)), sales_gm: ref(user((t as DTeam).sales_gm_id ?? null)),
             member_count: db.users.filter((u) => u.team_id === t!.id).length };
  }],
  ["GET", /^\/admin\/audit-logs$/, (_m, _b, q) => {
    requirePerm("audit.view");
    let rows = [...db.audit].sort((a, b) => b.id - a.id);
    const action = q.get("action"), actor = q.get("actor");
    if (action) rows = rows.filter((a) => a.action.startsWith(action));
    if (actor) rows = rows.filter((a) => (a.actor_username ?? "").includes(actor));
    const page = Number(q.get("page") ?? 1), size = Number(q.get("page_size") ?? 50);
    return { items: rows.slice((page - 1) * size, page * size), total: rows.length, page, page_size: size };
  }],
];

/** Replaces window.fetch for /api/* so the unchanged portal code runs against this in-browser store. */
export function installMockApi() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith("/api/")) return realFetch(input as RequestInfo, init);
    const u = new URL(url, location.origin);
    const path = u.pathname.replace(/^\/api/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
    const body = init?.body && !isForm ? JSON.parse(String(init.body)) : undefined;
    await new Promise((r) => setTimeout(r, 90));   // a touch of latency, like a real network
    const json = (status: number, payload: unknown) =>
      new Response(payload === null ? null : JSON.stringify(payload),
        { status, headers: { "content-type": "application/json" } });

    if (isForm && /^\/opportunities\/[^/]+\/documents$/.test(path)) {
      const form = init!.body as FormData;
      try {
        const u = requirePerm("document.upload");
        const o = getOpp(u, path.split("/")[2]);
        return json(201, await storeUpload(u, o, form.get("file") as File, String(form.get("category") ?? "other")));
      } catch (e) {
        if (e instanceof HttpError) return json(e.status, { detail: e.detail });
        throw e;
      }
    }

    const route = routes.find(([m, re]) => m === method && re.test(path));
    if (!route) return json(404, { detail: "Not found in the demo." });
    try {
      const result = route[2](path.match(route[1])!, body, u.searchParams);
      return result === null ? new Response(null, { status: 204 }) : json(method === "POST" && path === "/opportunities" ? 201 : 200, result);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { detail: e.detail });
      throw e;
    }
  };
}
