import { useState } from "react";
import { api } from "../api/client";
import type { OpportunityDetail, Reference, ReviewComment, ReviewOut } from "../api/types";
import { fmtDate, fmtDateTime } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { Empty, ErrorAlert, useToast } from "./ui";

const TYPE_TONE: Record<string, string> = {
  critical_issue: "st-changes_requested", required_action: "st-ready_for_ai",
  missing_information: "st-ai_recommendations", section: "st-submitted", general: "st-draft",
};
const PRIORITY_TONE: Record<string, string> = {
  critical: "st-changes_requested", high: "st-ready_for_ai", medium: "st-submitted", low: "st-completed",
};
const EMPTY = { comment_type: "section", section: "", body: "", priority: "", owner_name: "", due_date: "" };

export function ReviewTab({ opp, versionId }: { opp: OpportunityDetail; versionId?: string }) {
  const toast = useToast();
  const ref = useAsync(() => api.get<Reference>("/meta/reference"), []);
  const review = useAsync(() => api.get<ReviewOut>(`/opportunities/${opp.id}/review`, { version_id: versionId }),
                          [opp.id, opp.status, versionId]);
  const [draft, setDraft] = useState({ ...EMPTY });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const comments = (review.data?.comments ?? []).filter((c) => showResolved || c.status === "open");
  const needsPriority = ["critical_issue", "required_action"].includes(draft.comment_type);

  const add = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(`/opportunities/${opp.id}/review/comments`, {
        comment_type: draft.comment_type, section: draft.section || null, body: draft.body,
        priority: draft.priority || null, owner_name: draft.owner_name || null, due_date: draft.due_date || null,
      });
      setDraft({ ...EMPTY, comment_type: draft.comment_type });
      toast("Comment added. The owner has been notified.");
      await review.reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const setStatus = async (c: ReviewComment, status: string) => {
    try { await api.patch(`/opportunities/${opp.id}/review/comments/${c.id}`, { status }); await review.reload(); }
    catch (e) { setError(e); }
  };
  const remove = async (c: ReviewComment) => {
    try { await api.del(`/opportunities/${opp.id}/review/comments/${c.id}`); toast("Comment removed."); await review.reload(); }
    catch (e) { setError(e); }
  };

  const typeLabel = (key: string) => ref.data?.comment_types.find((t) => t.key === key)?.label ?? key;
  const sectionLabel = (key: string | null) => (key ? ref.data?.deepdive_sections.find((s) => s.key === key)?.label ?? key : null);

  return (
    <div className="two-col">
      <section className="card">
        <div className="card-pad" style={{ paddingBottom: 6, display: "flex", alignItems: "baseline", gap: 12 }}>
          <h2 className="section" style={{ margin: 0 }}>Review comments ({review.data?.open_count ?? 0} open)</h2>
          <label className="small muted" style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved
          </label>
        </div>
        <ErrorAlert error={error ?? review.error} />
        {comments.length === 0 ? (
          <Empty title={review.data?.open_count ? "Nothing open" : "No comments yet"}>
            {review.data?.can_comment ? "Add what needs attention before this DeepDive goes to AI analysis." : ""}
          </Empty>
        ) : (
          <ul className="comment-list">
            {comments.map((c) => (
              <li key={c.id} className={`comment${c.status !== "open" ? " resolved" : ""}`}>
                <div className="comment-head">
                  <span className={`badge ${TYPE_TONE[c.comment_type] ?? "st-draft"}`}>{typeLabel(c.comment_type)}</span>
                  {c.priority && <span className={`badge ${PRIORITY_TONE[c.priority]}`}>{c.priority}</span>}
                  {c.section && <span className="muted small">{sectionLabel(c.section)}</span>}
                  <span className="muted small" style={{ marginLeft: "auto" }}>v{c.version_number}</span>
                </div>
                <p className="comment-body">{c.body}</p>
                <div className="comment-meta">
                  {c.created_by.full_name}{c.created_by_role ? ` (${c.created_by_role})` : ""} · {fmtDateTime(c.created_at)}
                  {c.owner_name && <> · owner <b>{c.owner_name}</b></>}
                  {c.due_date && <> · due {fmtDate(c.due_date)}</>}
                  {c.status !== "open" && <> · <b>{c.status}</b></>}
                </div>
                {c.can_manage && (
                  <div className="comment-actions">
                    {c.status === "open"
                      ? <button className="btn ghost small" onClick={() => void setStatus(c, "addressed")}>Mark addressed</button>
                      : <button className="btn ghost small" onClick={() => void setStatus(c, "open")}>Reopen</button>}
                    <button className="btn danger small" onClick={() => void remove(c)}>Delete</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {review.data?.can_comment && (
          <section className="card card-pad">
            <h2 className="section">Add a review comment on v{opp.current_version}</h2>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="c-type">Type</label>
                <select id="c-type" value={draft.comment_type} onChange={(e) => setDraft({ ...draft, comment_type: e.target.value })}>
                  {ref.data?.comment_types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-section">DeepDive section</label>
                <select id="c-section" value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })}>
                  <option value="">Not specific</option>
                  {ref.data?.deepdive_sections.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div className="field span">
                <label htmlFor="c-body">Comment</label>
                <textarea id="c-body" rows={4} maxLength={5000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  placeholder="What is missing, wrong or risky — and what should change." />
              </div>
              <div className="field">
                <label htmlFor="c-priority">Priority{needsPriority && <span style={{ color: "var(--coral)" }}> *</span>}</label>
                <select id="c-priority" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
                  <option value="">None</option>
                  {ref.data?.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-due">Due date</label>
                <input id="c-due" type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} />
              </div>
              <div className="field span">
                <label htmlFor="c-owner">Owner</label>
                <input id="c-owner" maxLength={160} value={draft.owner_name} onChange={(e) => setDraft({ ...draft, owner_name: e.target.value })}
                  placeholder="Who should act on this" />
              </div>
            </div>
            <button className="btn primary" disabled={busy || !draft.body.trim() || (needsPriority && !draft.priority)} onClick={() => void add()}>
              {busy ? "Saving…" : "Add comment"}
            </button>
          </section>
        )}
        <section className="card card-pad">
          <h2 className="section">Decisions</h2>
          {review.data?.decisions.length ? (
            <ol className="timeline">
              {review.data.decisions.map((d, i) => (
                <li key={`${d.version_id}-${i}`} className={i === 0 ? "current" : ""}>
                  <span className="node" aria-hidden="true" />
                  <div className="t-title">v{d.version_number}: {d.decision === "ready_for_ai" ? "Ready for AI analysis" : "In review"}</div>
                  <div className="t-meta">{d.reviewer}{d.reviewer_role ? ` (${d.reviewer_role})` : ""}{d.decided_at ? ` · ${fmtDateTime(d.decided_at)}` : " · not decided yet"}</div>
                  {d.summary && <div className="t-body">{d.summary}</div>}
                </li>
              ))}
            </ol>
          ) : <p className="muted small">No review has started yet.</p>}
        </section>
      </aside>
    </div>
  );
}
