import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { OpportunityListItem, Page } from "../api/types";
import { PERM, useAuth } from "../auth/AuthContext";
import { aiVerdict, belongsTo, OUTPUTS } from "../components/AnalysisOutputs";
import { OpportunityTable } from "../components/OpportunityTable";
import { Empty, ErrorAlert, PageHeader } from "../components/ui";
import { fmtDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export function ReviewsPage() {
  const { can } = useAuth();
  const awaiting = useAsync(() => api.get<Page<OpportunityListItem>>("/opportunities", { status: ["submitted", "in_review"], sort: "updated_at", page_size: 50 }), []);
  const exec = can(PERM.DASHBOARD_EXECUTIVE);
  return (
    <main className="content">
      <PageHeader kicker="Stage 2 · Director review" title="Reviews"
        lede={exec ? "DeepDives in Director review across all teams." : "DeepDives your team submitted, oldest first. Open one to review it and record your decision."} />
      <ErrorAlert error={awaiting.error} />
      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-pad" style={{ paddingBottom: 6 }}><h2 className="section">{exec ? "In Director review" : "Awaiting my review"} ({awaiting.data?.total ?? 0})</h2></div>
        <OpportunityTable rows={awaiting.data?.items ?? []}  emptyText="Nothing is waiting for review." />
      </section>
    </main>
  );
}

interface PortfolioRow {
  id: string; opportunity_number: string; title: string; account_name: string; owner: string | null;
  status: string; status_label: string; submission_date: string | null;
  analyses: { kind: string; title: string; status: string; missing: string[] }[];
  findings: { id: string; analysis: string; type: string; severity: string; title: string; status: string }[];
}

const VERDICT_FILTERS = ["All", "Action needed", "In progress", "Ready with actions", "Ready to submit", "Ready to analyse", "Not started"];

/** AI Recommendations: every visible opportunity's analyses, open findings and verdict in one place. */
export function AiRecommendationsPage() {
  const navigate = useNavigate();
  const rows = useAsync(() => api.get<PortfolioRow[]>("/ai/portfolio"), []);
  const [filter, setFilter] = useState("All");
  const list = (rows.data ?? []).map((r) => ({ ...r, verdict: aiVerdict(r.analyses, r.findings),
    open: r.findings.filter((f) => f.status === "open") }));
  const shown = filter === "All" ? list : list.filter((r) => r.verdict.label === filter);
  const allOpen = list.flatMap((r) => r.open.map((f) => ({ ...f, opp: r })));
  const high = allOpen.filter((f) => f.severity === "high");
  const questions = allOpen.filter((f) => belongsTo(OUTPUTS[0], f));
  const outputOf = (f: { analysis: string; type: string }) => OUTPUTS.find((o) => belongsTo(o, f));
  const open = (id: string, output?: string) =>
    navigate(`/opportunities/${id}/deepdive?step=ai${output ? `&output=${output}` : ""}`);
  const stats: [number, string, string][] = [
    [list.filter((r) => r.analyses.some((a) => a.status === "completed" || a.status === "reanalysis_required")).length, "Opportunities analysed", ""],
    [list.filter((r) => r.verdict.label === "Action needed").length, "Need action", "tone-red"],
    [list.filter((r) => r.verdict.label.startsWith("Ready with") || r.verdict.label === "Ready to submit").length, "Ready to submit", "tone-green"],
    [high.length, "Open high-severity findings", "tone-coral"],
    [questions.length, "Open customer questions", ""],
  ];
  return (
    <main className="content">
      <PageHeader title="AI Recommendations"
        lede="The AI analyses of every opportunity you can see: what has run, what is open, and what needs action before submission." />
      <ErrorAlert error={rows.error} />
      <div className="stat-grid">
        {stats.map(([v, l, tone]) => <div key={l} className={`stat ${tone}`}><span className="v">{v}</span><span className="l">{l}</span></div>)}
      </div>

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-pad" style={{ paddingBottom: 8, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <h2 className="section" style={{ margin: 0, marginRight: "auto" }}>Opportunities ({shown.length})</h2>
          {VERDICT_FILTERS.map((v) => (
            <button key={v} type="button" className={`filter-chip${filter === v ? " active" : ""}`} onClick={() => setFilter(v)}>{v}</button>
          ))}
        </div>
        {rows.loading ? <p className="muted card-pad">Loading…</p> : shown.length === 0 ? <Empty title="No opportunities match" /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Opportunity</th><th>Presales Lead</th><th>Submission</th><th>Analyses</th><th>Open findings</th><th>Status</th><th />
              </tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/opportunities/${r.id}`}><b>{r.title}</b></Link>
                      <div className="muted small">{r.opportunity_number} · {r.account_name}</div></td>
                    <td>{r.owner ?? "—"}</td>
                    <td>{r.submission_date ? fmtDate(r.submission_date) : "—"}</td>
                    <td>
                      <span className="analysis-dots">
                        {r.analyses.map((a) => <span key={a.kind} className={`an-${a.status}`} title={`${a.title}: ${a.status.replace(/_/g, " ")}`} />)}
                      </span>
                      <div className="muted small">
                        {r.analyses.filter((a) => a.status === "completed" || a.status === "reanalysis_required").length} of {r.analyses.length}
                      </div>
                    </td>
                    <td>{r.open.length}{r.open.some((f) => f.severity === "high") &&
                      <span className="sev-text"> · {r.open.filter((f) => f.severity === "high").length} high</span>}</td>
                    <td><span className={`verdict tone-${r.verdict.tone}`}>{r.verdict.label}</span></td>
                    <td><button className="btn ghost small" onClick={() => open(r.id)}>Open AI Analysis</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-pad" style={{ paddingBottom: 6 }}>
          <h2 className="section" style={{ margin: 0 }}>High-severity findings to act on ({high.length})</h2>
          <p className="muted small" style={{ margin: "4px 0 0" }}>Open them to accept, modify or dismiss with the evidence in front of you.</p>
        </div>
        {high.length === 0 ? <Empty title="No open high-severity findings" /> : (
          <ul className="portfolio-findings">
            {high.map((f) => {
              const o = outputOf(f);
              return (
                <li key={f.id}>
                  <button type="button" onClick={() => open(f.opp.id, o?.key)}>
                    <b>{f.title}</b>
                    <span className="muted small">{f.opp.title} · {o?.title ?? "Other findings"} · {
                      f.opp.analyses.find((a) => a.kind === f.analysis)?.title ?? f.analysis}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
