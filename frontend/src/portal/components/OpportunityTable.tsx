import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { OpportunityListItem } from "../api/types";
import { timeAgo } from "../lib/format";
import { Empty, StatusBadge } from "./ui";

/** Compact card: status, the review line, version and AI status at a glance. */
/** ⚑ Flag: marks the opportunity as strategic, which puts it on the dashboard (an entry criterion). */
function FlagButton({ o, onChanged }: { o: OpportunityListItem; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const manual = o.source === "manual";
  const on = manual || !!o.strategic;
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();          // the card itself is a link
    if (manual) return;
    setBusy(true);
    try { await api.patch(`/opportunities/${o.id}/flags`, { strategic: !on }); onChanged?.(); } finally { setBusy(false); }
  };
  return (
    <button type="button" className={`flag-btn${on ? " on" : ""}`} disabled={busy} onClick={(e) => void toggle(e)}
      aria-pressed={on} title={manual ? "Added by hand, so always flagged" : on ? "Remove the flag" : "Flag as strategic — shows it on the dashboard"}>
      ⚑ {on ? "Flagged" : "Flag"}
    </button>
  );
}

export function OpportunityCards({ rows, empty = "No opportunities yet.", onChanged }:
  { rows: OpportunityListItem[]; empty?: string; onChanged?: () => void }) {
  if (!rows.length) return <Empty title={empty} />;
  return (
    <div className="opp-cards">
      {rows.map((o) => (
        <Link key={o.id} to={`/opportunities/${o.id}`} className="opp-card">
          <div className="top">
            <StatusBadge status={o.status} label={o.status_label} />
            {o.source === "manual" && <span className="flag-chip" title="Added by hand — the opportunities sheet never changes it">Manual</span>}
            {o.entry_criteria?.qualifies && <span className="dash-chip" title="Meets the entry criteria, so it is on the dashboard">On dashboard</span>}
            <span className="muted small">{timeAgo(o.updated_at)}</span>
          </div>
          <div>
            <h3>{o.title}</h3>
            <div className="muted small">{o.opportunity_number} · {o.account_name}</div>
          </div>
          <dl>
            <dt>Presales Lead</dt><dd>{o.owner.full_name}</dd>
            <dt>Manager</dt><dd>{o.manager?.full_name ?? "—"}</dd>
            <dt>Director</dt><dd>{o.director?.full_name ?? "—"}</dd>
          </dl>
          <footer>
            <b>v{o.current_version ?? "—"}</b>
            <FlagButton o={o} onChanged={onChanged} />
            <span className={`ai-chip ${o.ai_status}`}>{o.ai_status_label}</span>
            {o.has_critical_findings && <span className="badge st-changes_requested">Critical findings</span>}
          </footer>
        </Link>
      ))}
    </div>
  );
}

/** Dense table, used inside dashboard sections. */
export function OpportunityTable({ rows, showOwner = true, emptyText = "No opportunities yet." }:
  { rows: OpportunityListItem[]; showOwner?: boolean; showDirector?: boolean; emptyText?: string }) {
  const navigate = useNavigate();
  if (!rows.length) return <Empty title={emptyText} />;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Opportunity</th><th scope="col">Account</th><th scope="col">Status</th>
            {showOwner && <th scope="col">Presales Lead</th>}
            <th scope="col">Manager</th><th scope="col">Version</th><th scope="col">AI</th><th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="clickable" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) navigate(`/opportunities/${o.id}`); }}>
              <td><Link className="opp-title" to={`/opportunities/${o.id}`}>{o.title}</Link><div className="muted small">{o.opportunity_number}</div></td>
              <td>{o.account_name}</td>
              <td><StatusBadge status={o.status} label={o.status_label} /></td>
              {showOwner && <td>{o.owner.full_name}</td>}
              <td>{o.manager?.full_name ?? "—"}</td>
              <td className="num">v{o.current_version ?? "—"}</td>
              <td><span className={`ai-chip ${o.ai_status}`}>{o.ai_status_label}</span></td>
              <td className="muted small" title={o.updated_at}>{timeAgo(o.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
