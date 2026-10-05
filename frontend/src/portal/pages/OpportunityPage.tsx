import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { HistoryItem, OpportunityDetail, VersionDetail, VersionSummary, WorkflowAction } from "../api/types";
import { AiSummary } from "../components/AnalysisOutputs";
import { SharedFolder } from "../components/SharedFolder";
import { AiAnalysisTab, GovernanceTab, ReadinessTab, StepTrail, TrackerTab, type Workspace } from "../components/WorkspaceTabs";
import { BuilderHost, type BuilderHandle } from "../components/BuilderHost";
import { Icon } from "../components/Icon";
import { Empty, ErrorAlert, Modal, StatusBadge, useToast } from "../components/ui";
import { fmtDate, fmtDateTime, timeAgo } from "../lib/format";

type Dialog =
  | { kind: "action"; action: WorkflowAction }
  | { kind: "delete" }
  | { kind: "new-version" }
  | { kind: "incomplete"; missing: string[]; count: number }
  | null;

export function OpportunityPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [search, setSearch] = useSearchParams();
  const [opp, setOpp] = useState<OpportunityDetail | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<unknown>(null);
  const [text, setText] = useState("");
  const builder = useRef<BuilderHandle>(null);

  const load = useCallback(async () => {
    try {
      const [o, v, h] = await Promise.all([
        api.get<OpportunityDetail>(`/opportunities/${id}`),
        api.get<VersionSummary[]>(`/opportunities/${id}/versions`),
        api.get<HistoryItem[]>(`/opportunities/${id}/history`),
      ]);
      setOpp(o); setVersions(v); setHistory(h); setError(null);
    } catch (e) { setError(e); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const selectedVersionId = search.get("v") ?? opp?.current_version_id ?? "";
  const selectedVersion = versions.find((v) => v.id === selectedVersionId);
  // Every versioned tab carries the selection, so switching tabs never changes the version.
  const versionQuery = search.get("v") ? `?v=${search.get("v")}` : "";
  const step = (search.get("step") ?? "builder") as "builder" | "ai";
  const location = useLocation();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const loadWorkspace = useCallback(async () => {
    if (!id) return;
    try { setWorkspace(await api.get<Workspace>(`/opportunities/${id}/workspace`)); } catch { setWorkspace(null); }
  }, [id]);
  // the workspace is re-read whenever the opportunity or the open step changes
  useEffect(() => { void loadWorkspace(); },
    [loadWorkspace, opp?.status, opp?.current_version, step, location.pathname]);

  const closeDialog = () => { setDialog(null); setDialogError(null); setText(""); };

  const runAction = async (action: WorkflowAction, comment?: string) => {
    if (!opp) return;
    setBusy(true); setDialogError(null);
    try {
      if (action.action === "submit") {
        const saved = (await builder.current?.flush()) ?? true;
        if (!saved) throw new Error("Your latest changes couldn’t be saved, so the DeepDive was not submitted.");
        const builderErrors = builder.current?.errorCount();
        if (builderErrors) {
          setDialog({ kind: "incomplete", missing: [], count: builderErrors });
          builder.current?.gotoReview();
          return;
        }
      }
      await api.post<OpportunityDetail>(`/opportunities/${opp.id}/transitions`, { action: action.action, comment, expected_version_id: opp.current_version_id });
      closeDialog();
      toast(`${action.label}: done.`);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "incomplete") {
        const d = e.detail as { missing: string[]; count: number };
        setDialog({ kind: "incomplete", missing: d.missing, count: d.count });
      } else if (dialog) setDialogError(e);
      else toast(e instanceof Error ? e.message : "Something went wrong.", "error");
    } finally { setBusy(false); }
  };

  const wasSubmitted = versions.some((v) => v.submitted_at);

  const remove = async () => {
    if (!opp) return;
    setBusy(true); setDialogError(null);
    try {
      const result = await api.del<{ outcome: string }>(`/opportunities/${opp.id}`);
      toast(result?.outcome === "archived"
        ? `${opp.opportunity_number} archived. An Admin can restore or purge it.`
        : `${opp.opportunity_number} deleted.`);
      navigate("/opportunities", { replace: true });
    } catch (e) { setDialogError(e); } finally { setBusy(false); }
  };

  const restore = async () => {
    if (!opp) return;
    try { await api.post(`/opportunities/${opp.id}/restore`); toast("Restored."); await load(); }
    catch (e) { toast(e instanceof Error ? e.message : "Could not restore.", "error"); }
  };

  const createVersion = async () => {
    if (!opp) return;
    setBusy(true); setDialogError(null);
    try {
      await builder.current?.flush();
      const v = await api.post<VersionSummary>(`/opportunities/${opp.id}/versions`, { change_notes: text });
      closeDialog();
      toast(`Version ${v.version_number} created with a copy of the DeepDive and documents. You can edit it now.`);
      setSearch({}, { replace: true });   // the new version becomes the current one
      await load();
      navigate(`/opportunities/${opp.id}/deepdive`);
    } catch (e) { setDialogError(e); } finally { setBusy(false); }
  };

  if (error) return <main className="content"><ErrorAlert error={error} /><Link to="/opportunities">Back to opportunities</Link></main>;
  if (!opp) return <main className="content"><p className="muted">Loading opportunity…</p></main>;

  const enabledActions = opp.actions.filter((a) => a.enabled);
  const futureActions = opp.actions.filter((a) => !a.enabled);
  const current = versions.find((v) => v.is_current);
  const needsNewVersion = opp.can_create_version && current?.is_locked;
  const lockedForEditing = !!current?.is_locked && !opp.is_archived;

  return (
    <main className="content" style={{ maxWidth: "none" }}>
      {opp.is_archived && (
        <div className="alert info" style={{ marginBottom: 14 }}>
          <b>This opportunity is archived.</b> It does not appear in the lists or on any dashboard. Restore it to continue working on it.
        </div>
      )}
      <div className="opp-head">
        <div style={{ flex: 1, minWidth: 280 }}>
          <Link to="/opportunities" className="small" style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
            <span style={{ width: 14, display: "inline-flex" }}><Icon name="back" /></span> Opportunities
          </Link>
          <div className="num-chip" style={{ marginTop: 8 }}>{opp.opportunity_number}</div>
          <h1>{opp.title}</h1>
          <div className="meta-row">
            <StatusBadge status={opp.status} label={opp.status_label} />
            <span>Account <b>{opp.account_name}</b></span>
            <span>Owner <b>{opp.owner.full_name}</b></span>
            <span>Manager <b>{opp.manager?.full_name ?? "—"}</b></span>
            <span>Director <b>{opp.director?.full_name ?? "—"}</b></span>
            <span>Version <b>v{opp.current_version}</b></span>
            <span className={`ai-chip ${opp.ai_status}`}>{opp.ai_status_label}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {opp.is_archived && opp.can_delete && (
            <button className="btn ghost" onClick={() => void restore()}>Restore</button>
          )}
          {opp.can_delete && !opp.is_archived && (
            <button className="btn danger" onClick={() => setDialog({ kind: "delete" })}>
              {wasSubmitted ? "Archive" : "Delete"}
            </button>
          )}
          {opp.can_create_version && (
            <button className={`btn ${needsNewVersion ? "primary" : "ghost"}`} onClick={() => setDialog({ kind: "new-version" })}>
              <Icon name="layers" /> Create new version
            </button>
          )}
          {enabledActions.map((a) => (
            <button key={a.action} className="btn coral" disabled={busy}
              onClick={() => (a.requires_comment || a.action !== "submit" ? setDialog({ kind: "action", action: a }) : void runAction(a))}>
              {a.label}
            </button>
          ))}
          {futureActions.map((a) => (
            <button key={a.action} className="btn ghost" disabled title="Not available in this state">{a.label}</button>
          ))}
        </div>
      </div>

      {lockedForEditing && opp.can_create_version && (
        <div className="alert info" style={{ marginBottom: 16 }}>
          <b>v{current?.version_number} is a recorded version and stays as it is.</b> New versions come from the shared
          folder (a new DeepDive PowerPoint or Readiness checklist from the Presales Lead) or from an item added under
          Review &amp; Governance, so every AI result stays tied to exactly what was reviewed.
        </div>
      )}
      
      {versions.length > 0 && location.pathname.includes("/deepdive") && (
        <div className="version-bar">
          <label htmlFor="opp-version"><b>Version</b></label>
          <select id="opp-version" value={selectedVersionId}
            onChange={(e) => setSearch(e.target.value === opp.current_version_id ? {} : { v: e.target.value }, { replace: true })}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version_number}{v.is_current ? " (current)" : ""}{v.is_locked ? " · locked" : " · open"}
              </option>
            ))}
          </select>
          <span className="muted small">
            {selectedVersion?.is_current
              ? "The DeepDive Builder and the AI Analysis below belong to this version."
              : `Viewing v${selectedVersion?.version_number} as it was. Switch to v${current?.version_number} to make changes.`}
          </span>
          {selectedVersion && !selectedVersion.is_current && (
            <button className="btn ghost small" onClick={() => setSearch({}, { replace: true })}>
              Back to v{current?.version_number}
            </button>
          )}
        </div>
      )}

      <nav className="tabs" aria-label="Opportunity sections">
        <NavLink end to={`/opportunities/${opp.id}`} className={({ isActive }) => (isActive ? "active" : "")}>Overview</NavLink>
        <NavLink to={`/opportunities/${opp.id}/deepdive${versionQuery}`} className={({ isActive }) => (isActive ? "active" : "")}>DeepDive</NavLink>
        <NavLink to={`/opportunities/${opp.id}/review`} className={({ isActive }) => (isActive ? "active" : "")}>
          Review &amp; Governance
        </NavLink>
        <NavLink to={`/opportunities/${opp.id}/tracker`} className={({ isActive }) => (isActive ? "active" : "")}>
          AI Accepted Tracker
        </NavLink>
        <NavLink to={`/opportunities/${opp.id}/readiness`} className={({ isActive }) => (isActive ? "active" : "")}>
          Readiness Checklist
        </NavLink>
        <NavLink to={`/opportunities/${opp.id}/history`} className={({ isActive }) => (isActive ? "active" : "")}>
          Versions ({versions.length})
        </NavLink>
      </nav>

      <Routes>
        <Route index element={<Overview opp={opp} versions={versions} history={history} workspace={workspace} />} />
        <Route path="tracker" element={workspace
          ? <TrackerTab opp={opp} workspace={workspace} onChanged={() => { void load(); void loadWorkspace(); }} />
          : <p className="muted">Loading…</p>} />
        {/* Always the latest DeepDive version: that is what the team is working to. */}
        <Route path="readiness" element={<ReadinessTab opp={opp} versionId={opp.current_version_id} />} />
        <Route path="deepdive" element={
          <div className="card" style={{ overflow: "hidden", margin: "0 -8px" }}>
            <SharedFolder opp={opp} onChanged={() => { void load(); void loadWorkspace(); }} />
            {/* Review & Governance has its own section, so the DeepDive shows its two steps only */}
            {workspace && (
              <StepTrail active={step} steps={workspace.steps.filter((s) => s.key !== "review")}
                onSelect={(key) => setSearch(key === "builder" ? {} : { step: key }, { replace: true })} />
            )}
            {step === "ai" && (workspace
              ? <AiAnalysisTab opp={opp} workspace={workspace} onChanged={() => { void load(); void loadWorkspace(); }} />
              : <p className="muted">Loading…</p>)}
            {step === "builder" && <>
            <BuilderHost ref={builder} opportunity={opp} versionId={selectedVersionId}
              onSaved={(sv) => setVersions((vs) => vs.map((x) => (x.id === sv.id ? { ...x, ...sv } : x)))} />
            </>}
          </div>
        } />
        {/* Everything raised here goes into the DeepDive, so the DeepDive stays the single reference. */}
        <Route path="review" element={<GovernanceTab opp={opp} onChanged={() => { void load(); void loadWorkspace(); }} />} />
        {/* AI work lives in the DeepDive's AI Analysis step; older links land there. */}
        <Route path="ai" element={<Navigate to={`/opportunities/${opp.id}/deepdive?step=ai`} replace />} />
        <Route path="ai-recommendations" element={<Navigate to={`/opportunities/${opp.id}/deepdive?step=ai`} replace />} />
        <Route path="history" element={<>
          <VersionTimeline opp={opp} versions={versions} />
          <div style={{ height: 18 }} />
          <HistoryTimeline history={history} />
        </>} />
      </Routes>

      {dialog?.kind === "action" && (
        <Modal title={dialog.action.label} onClose={closeDialog} footer={<>
          <button className="btn ghost" onClick={closeDialog}>Cancel</button>
          <button className="btn primary" disabled={busy || (dialog.action.requires_comment && !text.trim())}
            onClick={() => void runAction(dialog.action, text || undefined)}>{busy ? "Working…" : dialog.action.label}</button>
        </>}>
          <ErrorAlert error={dialogError} />
          <p className="muted">
            {dialog.action.action === "start_review" && `Start reviewing v${opp.current_version}. The owner can’t change this version while you review it.`}
            {dialog.action.action === "mark_ready_for_ai" && `Mark v${opp.current_version} as ready for AI analysis. Your review decision is recorded against this version.`}
          </p>
          <div className="field">
            <label htmlFor="action-comment">{dialog.action.requires_comment ? "Requested changes (required)" : "Comment (optional)"}</label>
            <textarea id="action-comment" rows={5} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </Modal>
      )}

      {dialog?.kind === "delete" && (
        <Modal title={wasSubmitted ? "Archive this opportunity?" : "Delete this opportunity?"} onClose={closeDialog} footer={<>
          <button className="btn ghost" onClick={closeDialog}>Cancel</button>
          <button className="btn danger" disabled={busy} onClick={() => void remove()}>
            {busy ? "Working…" : wasSubmitted ? "Archive" : "Delete"}
          </button>
        </>}>
          <ErrorAlert error={dialogError} />
          <p><b>{opp.opportunity_number} — {opp.title}</b></p>
          <p className="muted">
            {wasSubmitted
              ? "This opportunity has been submitted, so it is archived rather than deleted: it disappears from the lists but every version, document, comment and AI result is kept. You can restore it, and an Admin can purge it for good."
              : "This draft was never submitted, so it is deleted along with anything attached to it. It cannot be undone; the audit log keeps a record."}
          </p>
        </Modal>
      )}

      {dialog?.kind === "new-version" && (
        <Modal title="Create new version" onClose={closeDialog} footer={<>
          <button className="btn ghost" onClick={closeDialog}>Cancel</button>
          <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void createVersion()}>{busy ? "Creating…" : `Create v${(versions[0]?.version_number ?? 0) + 1}`}</button>
        </>}>
          <ErrorAlert error={dialogError} />
          <p className="muted">
            v{opp.current_version} is kept exactly as it is, with its review comments. The new version starts as a full
            copy that can be edited{["submitted", "in_review", "ready_for_ai"].includes(opp.status)
              ? ", and the opportunity returns to Draft so the work can continue." : "."}
          </p>
          <div className="field">
            <label htmlFor="change-notes">What changes in this version? (required)</label>
            <textarea id="change-notes" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Added RFP compliance matrix to the scope of work as requested" />
          </div>
        </Modal>
      )}

      {dialog?.kind === "incomplete" && (
        <Modal title="The DeepDive isn’t complete yet" onClose={closeDialog} footer={<>
          <button className="btn primary" onClick={() => { closeDialog(); navigate(`/opportunities/${opp.id}/deepdive`); setTimeout(() => builder.current?.gotoReview(), 800); }}>Show missing fields</button>
        </>}>
          <p>{dialog.count} required field{dialog.count === 1 ? " is" : "s are"} still empty, so it can’t be submitted to your Director.</p>
          {dialog.missing.length > 0 && <ul className="small">{dialog.missing.slice(0, 10).map((m) => <li key={m}>{m}</li>)}{dialog.count > 10 && <li>…and {dialog.count - 10} more</li>}</ul>}
          <p className="muted small">The Review & download step in the DeepDive lists every missing field, and you can jump straight to each one.</p>
        </Modal>
      )}
    </main>
  );
}

/** Overview is the master record: it always shows the latest opportunity information, whatever version is selected. */
function Overview({ opp, versions, history, workspace }:
  { opp: OpportunityDetail; versions: VersionSummary[]; history: HistoryItem[]; workspace: Workspace | null }) {
  const navigate = useNavigate();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (!opp.current_version_id) return;
    api.get<VersionDetail>(`/opportunities/${opp.id}/versions/${opp.current_version_id}`).then((v) => setData(v.data)).catch(() => undefined);
  }, [opp.id, opp.current_version_id, opp.updated_at]);
  const str = (k: string) => (data && typeof data[k] === "string" && (data[k] as string).trim()) || "—";
  const value = data?.value ? `SAR ${Number(data.value).toLocaleString("en-US")}` : "—";

  return (
    <div className="two-col">
      <section className="card card-pad">
        <h2 className="section">Opportunity snapshot</h2>
        <p className="muted small" style={{ marginTop: -6 }}>
          Master record: always the latest information, shared by every version.
        </p>
        <dl className="kv">
          <dt>Opportunity number</dt><dd>{opp.opportunity_number}</dd>
          <dt>Customer</dt><dd>{opp.account_name}</dd>
          <dt>Type</dt><dd>{opp.opportunity_type ?? "—"}</dd>
          <dt>Vertical</dt><dd>{opp.vertical ?? "—"}</dd>
          <dt>Estimated value</dt><dd>{value}</dd>
          <dt>Presales received</dt><dd>{str("presalesReceived") === "—" ? "—" : fmtDate(str("presalesReceived"))}</dd>
          <dt>Submission date</dt><dd>{str("submissionDate") === "—" ? "—" : fmtDate(str("submissionDate"))}</dd>
          <dt>Presales owner</dt><dd>{str("presalesOwner")}</dd>
          <dt>Account manager</dt><dd>{str("accountManager")}</dd>
          <dt>PS / MS duration</dt><dd>{str("psDuration")} / {str("msDuration")}</dd>
          <dt>Team</dt><dd>{opp.team_name ?? "—"}</dd>
          <dt>Created</dt><dd>{fmtDateTime(opp.created_at)}</dd>
          <dt>Last updated</dt><dd>{fmtDateTime(opp.updated_at)}</dd>
        </dl>
      </section>
      <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {workspace && (
          <section className="card card-pad">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <h2 className="section" style={{ margin: 0 }}>AI Analysis</h2>
              <Link to={`/opportunities/${opp.id}/deepdive?step=ai`} className="small">Open AI Analysis ›</Link>
            </div>
            {workspace.session_confirmed ? (
              <div style={{ marginTop: 12 }}>
                <AiSummary analyses={workspace.analyses} findings={workspace.findings}
                  onOpen={(key) => navigate(`/opportunities/${opp.id}/deepdive?step=ai${key ? `&output=${key}` : ""}`)} />
              </div>
            ) : (
              <p className="muted small" style={{ marginBottom: 0 }}>
                {workspace.session_version
                  ? `Opens once the DeepDive session for v${workspace.session_version} is confirmed.`
                  : "Opens once a DeepDive version is submitted and its session is confirmed."}
              </p>
            )}
          </section>
        )}
        <section className="card card-pad">
          <h2 className="section">Versions</h2>
          <VersionList opp={opp} versions={versions.slice(0, 4)} compact />
          {versions.length > 4 && <Link to={`/opportunities/${opp.id}/versions`} className="small">All {versions.length} versions</Link>}
        </section>
        <section className="card card-pad">
          <h2 className="section">Latest activity</h2>
          <HistoryList history={history.slice(0, 5)} />
        </section>
      </aside>
    </div>
  );
}

function VersionList({ opp, versions, compact }: { opp: OpportunityDetail; versions: VersionSummary[]; compact?: boolean }) {
  if (!versions.length) return <Empty title="No versions" />;
  return (
    <ol className="timeline">
      {versions.map((v) => (
        <li key={v.id} className={v.is_current ? "current" : ""}>
          <span className="node" aria-hidden="true" />
          <div className="t-title">
            Version {v.version_number} {v.is_current && <span className="badge st-submitted" style={{ marginLeft: 6 }}>Current</span>}
            {v.is_locked ? <span className="badge st-draft" style={{ marginLeft: 6 }}>Locked</span>
              : <span className="badge st-completed" style={{ marginLeft: 6 }}>Open for editing</span>}
          </div>
          <div className="t-meta">
            Created {fmtDateTime(v.created_at)} by {v.created_by.full_name}
            {!compact && <> · updated {timeAgo(v.updated_at)} by {v.updated_by.full_name}</>}
            {v.submitted_at && <> · submitted {fmtDateTime(v.submitted_at)}</>}
          </div>
          {v.change_notes && <div className="t-body">{v.change_notes}</div>}
          <div className="version-links small">
            <Link to={`/opportunities/${opp.id}/deepdive${v.is_current ? "" : `?v=${v.id}`}`}>DeepDive</Link>
            <Link to={`/opportunities/${opp.id}/documents${v.is_current ? "" : `?v=${v.id}`}`}>Documents</Link>
            <Link to={`/opportunities/${opp.id}/review${v.is_current ? "" : `?v=${v.id}`}`}>Review</Link>
            <Link to={`/opportunities/${opp.id}/ai${v.is_current ? "" : `?v=${v.id}`}`}>AI</Link>
          </div>
        </li>
      ))}
    </ol>
  );
}

function VersionTimeline({ opp, versions }: { opp: OpportunityDetail; versions: VersionSummary[] }) {
  return (
    <section className="card card-pad" style={{ maxWidth: 900 }}>
      <h2 className="section">Versions ({versions.length})</h2>
      <p className="muted small">
        Each version holds its own DeepDive, documents, review comments and AI results. Submitting locks a version, so
        those four always describe exactly what was reviewed. Open any version from here.
      </p>
      <VersionList opp={opp} versions={versions} />
    </section>
  );
}

function HistoryList({ history }: { history: HistoryItem[] }) {
  if (!history.length) return <Empty title="No activity yet" />;
  return (
    <ol className="timeline">
      {history.map((h, i) => (
        <li key={h.id} className={i === 0 ? "current" : ""}>
          <span className="node" aria-hidden="true" />
          <div className="t-title">{h.from_label ? `${h.from_label} → ${h.to_label}` : `Created as ${h.to_label}`}</div>
          <div className="t-meta">{h.actor?.full_name ?? "System"} · {fmtDateTime(h.created_at)}{h.version_number ? ` · v${h.version_number}` : ""}</div>
          {h.comment && <div className="t-body">{h.comment}</div>}
        </li>
      ))}
    </ol>
  );
}

function HistoryTimeline({ history }: { history: HistoryItem[] }) {
  return (
    <section className="card">
      <div className="card-pad" style={{ paddingBottom: 6 }}><h2 className="section">Workflow history</h2>
        <p className="muted small" style={{ margin: 0 }}>Every status change with who made it, when, and on which version.</p></div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>When</th><th>Action</th><th>From</th><th>To</th><th>By</th><th>Version</th><th>Comment</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td className="small num">{fmtDateTime(h.created_at)}</td>
                <td>{h.action.replace(/_/g, " ")}</td>
                <td>{h.from_status ? <StatusBadge status={h.from_status} label={h.from_label ?? ""} /> : "—"}</td>
                <td><StatusBadge status={h.to_status} label={h.to_label} /></td>
                <td>{h.actor?.full_name ?? "System"}</td>
                <td className="num">{h.version_number ? `v${h.version_number}` : "—"}</td>
                <td className="small" style={{ whiteSpace: "pre-wrap", maxWidth: 360 }}>{h.comment ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
