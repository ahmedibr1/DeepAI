import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { AuditEntry, Page } from "../../api/types";
import { ErrorAlert, PageHeader } from "../../components/ui";
import { fmtDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";

export function AuditPage() {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [page, setPage] = useState(1);
  const logs = useAsync(() => api.get<Page<AuditEntry>>("/admin/audit-logs", { action, actor, page, page_size: 50 }), [action, actor, page]);
  const pages = Math.max(1, Math.ceil((logs.data?.total ?? 0) / 50));

  return (
    <main className="content">
      <PageHeader kicker="Administration" title="Audit log" lede="Append-only record of sign-ins, changes, submissions, reviews and status changes. Entries cannot be edited or deleted." />
      <ErrorAlert error={logs.error} />
      <section className="card">
        <div className="filters">
          <div className="field"><label htmlFor="a-action">Action starts with</label>
            <select id="a-action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
              <option value="">All actions</option><option value="auth.">Authentication</option><option value="opportunity.">Opportunities</option>
              <option value="version.">Versions</option><option value="user.">Users</option><option value="team.">Teams</option>
              <option value="document.">Documents</option><option value="ai.">AI</option>
            </select></div>
          <div className="field"><label htmlFor="a-actor">User</label><input id="a-actor" value={actor} onChange={(e) => { setActor(e.target.value); setPage(1); }} /></div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Outcome</th><th>Target</th><th>IP address</th><th>Details</th></tr></thead>
            <tbody>
              {logs.data?.items.map((a) => (
                <tr key={a.id}>
                  <td className="small num" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(a.occurred_at)}</td>
                  <td>{a.actor_username ?? "—"}</td>
                  <td><code>{a.action}</code></td>
                  <td>{a.outcome === "success" ? <span className="badge st-completed">success</span> : <span className="badge st-changes_requested">{a.outcome}</span>}</td>
                  <td className="small">{a.opportunity_id ? <Link to={`/opportunities/${a.opportunity_id}`}>Opportunity</Link> : a.entity_type ?? "—"}</td>
                  <td className="small">{a.ip_address ?? "—"}</td>
                  <td className="small" style={{ maxWidth: 380 }}><code style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{a.details ? JSON.stringify(a.details) : ""}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <button className="btn ghost small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages} · {logs.data?.total ?? 0} entries</span>
          <button className="btn ghost small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </section>
    </main>
  );
}
