/* AI analysis and recommendations for one opportunity: readiness areas, findings with the evidence behind
   them, required actions, and what the run was given as input. Every citation opens its source text. */
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AiCitation, AiRunDetail, AiRunSummary, AiSource, OpportunityDetail } from "../api/types";
import { PERM, useAuth } from "../auth/AuthContext";
import { fmtDateTime } from "../lib/format";
import { Empty, ErrorAlert, Modal, useToast } from "./ui";

const READINESS_LABEL: Record<string, string> = { ready: "Ready", ready_with_actions: "Ready with actions", not_ready: "Not ready" };
const READINESS_TONE: Record<string, string> = { ready: "rd-ready", ready_with_actions: "rd-ready_with_actions", not_ready: "rd-not_ready" };
const SEVERITY_TONE: Record<string, string> = {
  critical: "st-changes_requested", high: "st-ready_for_ai", medium: "st-submitted", low: "st-completed",
};
const EVIDENCE_LABEL: Record<string, string> = {
  fact: "Fact", director_observation: "Director observation", ai_inference: "AI inference", missing_information: "Missing information",
};
const AREA_LABEL: Record<string, string> = {
  opportunity_understanding: "Opportunity understanding", technical_readiness: "Technical readiness",
  commercial_readiness: "Commercial readiness", partner_readiness: "Partner / vendor readiness",
  proposal_readiness: "Proposal readiness", risk_readiness: "Risk readiness", director_concerns: "Director concerns",
  customer_requirement_coverage: "Customer requirement coverage",
};

export function AiTab({ opp, versionId, onChanged }: { opp: OpportunityDetail; versionId?: string; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [runs, setRuns] = useState<AiRunSummary[]>([]);
  const [detail, setDetail] = useState<AiRunDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<AiSource | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.get<AiRunSummary[]>(`/opportunities/${opp.id}/ai/runs`, { version_id: versionId });
      setRuns(list);
      const id = selected ?? list.find((r) => r.status === "succeeded")?.id ?? list[0]?.id ?? null;
      if (id) {
        setDetail(await api.get<AiRunDetail>(`/opportunities/${opp.id}/ai/runs/${id}`));
        setSelected(id);
      }
    } catch (e) { if (!(e instanceof ApiError && e.status === 403)) setError(e); }
  }, [opp.id, selected, versionId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!runs.some((r) => r.status === "queued" || r.status === "running")) return;
    const timer = setInterval(() => { void load(); onChanged(); }, 5000);   // follow a running analysis
    return () => clearInterval(timer);
  }, [runs, load, onChanged]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(`/opportunities/${opp.id}/ai/runs`);
      toast("AI analysis queued. This page updates as it progresses.");
      setSelected(null);
      await load();
      onChanged();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const openSource = async (citation: AiCitation) => {
    try { setSource(await api.get<AiSource>(`/opportunities/${opp.id}/ai/citations/${citation.chunk_id}`)); }
    catch { toast("That source is no longer available.", "error"); }
  };

  const viewingCurrent = !versionId || versionId === opp.current_version_id;
  const canTrigger = viewingCurrent && can(PERM.AI_TRIGGER) && opp.status === "ready_for_ai";
  const running = runs.find((r) => r.status === "queued" || r.status === "running");
  const rec = detail?.recommendation;

  const Citations = ({ items }: { items: AiCitation[] }) => (
    <div className="citations">
      {items.map((c, i) => (
        <button key={`${c.chunk_id}-${i}`} type="button" className="cite" onClick={() => void openSource(c)}
          title="Open the source text">Source {i + 1}</button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="ai-bar">
        <div>
          <b>AI recommendations</b>
          {detail && <span className="muted small"> · run of v{detail.version_number} · {fmtDateTime(detail.completed_at ?? detail.queued_at)}</span>}
        </div>
        {runs.length > 1 && (
          <select value={selected ?? ""} onChange={(e) => { setSelected(e.target.value); setDetail(null); }}
            style={{ border: "1.5px solid var(--line)", borderRadius: 9, padding: "6px 10px" }}>
            {runs.map((r) => <option key={r.id} value={r.id}>v{r.version_number} · {fmtDateTime(r.queued_at)} · {r.status}</option>)}
          </select>
        )}
        {canTrigger && <button className="btn coral" disabled={busy || !!running} onClick={() => void start()}>
          {busy ? "Starting…" : "Run AI analysis"}
        </button>}
      </div>
      <ErrorAlert error={error} />

      {running && (
        <div className="alert info" style={{ marginBottom: 16 }}>
          <b>Analysis in progress.</b> The documents, the DeepDive and the Director’s comments are being read and
          cross-checked on the on-premises model. This page refreshes on its own.
        </div>
      )}
      {detail?.status === "failed" && (
        <div className="alert error" style={{ marginBottom: 16 }}>
          <b>The analysis failed.</b> {detail.error_message}
          <div className="small">The opportunity stays at Ready for AI so it can be run again.</div>
        </div>
      )}
      {!runs.length && !running && (
        <Empty title="No AI analysis yet">
          {canTrigger ? "Run the analysis once the DeepDive, documents and review comments are in place."
            : opp.status === "ready_for_ai" ? "The Presales Director or an Admin starts the analysis."
            : "The Director marks an opportunity Ready for AI before it can be analysed."}
        </Empty>
      )}

      {detail?.status === "succeeded" && rec && (
        <>
          <section className="card card-pad" style={{ marginBottom: 18 }}>
            <div className="readiness-head">
              <div>
                <div className="muted small">Overall readiness</div>
                <div className={`badge ${READINESS_TONE[rec.overall_readiness]}`} style={{ fontSize: 15, padding: "6px 14px" }}>
                  {READINESS_LABEL[rec.overall_readiness] ?? rec.overall_readiness}
                </div>
              </div>
              <p style={{ margin: 0, flex: 1, minWidth: 280 }}>{detail.executive_summary}</p>
              <div className="muted small" style={{ textAlign: "right" }}>
                Confidence {rec.confidence !== null ? `${Math.round((rec.confidence ?? 0) * 100)}%` : "—"}<br />
                {detail.llm_model} · prompt {detail.prompt_version}
              </div>
            </div>
            <div className="areas">
              {Object.entries(rec.readiness_areas).map(([key, area]) => (
                <div key={key} className={`area area-${area.status}`}>
                  <div className="area-top"><span className={`dot-${area.status}`} aria-hidden="true" />{AREA_LABEL[key] ?? key}</div>
                  <p>{area.summary}</p>
                  {area.evidence && <p className="muted small">{area.evidence}</p>}
                  {area.citations?.length > 0 && <Citations items={area.citations} />}
                </div>
              ))}
            </div>
          </section>

          <div className="two-col" style={{ marginBottom: 18 }}>
              <section className="card">
                <div className="card-pad" style={{ paddingBottom: 6 }}><h2 className="section">Required actions before proceeding</h2></div>
                {rec.required_actions.length === 0 ? <Empty title="No actions were raised" /> : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th>Priority</th><th>Required action</th><th>Reason</th><th>Owner</th><th>Due</th><th>Source</th></tr></thead>
                      <tbody>
                        {rec.required_actions.map((a, i) => (
                          <tr key={i}>
                            <td><span className={`badge ${SEVERITY_TONE[a.priority] ?? "st-draft"}`}>{a.priority}</span></td>
                            <td><b>{a.action}</b></td>
                            <td className="small">{a.reason}</td>
                            <td className="small">{a.owner || "—"}</td>
                            <td className="small">{a.due || "—"}</td>
                            <td className="small muted">{a.source || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <section className="card card-pad">
                  <h2 className="section">Management recommendation</h2>
                  <p style={{ whiteSpace: "pre-wrap" }}>{rec.management_recommendation}</p>
                  <p className="muted small">Advisory only. Authorised presales management makes the decision.</p>
                </section>
                <section className="card card-pad">
                  <h2 className="section">Missing information</h2>
                  {rec.missing_information.length === 0 ? <p className="muted small">Nothing was flagged as missing.</p> : (
                    <ul className="missing">
                      {rec.missing_information.map((m, i) => (
                        <li key={i}><b>{m.item}</b><div className="muted small">{m.why_it_matters}{m.where_to_get_it ? ` · ${m.where_to_get_it}` : ""}</div></li>
                      ))}
                    </ul>
                  )}
                </section>
              </aside>
          </div>
          <>
              <section className="card" style={{ marginBottom: 18 }}>
                <div className="card-pad" style={{ paddingBottom: 6 }}>
                  <h2 className="section">Findings ({detail.findings.length})</h2>
                  <p className="muted small" style={{ margin: 0 }}>
                    Each finding shows what it rests on: a fact from the sources, an observation from the Director,
                    an AI interpretation, or information that is missing.
                  </p>
                </div>
                {detail.findings.length === 0 ? <Empty title="No findings were raised" /> : (
                  <ul className="comment-list">
                    {detail.findings.map((f) => (
                      <li key={f.id} className="comment">
                        <div className="comment-head">
                          <span className={`badge ${SEVERITY_TONE[f.severity] ?? "st-draft"}`}>{f.severity}</span>
                          <span className={`badge ${f.evidence_class === "fact" ? "st-completed" : f.evidence_class === "missing_information" ? "st-ready_for_ai" : "st-submitted"}`}>
                            {EVIDENCE_LABEL[f.evidence_class] ?? f.evidence_class}
                          </span>
                          <span className="muted small">{f.section.replace(/_/g, " ")}</span>
                        </div>
                        <b>{f.title}</b>
                        <p className="comment-body">{f.finding}</p>
                        {f.evidence && <p className="muted small"><b>Evidence:</b> {f.evidence}</p>}
                        {f.business_impact && <p className="muted small"><b>Impact:</b> {f.business_impact}</p>}
                        {f.recommended_action && <p className="small"><b>Recommended:</b> {f.recommended_action}{f.suggested_owner ? ` (${f.suggested_owner})` : ""}</p>}
                        {f.citations?.length > 0 && <Citations items={f.citations} />}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {detail.director_comment_analysis.length > 0 && (
                <section className="card" style={{ marginBottom: 18 }}>
                  <div className="card-pad" style={{ paddingBottom: 6 }}><h2 className="section">Director comments</h2></div>
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th>Comment</th><th>Addressed?</th><th>Explanation</th><th>Source</th></tr></thead>
                      <tbody>
                        {detail.director_comment_analysis.map((c, i) => (
                          <tr key={i}>
                            <td className="small">{c.comment_summary}</td>
                            <td><span className="badge st-draft">{c.addressed.replace(/_/g, " ")}</span></td>
                            <td className="small">{c.explanation}</td>
                            <td>{c.citations?.length > 0 && <Citations items={c.citations} />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section className="card card-pad">
                <h2 className="section">What this run was given</h2>
                <p className="muted small">
                  The inputs are frozen when the run starts, so the result always refers to exactly this material.
                </p>
                <dl className="kv">
                  <dt>DeepDive version</dt><dd>v{detail.version_number}</dd>
                  <dt>Documents</dt><dd>{detail.input_manifest?.documents.map((d) => d.file_name).join(", ") || "None"}</dd>
                  <dt>Model</dt><dd>{detail.llm_model} · embeddings {detail.embedding_model}</dd>
                  <dt>Prompt / schema</dt><dd>{detail.prompt_version} / {detail.schema_version}</dd>
                  <dt>Started by</dt><dd>{detail.triggered_by}</dd>
                </dl>
                {detail.validation_warnings.length > 0 && (
                  <div className="alert info" style={{ marginTop: 14 }}>
                    <b>{detail.validation_warnings.length} grounding check(s) flagged something.</b> Claims that were not
                    supported by a cited source were recorded as interpretations rather than facts.
                    <ul>{detail.validation_warnings.slice(0, 6).map((w, i) => <li key={i}>{w.where}: {w.detail}</li>)}</ul>
                  </div>
                )}
              </section>
            </>
        </>
      )}

      {source && (
        <Modal title={source.location} onClose={() => setSource(null)} footer={<button className="btn primary" onClick={() => setSource(null)}>Close</button>}>
          <p className="muted small">{source.source_kind === "document" ? "Customer document" : source.source_kind === "review" ? "Director review" : "DeepDive"}</p>
          <pre className="source-text">{source.text}</pre>
        </Modal>
      )}
    </div>
  );
}
