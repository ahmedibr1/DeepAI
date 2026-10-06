/* One-page meeting brief of the Opportunity Attention Monitor, for printing or saving as PDF (A4 landscape).
   It is rendered outside the app and shown only when printing, so the page prints as a clean single sheet. */
import { createPortal } from "react-dom";
import type { MonitorRow } from "../api/types";
import { fmtDate } from "../lib/format";
import { TIER_LABELS, tierOf } from "../lib/tier";

const nf = new Intl.NumberFormat("en-US");
const MAX_ITEMS = 2;              // per opportunity, so the brief stays on one page

function days(row: MonitorRow) {
  if (row.days_remaining == null) return null;
  if (row.days_remaining < 0) return { text: `${-row.days_remaining} day${row.days_remaining === -1 ? "" : "s"} overdue`, tone: "late" };
  if (row.days_remaining === 0) return { text: "Due today", tone: "late" };
  return { text: `${row.days_remaining} day${row.days_remaining === 1 ? "" : "s"} left`, tone: row.days_remaining <= 7 ? "soon" : "ok" };
}

function Items({ items, empty }: { items: { text: string; meta: string }[]; empty: string }) {
  if (!items.length) return <span className="mb-none">{empty}</span>;
  return (
    <ul>
      {items.slice(0, MAX_ITEMS).map((it, i) => (
        <li key={i}><span dir="auto">{it.text}</span>{it.meta && <em> — {it.meta}</em>}</li>
      ))}
      {items.length > MAX_ITEMS && <li className="mb-more">+{items.length - MAX_ITEMS} more</li>}
    </ul>
  );
}

export function MeetingBrief({ rows }: { rows: MonitorRow[] }) {
  const total = rows.reduce((s, r) => s + (r.estimated_value || 0), 0);
  const late = rows.filter((r) => r.is_overdue_submission).length;
  const attention = rows.reduce((s, r) => s + r.attention_count, 0);
  const today = new Date();
  const meta = (owner?: string | null, date?: string | null) => [owner, date ? fmtDate(date) : null].filter(Boolean).join(", ");

  return createPortal(
    <div className="meeting-brief" aria-hidden="true">
      <header className="mb-head">
        <div>
          <div className="mb-kicker">DeepAI · Presales</div>
          <h1>Opportunity Attention Monitor</h1>
          <p>Active opportunities meeting the entry criteria: ≥ SAR 20M value, previous delivered projects, or flagged strategic.</p>
        </div>
        <div className="mb-date">{today.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>
      </header>

      <div className="mb-stats">
        <div><b>{rows.length}</b><span>Opportunities</span></div>
        <div><b>SAR {nf.format(total)}</b><span>Total estimated value</span></div>
        <div className={late ? "late" : ""}><b>{late}</b><span>Submission overdue</span></div>
        <div><b>{attention}</b><span>High risks &amp; support needs</span></div>
      </div>

      <table className="mb-table">
        <colgroup>
          <col style={{ width: "3%" }} /><col style={{ width: "24%" }} /><col style={{ width: "10%" }} />
          <col style={{ width: "11%" }} /><col style={{ width: "10%" }} /><col style={{ width: "21%" }} /><col style={{ width: "21%" }} />
        </colgroup>
        <thead>
          <tr><th>#</th><th>Opportunity</th><th className="r">Value (SAR)</th><th>Customer submission</th>
            <th>Presales Lead</th><th>High risks</th><th>Support needed</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const d = days(r);
            return (
              <tr key={r.id}>
                <td className="mb-n">{i + 1}</td>
                <td>
                  <div className="mb-num">{r.opportunity_number}
                    {r.criteria && <span className="mb-crit">
                      {r.criteria.value && <i>20M+</i>}{r.criteria.previous_projects && <i>Prev. projects</i>}{r.criteria.strategic && <i>Strategic</i>}
                    </span>}
                  </div>
                  <div className="mb-title" dir="auto">{r.title}</div>
                  <div className="mb-acc" dir="auto">{r.account_name}</div>
                  <div className="mb-facts">
                    <span><b>PS</b> {r.ps_duration ?? "—"}</span><span><b>MS</b> {r.ms_duration ?? "—"}</span>
                    <span><b>Competition</b> <bdi>{r.competitors.length ? r.competitors.join(", ") : "—"}</bdi></span>
                  </div>
                </td>
                <td className="r mb-val">{r.estimated_value ? nf.format(r.estimated_value) : "—"}
                  {tierOf(r.estimated_value) && <div><span className={`tier-chip tier-${tierOf(r.estimated_value)}`}>{TIER_LABELS[tierOf(r.estimated_value)!]}</span></div>}
                </td>
                <td>
                  <div className="mb-sub">{r.submission_date ? fmtDate(r.submission_date) : "—"}</div>
                  {d && <span className={`mb-days ${d.tone}`}>{d.text}</span>}
                </td>
                <td dir="auto">{r.owner ?? "—"}</td>
                <td><Items empty="None recorded"
                  items={r.risks.map((x) => ({ text: x.risk, meta: meta(x.owner, x.due_date) }))} /></td>
                <td><Items empty="None recorded"
                  items={r.support.map((x) => ({ text: x.need, meta: meta(x.from, x.due_date) }))} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <footer className="mb-foot">
        <span>High-impact risks and high-priority support needs from each opportunity’s latest DeepDive.</span>
        <span>Internal</span>
      </footer>
    </div>,
    document.body,
  );
}
