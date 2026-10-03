/* DeepDive workflow (Builder → Review & Governance → AI Analysis), AI Accepted Tracker and Readiness Checklist. */
import { useMemo, useState } from "react";
import { api } from "../api/client";
import type { OpportunityDetail } from "../api/types";
import { fmtDate, fmtDateTime } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { belongsTo, OutputCards, OUTPUTS } from "./AnalysisOutputs";
import { Icon } from "./Icon";
import { Empty, ErrorAlert, Modal, useToast } from "./ui";

export interface Workspace {
  steps: { key: string; title: string; status: string; detail: string }[];
  current_version: { id: string; version_number: number; is_locked: boolean } | null;
  reviewed_version: { id: string; version_number: number; reviewed_by: string | null;
                      snapshot: { group: string; label: string; version: string | null; files: number }[] } | null;
  snapshot: { group: string; label: string; version: string | null; files: number }[];
  analyses: { kind: string; title: string; blurb: string; status: string; reason: string; outputs: string[];
              missing: string[]; inputs?: { label: string; optional: boolean; available: boolean; version: string | null }[];
              ran_on?: { version: number; docs: string } | null }[];
  findings: { id: string; analysis: string; type: string; severity: string; title: string; description: string;
              evidence: string; recommendation: string; related_document: string | null;
              related_requirement: string | null; status: string }[];
  tracker: { id: string; analysis: string; type: string; title: string; original: string; accepted: string;
             owner: string; status: string; accepted_by: string; accepted_at: string; source_version: number;
             related_requirement: string | null; customer_response: string | null }[];
  can_review: boolean; can_run_ai: boolean; can_accept: boolean;
  session_confirmed: boolean; session_confirmed_by: string | null; can_confirm_session: boolean;
  session_version: number | null;
}

const STEP_TONE: Record<string, string> = {
  completed: "ok", in_progress: "amber", waiting: "amber", ready: "ok", locked: "muted",
};
const STEP_LABEL: Record<string, string> = {
  completed: "Completed", in_progress: "In progress", waiting: "Waiting for Review", ready: "Ready", locked: "Locked",
};
const ANALYSIS_TONE: Record<string, string> = {
  not_eligible: "muted", ready: "ok", analyzing: "amber", completed: "ok", reanalysis_required: "amber",
};
const ANALYSIS_LABEL: Record<string, string> = {
  not_eligible: "Not Eligible", ready: "Ready for AI", analyzing: "Analyzing",
  completed: "Completed", reanalysis_required: "Re-analysis Required",
};

/** The two DeepDive steps. Each card opens its own part. */
export function StepTrail({ steps, active, onSelect }:
  { steps: Workspace["steps"]; active: string; onSelect: (key: string) => void }) {
  return (
    <ol className="step-trail">
      {steps.map((s, i) => (
        <li key={s.key}>
          <button type="button" aria-current={active === s.key ? "step" : undefined}
            className={`trail-card trail-${STEP_TONE[s.status] ?? "muted"}${active === s.key ? " on" : ""}`}
            onClick={() => onSelect(s.key)}>
            <span className="n">{i + 1}</span>
            <span className="body">
              <b>{s.title}</b>
              <span className={`badge st-${s.status === "completed" ? "completed" : s.status === "locked" ? "draft" : "ready_for_ai"}`}>
                {STEP_LABEL[s.status] ?? s.status}
              </span>
              <span className="muted small">{s.detail}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function SnapshotTable({ rows, title }: { rows: Workspace["snapshot"]; title: string }) {
  return (
    <div className="snapshot">
      <h4>{title}</h4>
      <ul>
        {rows.map((r) => (
          <li key={r.group}>
            <span>{r.label}</span>
            <b className={r.version ? "" : "muted"}>{r.version ?? "Not available"}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AiAnalysisTab({ opp, workspace, onChanged }:
  { opp: OpportunityDetail; workspace: Workspace; onChanged: () => void }) {
  const confirmSession = async () => {
    try {
      await api.post(`/opportunities/${opp.id}/session-confirm`);
      toast("DeepDive session confirmed. AI Analysis is open.");
      onChanged();
    } catch (e) { setError(e); }
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<Workspace["findings"][number] | null>(null);
  const [draft, setDraft] = useState("");
  const toast = useToast();

  const run = async (kind: string) => {
    setBusy(kind); setError(null);
    try {
      await api.post(`/opportunities/${opp.id}/analyses/${kind}/run`);
      toast("Analysis completed. Review the outputs below.");
      setOutputKey(null);
      onChanged();
    } catch (e) { setError(e); } finally { setBusy(null); }
  };

  const act = async (id: string, action: "accept" | "dismiss", content?: string) => {
    try {
      await api.post(`/opportunities/${opp.id}/findings/${id}/${action}`, content ? { content } : {});
      toast(action === "accept" ? "Accepted — added to the AI Accepted Tracker." : "Dismissed.");
      setEditing(null);
      onChanged();
    } catch (e) { setError(e); }
  };

  const [outputKey, setOutputKey] = useState<string | null>(null);
  const open = workspace.findings.filter((f) => f.status === "open");
  const analysisTitle = (kind: string) => workspace.analyses.find((a) => a.kind === kind)?.title ?? kind;
  // Findings grouped under the output card they belong to, in card order; anything unmapped goes last.
  const groups = [
    ...OUTPUTS.map((o, i) => ({ key: o.key, num: String(i + 1), title: o.title, icon: o.icon, tone: o.tone,
                                items: open.filter((f) => belongsTo(o, f)) })),
    { key: "other", num: "•", title: "Other findings — Director comments", icon: "review", tone: "grey",
      items: open.filter((f) => !OUTPUTS.some((o) => belongsTo(o, f))) },
  ].filter((g) => g.items.length > 0);
  const showDetails = (key: string) => {
    setOutputKey(key);
    requestAnimationFrame(() => document.getElementById(`ai-group-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  if (!workspace.session_confirmed) {
    return (
      <>
        <ErrorAlert error={error} />
        <section className="card card-pad session-gate">
          <h2 className="section">
            Locked until the DeepDive session{workspace.session_version ? ` for v${workspace.session_version}` : ""} is done
          </h2>
          <p className="muted">
            The team walks through the DeepDive together before any analysis runs. The Presales Director or the
            Presales Manager confirms that the session took place — every submitted version needs its own session.
          </p>
          {workspace.can_confirm_session
            ? <button className="btn primary" onClick={() => void confirmSession()}>
                Confirm the DeepDive session{workspace.session_version ? ` for v${workspace.session_version}` : ""}
              </button>
            : <p className="muted small">Waiting for the Presales Director or Presales Manager to confirm.</p>}
        </section>
      </>
    );
  }

  return (
    <>
      <ErrorAlert error={error} />
      {workspace.session_confirmed_by && (
        <p className="muted small" style={{ margin: "0 0 10px" }}>
          DeepDive session for v{workspace.session_version} confirmed by {workspace.session_confirmed_by}.
        </p>
      )}
      {workspace.reviewed_version && (
        <section className="card card-pad" style={{ marginBottom: 14 }}>
          <div className="eligibility-head">
            <div>
              <h2 className="section" style={{ margin: 0 }}>Eligibility from the reviewed version</h2>
              <span className="muted small">
                DeepDive v{workspace.reviewed_version.version_number}
                {workspace.reviewed_version.reviewed_by ? ` · reviewed by ${workspace.reviewed_version.reviewed_by}` : ""}
              </span>
            </div>
            <SnapshotTable rows={workspace.reviewed_version.snapshot} title="Documents in this version" />
          </div>
        </section>
      )}

      <div className="analysis-grid">
        {workspace.analyses.map((a) => (
          <article key={a.kind} className={`analysis tone-${ANALYSIS_TONE[a.status]}`}>
            <header>
              <b>{a.title}</b>
              <span className={`badge st-${a.status === "completed" ? "completed" : a.status === "ready" ? "ready_for_ai" : "draft"}`}>
                {ANALYSIS_LABEL[a.status]}
              </span>
            </header>
            <p className="muted small">{a.blurb}</p>
            {a.inputs && (
              <ul className="inputs" aria-label="Required documents">
                {a.inputs.map((i) => (
                  <li key={i.label} className={i.available ? "ok" : i.optional ? "opt" : "miss"}>
                    <span aria-hidden="true">{i.available ? "✓" : i.optional ? "○" : "✕"}</span>
                    {i.label}{i.optional && <em> (optional)</em>}
                    {i.version && <span className="ver">{i.version}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="reason">{a.reason}</p>
            <ul className="outputs">{a.outputs.slice(0, 4).map((o) => <li key={o}>{o}</li>)}</ul>
            {workspace.can_run_ai && (a.status === "ready" || a.status === "reanalysis_required") && (
              <button className="btn primary small" disabled={busy === a.kind} onClick={() => void run(a.kind)}>
                {busy === a.kind ? "Analyzing…" : a.status === "ready" ? "Run analysis" : "Analyze changes"}
              </button>
            )}
            {a.ran_on && <div className="muted small">Ran on DeepDive v{a.ran_on.version} {a.ran_on.docs}</div>}
          </article>
        ))}
      </div>

      <h2 className="section out-heading">AI Outputs</h2>
      <OutputCards analyses={workspace.analyses} findings={workspace.findings} selected={outputKey} onSelect={showDetails} />

      <section className="card panel" id="ai-findings" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2 className="section">Findings by output ({open.length})</h2>
          <span className="muted small">Every finding carries its evidence. Nothing reaches the DeepDive without acceptance.</span>
        </div>
        {groups.length === 0 ? <Empty title="No open findings" /> : (
          <div className="card-pad finding-groups">
            {groups.map((g) => (
              <section key={g.key} id={`ai-group-${g.key}`}
                className={`finding-group${outputKey === g.key ? " selected" : ""}`}>
                <header className="finding-group-head">
                  <span className="out-num">{g.num}</span>
                  <span className={`out-icon tone-${g.tone}`}><Icon name={g.icon} /></span>
                  <h3>{g.title}</h3>
                  <span className="muted small">{g.items.length} {g.items.length === 1 ? "finding" : "findings"}</span>
                </header>
                <div className="finding-list">
                  {g.items.map((f) => (
                    <article key={f.id} className="finding">
                      <header>
                        <span className="chip source">{analysisTitle(f.analysis)}</span>
                        <span className="chip">{f.type}</span>
                        <span className={`chip sev-${f.severity}`}>{f.severity}</span>
                        <b>{f.title}</b>
                      </header>
                      <p>{f.description}</p>
                      <dl className="finding-meta">
                        <dt>Evidence</dt><dd>{f.evidence}</dd>
                        <dt>Recommendation</dt><dd>{f.recommendation}</dd>
                        {f.related_document && <><dt>Document</dt><dd>{f.related_document}</dd></>}
                        {f.related_requirement && <><dt>Requirement</dt><dd>{f.related_requirement}</dd></>}
                      </dl>
                      {workspace.can_accept && (
                        <div className="row-actions">
                          <button className="btn primary small" onClick={() => void act(f.id, "accept")}>Accept</button>
                          <button className="btn ghost small" onClick={() => { setEditing(f); setDraft(f.recommendation); }}>Modify &amp; Accept</button>
                          <button className="btn ghost small" onClick={() => void act(f.id, "dismiss")}>Dismiss</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      {editing && (
        <Modal title="Modify & Accept" onClose={() => setEditing(null)} footer={<>
          <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn primary" disabled={draft.trim().length < 5} onClick={() => void act(editing.id, "accept", draft)}>
            Accept with changes
          </button>
        </>}>
          <p className="muted small">{editing.title}</p>
          <textarea rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Accepted content" />
        </Modal>
      )}
    </>
  );
}

export function TrackerTab({ opp, workspace, onChanged }:
  { opp: OpportunityDetail; workspace: Workspace; onChanged: () => void }) {
  const [answering, setAnswering] = useState<Workspace["tracker"][number] | null>(null);
  const [text, setText] = useState("");
  const toast = useToast();

  const save = async () => {
    if (!answering) return;
    await api.post(`/opportunities/${opp.id}/tracker/${answering.id}/response`, { response: text });
    toast("Customer response recorded.");
    setAnswering(null);
    onChanged();
  };

  if (!workspace.tracker.length) {
    return <Empty title="Nothing accepted yet">Accepted AI recommendations appear here with their source and owner.</Empty>;
  }
  return (
    <section className="card panel">
      <div className="panel-head">
        <h2 className="section">AI Accepted Tracker ({workspace.tracker.length})</h2>
        <span className="muted small">Accepted items feed the next DeepDive version; submitted versions never change.</span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Item</th><th>Type</th><th>Source</th><th>Accepted content</th><th>Owner</th><th>Status</th>
              <th>Accepted by</th><th>From</th><th><span className="vh">Actions</span></th></tr>
          </thead>
          <tbody>
            {workspace.tracker.map((t) => (
              <tr key={t.id}>
                <td><b>{t.title}</b>{t.related_requirement && <div className="muted small">{t.related_requirement}</div>}</td>
                <td>{t.type}</td>
                <td className="small">{t.analysis}</td>
                <td className="small">{t.accepted}
                  {t.customer_response && <div className="muted small">Customer: {t.customer_response}</div>}</td>
                <td className="small">{t.owner || "—"}</td>
                <td><span className={`badge st-${t.status === "answered" ? "completed" : t.status === "waiting_customer" ? "ready_for_ai" : "submitted"}`}>
                  {t.status === "waiting_customer" ? "Waiting for Customer" : t.status === "answered" ? "Answered" : "Tracked"}
                </span></td>
                <td className="small">{t.accepted_by}<div className="muted small">{fmtDate(t.accepted_at)}</div></td>
                <td className="small">v{t.source_version}</td>
                <td>{t.status === "waiting_customer" && (
                  <button className="btn ghost small" onClick={() => { setAnswering(t); setText(""); }}>Add response</button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {answering && (
        <Modal title="Customer response" onClose={() => setAnswering(null)} footer={<>
          <button className="btn ghost" onClick={() => setAnswering(null)}>Cancel</button>
          <button className="btn primary" disabled={text.trim().length < 2} onClick={() => void save()}>Save response</button>
        </>}>
          <p className="muted small">{answering.title}</p>
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-label="Customer response" />
        </Modal>
      )}
    </section>
  );
}

const READY_TONE: Record<string, string> = {
  ready: "completed", attention: "changes_requested", in_progress: "submitted", waiting: "ready_for_ai", open: "changes_requested",
};
const READY_LABEL: Record<string, string> = {
  ready: "Ready", attention: "Attention", in_progress: "In progress", waiting: "Waiting", open: "Open",
};

export function ReadinessTab({ opp }: { opp: OpportunityDetail }) {
  const readiness = useAsync(() => api.get<{ based_on: number | null; summary: Record<string, number | string>;
    rows: Record<string, string>[] }>(`/opportunities/${opp.id}/readiness`), [opp.id, opp.current_version]);
  const [filter, setFilter] = useState("All");
  const rows = useMemo(() => (readiness.data?.rows ?? []).filter((r) =>
    filter === "All" || (filter === "Open" ? r.status !== "ready" : filter === "Critical" ? r.status === "open" : r.category === filter)),
    [readiness.data, filter]);

  const s = readiness.data?.summary;
  return (
    <>
      <ErrorAlert error={readiness.error} />
      <div className="panel-head bare">
        <h2 className="section">Readiness Checklist</h2>
        <span className="muted small">
          {readiness.data?.based_on ? `Based on the latest reviewed version: DeepDive v${readiness.data.based_on}`
            : "No reviewed version yet"}
        </span>
      </div>
      {s && (
        <div className="stat-grid" style={{ marginBottom: 14 }}>
          <div className="stat"><div className="kpi"><div><div className="v">{s.score}%</div><div className="l">Overall readiness</div></div></div></div>
          <div className="stat"><div className="kpi"><div><div className="l">Technical</div><b>{READY_LABEL[String(s.technical)]}</b></div></div></div>
          <div className="stat"><div className="kpi"><div><div className="l">Commercial</div><b>{READY_LABEL[String(s.commercial)]}</b></div></div></div>
          <div className="stat"><div className="kpi"><div><div className="v">{s.clarifications}</div><div className="l">Customer clarifications</div></div></div></div>
          <div className="stat tone-red"><div className="kpi"><div><div className="v">{s.critical}</div><div className="l">Critical items</div></div></div></div>
        </div>
      )}
      <section className="card panel">
        <div className="panel-head">
          <h2 className="section">Checklist ({rows.length})</h2>
          <div className="panel-tools">
            {["All", "Open", "Critical", "Technical", "Commercial", "Customer", "Risk"].map((f) => (
              <button key={f} type="button" className={`btn ghost small${filter === f ? " on" : ""}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? <Empty title="Nothing in this filter" /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Category</th><th>Checklist item</th><th>Status</th><th>Evidence</th><th>Owner</th><th>Source</th><th>Updated</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.category}</td>
                    <td><b>{r.item}</b></td>
                    <td><span className={`badge st-${READY_TONE[r.status] ?? "draft"}`}>{READY_LABEL[r.status] ?? r.status}</span></td>
                    <td className="small">{r.evidence}</td>
                    <td className="small">{r.owner}</td>
                    <td className="small">{r.source}</td>
                    <td className="muted small">{fmtDateTime(r.updated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

interface GovernanceItem {
  id: string; kind: "risk" | "support"; title: string; detail: string; impact: string; owner: string;
  created_by: string; created_by_role: string; created_at: string; applied_to_version: number | null;
}

/** Review & Governance: management and sales raise a Risk or a Support Needed item.
    Each one lands in the DeepDive version the Presales Lead is working on. */
export function GovernanceTab({ opp }: { opp: OpportunityDetail }) {
  const list = useAsync(() => api.get<{ can_add: boolean; items: GovernanceItem[] }>(
    `/opportunities/${opp.id}/governance`), [opp.id, opp.current_version]);
  const [kind, setKind] = useState<"risk" | "support">("risk");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [impact, setImpact] = useState("High");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();

  const add = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(`/opportunities/${opp.id}/governance`, { kind, title, detail, impact, owner });
      toast(kind === "risk" ? "Risk recorded — it will appear in the DeepDive." : "Support need recorded — it will appear in the DeepDive.");
      setTitle(""); setDetail(""); setOwner("");
      await list.reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const items = list.data?.items ?? [];
  return (
    <>
      <ErrorAlert error={error ?? list.error} />
      {list.data?.can_add && (
        <section className="card panel">
          <div className="panel-head">
            <h2 className="section">Raise an item</h2>
            <span className="muted small">
              Risks and support needs go straight into the DeepDive version the Presales Lead is working on.
            </span>
          </div>
          <div className="card-pad form-grid" style={{ paddingTop: 0 }}>
            <div className="field">
              <label htmlFor="g-kind">Type</label>
              <select id="g-kind" value={kind} onChange={(e) => setKind(e.target.value as "risk" | "support")}>
                <option value="risk">Risk</option>
                <option value="support">Support Needed</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="g-impact">{kind === "risk" ? "Impact" : "Priority"}</label>
              <select id="g-impact" value={impact} onChange={(e) => setImpact(e.target.value)}>
                {["High", "Medium", "Low"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="field span">
              <label htmlFor="g-title">{kind === "risk" ? "Risk" : "Support needed"}</label>
              <input id="g-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === "risk" ? "What could go wrong" : "What is needed, and from whom"} />
            </div>
            <div className="field span">
              <label htmlFor="g-detail">{kind === "risk" ? "Mitigation" : "Details"}</label>
              <textarea id="g-detail" rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="g-owner">{kind === "risk" ? "Owner" : "Required from"}</label>
              <input id="g-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Name or team" />
            </div>
            <div className="row-actions span">
              <button className="btn primary" disabled={busy || title.trim().length < 4} onClick={() => void add()}>
                {busy ? "Adding…" : kind === "risk" ? "Add risk" : "Add support need"}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="card panel">
        <div className="panel-head">
          <h2 className="section">Governance history ({items.length})</h2>
          <span className="muted small">Newest first, with who raised it and the version that received it.</span>
        </div>
        {items.length === 0 ? <Empty title="Nothing raised yet" /> : (
          <ul className="timeline card-pad">
            {items.map((g) => (
              <li key={g.id}>
                <div className="t-head">
                  <span className={`chip ${g.kind === "risk" ? "sev-high" : ""}`}>{g.kind === "risk" ? "Risk" : "Support Needed"}</span>
                  <span className="chip">{g.impact}</span>
                  <b>{g.title}</b>
                </div>
                {g.detail && <p className="small" style={{ margin: "4px 0" }}>{g.detail}</p>}
                <div className="t-meta">
                  {g.created_by} ({g.created_by_role}) · {fmtDateTime(g.created_at)}
                  {g.owner ? ` · ${g.kind === "risk" ? "Owner" : "From"}: ${g.owner}` : ""}
                  {g.applied_to_version
                    ? ` · added to DeepDive v${g.applied_to_version}`
                    : " · will be added to the next DeepDive version"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
