/* DeepDive workflow (Builder → Review & Governance → AI Analysis), AI Accepted Tracker and Readiness Checklist. */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { OpportunityDetail, VersionDetail } from "../api/types";
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
const INPUT_LABEL: Record<string, string> = {
  customer: "Customer Documents", tp: "TP", cp: "CP", ta: "TA", quotation: "Quotation", other: "Supporting documents",
};
/** "customer:v1 tp:v2" → "DeepDive v1 · Customer Documents v1 · TP v2" (missing optional inputs left out). */
const describeInputs = (version: number, docs: string) => [`DeepDive v${version}`,
  ...docs.split(" ").filter(Boolean).map((p) => p.split(":")).filter(([, v]) => v && v !== "-")
    .map(([k, v]) => `${INPUT_LABEL[k] ?? k} ${v}`)].join(" · ");

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

  const act = async (id: string, action: "accept" | "dismiss" | "restore", content?: string) => {
    try {
      await api.post(`/opportunities/${opp.id}/findings/${id}/${action}`, content ? { content } : {});
      toast(action === "accept" ? "Accepted — added to the AI Accepted Tracker."
        : action === "restore" ? "Restored to the open findings." : "Dismissed.");
      setEditing(null);
      onChanged();
    } catch (e) { setError(e); }
  };

  // An output's findings open as their own page (?step=ai&output=<key>), so the browser Back button returns.
  const [search, setSearch] = useSearchParams();
  const outputKey = search.get("output");
  const setOutputKey = (key: string | null) => {
    const next = new URLSearchParams(search);
    if (key) next.set("output", key); else next.delete("output");
    setSearch(next);
    window.scrollTo({ top: 0 });
  };
  const open = workspace.findings.filter((f) => f.status === "open");
  const analysisTitle = (kind: string) => workspace.analyses.find((a) => a.kind === kind)?.title ?? kind;
  // Findings grouped under the output card they belong to, in card order; anything unmapped goes last.
  const groups = [
    ...OUTPUTS.map((o, i) => ({ key: o.key, num: String(i + 1), title: o.title, icon: o.icon, tone: o.tone,
                                items: open.filter((f) => belongsTo(o, f)) })),
    { key: "other", num: "•", title: "Other findings — Director comments", icon: "review", tone: "grey",
      items: open.filter((f) => !OUTPUTS.some((o) => belongsTo(o, f))) },
  ];
  const details = groups.find((g) => g.key === outputKey) ?? null;

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

  if (details) {
    const spec = OUTPUTS.find((o) => o.key === details.key);
    return (
      <div className="output-page">
        <ErrorAlert error={error} />
        <button type="button" className="out-back" onClick={() => setOutputKey(null)}>
          <Icon name="back" /> AI Analysis · AI Outputs
        </button>
        <header className="output-page-head">
          <span className="out-num">{details.num}</span>
          <span className={`out-icon tone-${details.tone}`}><Icon name={details.icon} /></span>
          <div>
            <h2>{details.title}</h2>
            {spec && <p className="out-desc">{spec.description}</p>}
          </div>
          <span className="muted small">{details.items.length} open {details.items.length === 1 ? "finding" : "findings"}</span>
        </header>
        <p className="muted small">Every finding carries its evidence. Nothing reaches the DeepDive without acceptance.</p>
        {details.items.length === 0 ? <Empty title="No open findings" /> : (
          <div className="finding-list">
            {details.items.map((f) => (
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
        )}
        {(() => {
          const spec2 = OUTPUTS.find((o) => o.key === details.key);
          const mine = (st: string) => workspace.findings.filter((f) => f.status === st
            && (spec2 ? belongsTo(spec2, f) : !OUTPUTS.some((o) => belongsTo(o, f))));
          const accepted = mine("accepted"); const dismissed = mine("dismissed");
          return <>
            {accepted.length > 0 && (
              <details className="closed-findings">
                <summary>Accepted ({accepted.length}) — tracked in the AI Accepted Tracker</summary>
                <ul>{accepted.map((f) => (
                  <li key={f.id}><span className="chip source">{analysisTitle(f.analysis)}</span> {f.title}</li>
                ))}</ul>
              </details>
            )}
            {dismissed.length > 0 && (
              <details className="closed-findings">
                <summary>Dismissed ({dismissed.length})</summary>
                <ul>{dismissed.map((f) => (
                  <li key={f.id}>
                    <span className="chip source">{analysisTitle(f.analysis)}</span> {f.title}
                    {workspace.can_accept && (
                      <button className="btn ghost small" onClick={() => void act(f.id, "restore")}>Restore</button>
                    )}
                  </li>
                ))}</ul>
              </details>
            )}
          </>;
        })()}
        <nav className="output-page-nav" aria-label="Other outputs">
          {groups.filter((g) => g.key !== details.key && g.items.length > 0).map((g) => (
            <button key={g.key} type="button" className="chip" onClick={() => setOutputKey(g.key)}>
              {g.num}. {g.title} ({g.items.length})
            </button>
          ))}
        </nav>
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
      </div>
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
            <ul className="outputs">{a.outputs.map((o) => <li key={o}>{o}</li>)}</ul>
            {workspace.can_run_ai && (a.status === "ready" || a.status === "reanalysis_required") && (
              <button className="btn primary small" disabled={busy === a.kind} onClick={() => void run(a.kind)}>
                {busy === a.kind ? "Analyzing…" : a.status === "ready" ? "Run analysis" : "Analyze changes"}
              </button>
            )}
            {a.ran_on && <div className="muted small">Ran on {describeInputs(a.ran_on.version, a.ran_on.docs)}</div>}
          </article>
        ))}
      </div>

      <h2 className="section out-heading">AI Outputs</h2>
      <OutputCards analyses={workspace.analyses} findings={workspace.findings} selected={outputKey} onSelect={setOutputKey} />
      {groups[groups.length - 1].items.length > 0 && (
        <button type="button" className="out-other" onClick={() => setOutputKey("other")}>
          Other findings — Director comments ({groups[groups.length - 1].items.length}) · View Details ›
        </button>
      )}

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
                <td className="small">{workspace.analyses.find((a) => a.kind === t.analysis)?.title ?? t.analysis}</td>
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

/* Readiness Checklist: the same checklist the Presales Lead fills in the DeepDive Builder ("Readiness checklist"
   step), shown for the selected version: groups of components with their quote and TP status. */
interface ChecklistRow {
  item?: string; provider?: string; communicated?: string; quoteRec?: string; tpRec?: string;
  quoteVal?: string; tpVal?: string; comments?: string;
}
const CHECK_COLS: [keyof ChecklistRow, string][] = [
  ["communicated", "Communicated"], ["quoteRec", "Quote received"], ["tpRec", "TP received"],
  ["quoteVal", "Quote validated"], ["tpVal", "TP validated"],
];
const isYes = (v?: string) => String(v ?? "").trim().toLowerCase() === "yes";
/** A component is ready once both its quote and its TP are validated. */
const rowReady = (r: ChecklistRow) => isYes(r.quoteVal) && isYes(r.tpVal);

export function ReadinessTab({ opp, versionId }: { opp: OpportunityDetail; versionId?: string | null }) {
  const vid = versionId ?? opp.current_version_id;
  const version = useAsync(() => vid
    ? api.get<VersionDetail>(`/opportunities/${opp.id}/versions/${vid}`) : Promise.resolve(null),
    [opp.id, vid, opp.updated_at]);
  const [filter, setFilter] = useState("All");
  const groups = ((version.data?.data?.groups ?? []) as { name?: string; rows?: ChecklistRow[] }[])
    .map((g) => ({ name: g.name?.trim() || "Untitled group", rows: (g.rows ?? []).filter((r) => (r.item ?? "").trim() || (r.provider ?? "").trim()) }))
    .filter((g) => g.rows.length > 0);
  const all = groups.flatMap((g) => g.rows);
  const count = (k: keyof ChecklistRow) => all.filter((r) => isYes(r[k] as string)).length;
  const ready = all.filter(rowReady).length;
  const pct = all.length ? Math.round((ready / all.length) * 100) : 0;
  const keep = (r: ChecklistRow) => filter === "All" || (filter === "Open" ? !rowReady(r) : rowReady(r));

  return (
    <>
      <ErrorAlert error={version.error} />
      <div className="panel-head bare">
        <h2 className="section">Readiness Checklist</h2>
        <span className="muted small">
          {version.data ? `From the DeepDive v${version.data.version_number} · Readiness checklist step` : "Loading…"}
        </span>
        <Link to={`/opportunities/${opp.id}/deepdive`} className="small" style={{ marginLeft: "auto" }}>
          {version.data && !version.data.is_locked ? "Edit in DeepDive Builder ›" : "Open DeepDive Builder ›"}
        </Link>
      </div>
      {all.length > 0 && (
        <div className="stat-grid" style={{ marginBottom: 14 }}>
          <div className="stat"><span className="v">{pct}%</span><span className="l">Ready ({ready} of {all.length} components)</span></div>
          <div className="stat"><span className="v">{count("communicated")}/{all.length}</span><span className="l">Communicated</span></div>
          <div className="stat"><span className="v">{count("quoteRec")}/{all.length}</span><span className="l">Quotes received</span></div>
          <div className="stat"><span className="v">{count("tpRec")}/{all.length}</span><span className="l">TPs received</span></div>
          <div className="stat tone-green"><span className="v">{count("quoteVal")}/{all.length}</span><span className="l">Quotes validated</span></div>
          <div className="stat tone-green"><span className="v">{count("tpVal")}/{all.length}</span><span className="l">TPs validated</span></div>
        </div>
      )}
      {version.loading ? <p className="muted">Loading…</p> : groups.length === 0 ? (
        <section className="card card-pad">
          <Empty title="No readiness checklist yet">
            <p className="muted small">The Presales Lead fills it in the DeepDive Builder, step 6 “Readiness checklist”.</p>
          </Empty>
        </section>
      ) : (
        <>
          <div className="panel-tools" style={{ margin: "0 0 10px" }}>
            {["All", "Open", "Ready"].map((f) => (
              <button key={f} type="button" className={`btn ghost small${filter === f ? " on" : ""}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          {groups.map((g) => {
            const rows = g.rows.filter(keep);
            const gReady = g.rows.filter(rowReady).length;
            return (
              <section key={g.name} className="card panel checklist-group">
                <div className="panel-head">
                  <h2 className="section">{g.name}</h2>
                  <span className="muted small">{gReady} of {g.rows.length} ready</span>
                  <span className="group-bar" aria-hidden="true"><span style={{ width: `${(gReady / g.rows.length) * 100}%` }} /></span>
                </div>
                {rows.length === 0 ? <Empty title="Nothing in this filter" /> : (
                  <div className="table-wrap">
                    <table className="data checklist">
                      <thead><tr>
                        <th>#</th><th>Component</th><th>Provided by</th>
                        {CHECK_COLS.map(([, label]) => <th key={label}>{label}</th>)}
                        <th>Comments</th>
                      </tr></thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i}>
                            <td className="muted">{g.rows.indexOf(r) + 1}</td>
                            <td><b>{r.item || "—"}</b></td>
                            <td>{r.provider || "—"}</td>
                            {CHECK_COLS.map(([k]) => {
                              const v = String(r[k] ?? "").trim();
                              return <td key={k}>{v ? <span className={`yn ${isYes(v) ? "yes" : "no"}`}>{v}</span> : <span className="muted">—</span>}</td>;
                            })}
                            <td className="small">{r.comments || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
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
