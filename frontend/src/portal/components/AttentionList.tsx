/* Opportunity Attention Monitor (management dashboard).
 *
 * Read-only: every active opportunity in one table, ordered by customer submission date. The left
 * chevron expands the row into Scope, Risks and Support Needed; the arrow on the right opens the
 * full opportunity page.
 */
import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { MonitorRow } from "../api/types";
import { fmtDate } from "../lib/format";
import { Empty, ErrorAlert, Modal, useToast } from "./ui";
import { Icon } from "./Icon";
import { MeetingBrief } from "./MeetingBrief";

const nf = new Intl.NumberFormat("en-US");
// Every qualifying opportunity on one page: the entry criteria already keep the list short.
const PAGE_SIZE = Number.MAX_SAFE_INTEGER;
const FAR_FUTURE = 8640000000000;

const SORTS = [
  { key: "submission_asc", label: "Submission Date — Nearest first" },
  { key: "submission_desc", label: "Submission Date — Furthest first" },
  { key: "received_asc", label: "Presales Received — Oldest first" },
  { key: "received_desc", label: "Presales Received — Newest first" },
  { key: "attention_desc", label: "Attention — Highest first" },
  { key: "attention_asc", label: "Attention — Lowest first" },
  { key: "value_desc", label: "Estimated Value — Highest first" },
  { key: "value_asc", label: "Estimated Value — Lowest first" },
] as const;
type SortKey = typeof SORTS[number]["key"];

const time = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/** Sorting works on real dates and numbers; rows without a value always go last. */
function sortRows(rows: MonitorRow[], key: SortKey): MonitorRow[] {
  const out = [...rows];
  const byDate = (r: MonitorRow, field: "submission_date" | "presales_received", desc: boolean) => {
    const t = time(r[field]);
    return Number.isNaN(t) ? FAR_FUTURE : desc ? -t : t;   // undated last in both directions
  };
  switch (key) {
    case "submission_asc":     // overdue, then nearest upcoming, then undated
      return out.sort((a, b) => byDate(a, "submission_date", false) - byDate(b, "submission_date", false));
    case "submission_desc":
      return out.sort((a, b) => byDate(a, "submission_date", true) - byDate(b, "submission_date", true));
    case "received_asc":
      return out.sort((a, b) => byDate(a, "presales_received", false) - byDate(b, "presales_received", false));
    case "received_desc":
      return out.sort((a, b) => byDate(a, "presales_received", true) - byDate(b, "presales_received", true));
    case "attention_desc":
      return out.sort((a, b) => b.attention_count - a.attention_count);
    case "attention_asc":
      return out.sort((a, b) => a.attention_count - b.attention_count);
    case "value_desc":
      return out.sort((a, b) => b.estimated_value - a.estimated_value);
    case "value_asc":
      return out.sort((a, b) => a.estimated_value - b.estimated_value);
    default:
      return out;
  }
}

/** Days remaining before the customer submission date drives the colour. */
function submissionTone(row: MonitorRow): string {
  if (row.is_overdue_submission) return "overdue";
  const days = row.days_remaining;
  if (days === null) return "none";
  if (days <= 3) return "red";
  if (days <= 7) return "orange";
  if (days <= 12) return "yellow";
  return "green";
}

const attentionTone = (count: number) => (count >= 5 ? "red" : count >= 3 ? "orange" : "yellow");

function attentionType(row: MonitorRow): string {
  if (row.risk_count && row.support_count) return "Risk / Support Needed";
  if (row.risk_count) return "Risk";
  if (row.support_count) return "Support Needed";
  return "—";
}

/* Scope of work as the Presales Lead wrote it: "1- MS :" starts a section, "1.1 …" lines are its items, and a
   section like "2- Licenses (Intersystems, Cisco, …)" lists its names as chips. Each line keeps its own direction,
   so Arabic and English lines both read correctly. */
type ScopeSection = { title: string; items: string[]; names: string[] };
function parseScope(text: string): ScopeSection[] {
  const out: ScopeSection[] = [];
  const top = /^(\d+)\s*[-–.)]\s*(?!\d)(.*)$/;          // "1- MS :" but not "1.1 …"
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(top);
    if (m || !out.length) {
      let title = (m ? m[2] : line).replace(/[:：]\s*$/, "").trim();
      let names: string[] = [];
      const list = title.match(/^(.*?)\s*\(([^()]*,[^()]*)\)\.?\s*$/);   // "Licenses (a, b, c)."
      if (list) {
        title = list[1].trim();
        names = list[2].split(/\s*,\s*/).map((x) => x.replace(/\\/g, " / ").trim()).filter(Boolean);
      }
      out.push({ title: title || line, items: [], names });
    } else {
      out[out.length - 1].items.push(line.replace(/^[-•*]\s*/, ""));
    }
  }
  return out;
}

function ScopeView({ text }: { text: string }) {
  const sections = parseScope(text);
  if (!sections.length) return <p className="scope muted">No scope of work recorded yet.</p>;
  return (
    <ol className="scope-list">
      {sections.map((s, i) => (
        <li key={i}>
          <div className="scope-title" dir="auto">{s.title}</div>
          {s.items.length > 0 && (
            <ul className="scope-items">{s.items.map((it, k) => <li key={k} dir="auto">{it}</li>)}</ul>
          )}
          {s.names.length > 0 && (
            <div className="scope-names">{s.names.map((n) => <span className="soft-chip" key={n}>{n}</span>)}</div>
          )}
        </li>
      ))}
    </ol>
  );
}

function ExpandedRow({ row }: { row: MonitorRow }) {
  return (
    <tr className="monitor-detail">
      <td colSpan={14}>
        <div className="monitor-detail-grid">
          <section className="detail-card">
            <h4><span className="detail-icon"><Icon name="target" /></span> Scope</h4>
            <ScopeView text={row.scope ?? ""} />
            <div className="chip-row">
              <span className="chip-label"><Icon name="users" /> Internal:</span>
              {row.internal.length ? row.internal.map((name) => <span className="soft-chip" key={name}>{name}</span>)
                : <span className="muted small">—</span>}
            </div>
            <div className="chip-row">
              <span className="chip-label"><Icon name="shield" /> Partner &amp; Vendor:</span>
              {row.vendors.length ? row.vendors.map((name) => <span className="soft-chip" key={name}>{name}</span>)
                : <span className="muted small">—</span>}
            </div>
          </section>

          <section className="detail-card">
            <h4><span className="detail-icon"><Icon name="warning" /></span> Risks ({row.risk_count})</h4>
            {row.risks.length === 0 ? <p className="muted small">No high-impact risks.</p> : (
              <ul className="monitor-items">
                {row.risks.map((r, i) => (
                  <li key={i}>
                    <span className="item-title">{r.risk}</span>
                    <div className="item-head">
                      <span className="chip">{r.category}</span>
                      <span className="chip high">High</span>
                    </div>
                    {r.mitigation && <div className="muted small">Mitigation: {r.mitigation}</div>}
                    {r.due_date && <div className="muted small">{fmtDate(r.due_date)}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="detail-card">
            <h4><span className="detail-icon"><Icon name="handshake" /></span> Support Needed ({row.support_count})</h4>
            {row.support.length === 0 ? <p className="muted small">No high-priority support needs.</p> : (
              <ul className="monitor-items">
                {row.support.map((s, i) => (
                  <li key={i}>
                    <div className="item-head spread">
                      <span className="item-title">{s.need}</span>
                      <span className="chip high">High</span>
                    </div>
                    {s.from && <div className="muted small">from {s.from}</div>}
                    {s.due_date && <div className="muted small">{fmtDate(s.due_date)}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </td>
    </tr>
  );
}

export function AttentionList({ rows, portfolios = [], onChanged }:
  { rows: MonitorRow[]; portfolios?: { id: string; name: string }[]; onChanged?: () => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortKey>("submission_asc");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // The menu is drawn at the button's screen position, so the table's scroll box cannot clip it.
  const [menuAt, setMenuAt] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const [archiving, setArchiving] = useState<MonitorRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();
  const toast = useToast();

  const filtered = useMemo(() => sortRows(rows.filter((r) => {
    const text = `${r.title} ${r.account_name} ${r.opportunity_number}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (!portfolio || r.portfolio === portfolio);
  }), sort), [rows, query, portfolio, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const archive = async () => {
    if (!archiving) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/opportunities/${archiving.id}/archive`);
      toast(`${archiving.opportunity_number} archived.`);
      setArchiving(null);
      onChanged?.();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  // Print / save as PDF: one A4 landscape page, scaled down when the list is long.
  const printBrief = () => {
    const el = document.querySelector<HTMLElement>(".meeting-brief");
    if (el) {
      el.style.zoom = "1"; el.style.width = "";
      el.classList.add("measure");
      const pageH = (190 * 96) / 25.4;          // A4 landscape height inside 10 mm margins
      const h = el.scrollHeight;
      el.classList.remove("measure");
      const zoom = h > pageH ? Math.floor((pageH / h) * 1000) / 1000 : 1;
      el.style.zoom = String(zoom);
      el.style.width = `${277 / zoom}mm`;            // still fills the page width once scaled
    }
    window.print();
  };

  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <section className="card monitor">
      <div className="monitor-controls">
        <div className="monitor-search">
          <Icon name="search" />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Search opportunities, account, or OP number..." aria-label="Search opportunities" />
        </div>
        <label className="control-pill">
          <select value={portfolio} onChange={(e) => { setPortfolio(e.target.value); setPage(1); }} aria-label="Portfolio">
            <option value="">All Portfolios</option>
            {portfolios.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </label>
        <label className="control-pill">
          <span className="muted">Sort by:</span>
          <select value={sort} onChange={(e) => { setSort(e.target.value as SortKey); setPage(1); }} aria-label="Sort by">
            {SORTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <button type="button" className="btn ghost small print-btn" disabled={!filtered.length} onClick={printBrief}
          title="One-page brief of the opportunities listed here — choose “Save as PDF” to keep it">
          <Icon name="download" /> Print / PDF
        </button>
        <MeetingBrief rows={filtered} />
      </div>

      {filtered.length === 0 ? <Empty title="No active opportunities" /> : (
        <>
          <div className="table-wrap">
            <table className="data monitor-table">
              <thead>
                <tr>
                  <th scope="col" className="c-num">#</th>
                  <th scope="col">Opportunity Number</th>
                  <th scope="col">Account</th>
                  <th scope="col">Opportunity Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Portfolio</th>
                  <th scope="col">Vertical</th>
                  <th scope="col" className="c-right">Estimated Solution Value<br /><span className="sub-head">(SAR)</span></th>
                  <th scope="col" className="c-center">Presales Received Date<br /><span className="sub-head">(Days)</span></th>
                  <th scope="col" className="c-center">Customer Submission Date<br /><span className="sub-head">(Days Remaining)</span></th>
                  <th scope="col" className="c-center">Attention</th>
                  <th scope="col">Attention (Why)</th>
                  <th scope="col">Presales Lead</th>
                  <th scope="col"><span className="vh">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, index) => {
                  const expanded = open.has(row.id);
                  const tone = submissionTone(row);
                  return (
                    <Fragment key={row.id}>
                      <tr className={expanded ? "expanded" : ""}>
                        <td className="c-num"><div className="num-cell">
                          <button type="button" className="expander" aria-expanded={expanded}
                            aria-label={`${expanded ? "Collapse" : "Expand"} ${row.title}`} onClick={() => toggle(row.id)}>
                            <Icon name={expanded ? "chevronDown" : "chevronRight"} />
                          </button>
                          <span className="muted">{(current - 1) * PAGE_SIZE + index + 1}</span>
                        </div></td>
                        <td className="num">
                          <Link className="op-link" to={`/opportunities/${row.id}`}>{row.opportunity_number}</Link>
                          {row.criteria && (
                            <span className="crit-chips">
                              {row.criteria.value && <span title="Opportunity value of SAR 20M or more">20M+</span>}
                              {row.criteria.previous_projects && <span title="Previous delivered projects">Prev. projects</span>}
                              {row.criteria.strategic && <span title="Flagged strategic opportunity">⚑ Strategic</span>}
                            </span>
                          )}
                          <Link className="slides-link" to={`/opportunities/${row.id}/slides`} title="View the DeepDive slides">
                            ▶ Slides
                          </Link>

                        </td>
                        <td className="wrap" dir="auto">{row.account_name}</td>
                        <td className="wrap wide" dir="auto">
                          {row.title}
                          {/* shown on phones, where the account column is hidden */}
                          <span className="sub-line">{row.opportunity_number} · {row.account_name}</span>
                        </td>
                        <td>{row.opportunity_type ?? "—"}</td>
                        <td className="truncate" title={row.portfolio ?? ""}>{row.portfolio ?? "—"}</td>
                        <td className="truncate">{row.vertical ?? "—"}</td>
                        <td className="c-right num">{row.estimated_value ? nf.format(row.estimated_value) : "—"}</td>
                        <td className="c-center">
                          {row.presales_received ? (
                            <>
                              <div>{fmtDate(row.presales_received)}</div>
                              <div className="muted small">
                                {row.days_with_presales !== null ? `(${row.days_with_presales} days)` : ""}
                              </div>
                            </>
                          ) : "—"}
                        </td>
                        <td className="c-center">
                          {row.submission_date ? (
                            <span className={`date-pill pill-${tone}`}>
                              <b>{fmtDate(row.submission_date)}</b>
                              <span>{row.is_overdue_submission ? "Overdue"
                                : `${row.days_remaining} day${row.days_remaining === 1 ? "" : "s"}`}</span>
                            </span>
                          ) : "—"}
                        </td>
                        <td className="c-center">
                          <span className={`attention-count att-${attentionTone(row.attention_count)}`}>{row.attention_count}</span>
                        </td>
                        <td className="small">{attentionType(row)}</td>
                        <td className="wrap" dir="auto">{row.owner ?? "—"}</td>
                        <td className="cell-menu">
                          <button type="button" className="dots" aria-haspopup="menu"
                            aria-expanded={menuFor === row.id} aria-label={`Actions for ${row.title}`}
                            onClick={(e) => {
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const height = 140;          // three items; flip upwards near the bottom of the screen
                              const below = r.bottom + 6;
                              setMenuAt({
                                top: below + height > window.innerHeight ? Math.max(12, r.top - height) : below,
                                right: Math.max(12, window.innerWidth - r.right),
                              });
                              setMenuFor(menuFor === row.id ? null : row.id);
                            }}>
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                              <circle cx="12" cy="5.5" r="1.9" fill="currentColor" />
                              <circle cx="12" cy="12" r="1.9" fill="currentColor" />
                              <circle cx="12" cy="18.5" r="1.9" fill="currentColor" />
                            </svg>
                          </button>
                          {menuFor === row.id && (
                            <>
                              <button type="button" className="menu-scrim" aria-label="Close menu" onClick={() => setMenuFor(null)} />
                              <div className="row-menu" role="menu" style={{ top: menuAt.top, right: menuAt.right }}>
                                <button type="button" role="menuitem"
                                  onClick={() => { setMenuFor(null); navigate(`/opportunities/${row.id}/deepdive`); }}>
                                  Go to Latest DeepDive
                                </button>
                                <button type="button" role="menuitem"
                                  onClick={() => { setMenuFor(null); navigate(`/opportunities/${row.id}/slides`); }}>
                                  View Slides
                                </button>
                                <button type="button" role="menuitem"
                                  onClick={() => { setMenuFor(null); setError(null); setArchiving(row); }}>
                                  Archive
                                </button>
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                      {expanded && <ExpandedRow row={row} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {archiving && (
            <Modal title="Archive Opportunity?" onClose={() => setArchiving(null)} footer={<>
              <button className="btn ghost" onClick={() => setArchiving(null)}>Cancel</button>
              <button className="btn danger" disabled={busy} onClick={() => void archive()}>
                {busy ? "Archiving…" : "Archive Opportunity"}
              </button>
            </>}>
              <ErrorAlert error={error} />
              <p>Are you sure you want to archive this opportunity?</p>
              <dl className="kv">
                <dt>Opportunity Number</dt><dd>{archiving.opportunity_number}</dd>
                <dt>Opportunity Name</dt><dd>{archiving.title}</dd>
                <dt>Account</dt><dd>{archiving.account_name}</dd>
              </dl>
              {!archiving.is_overdue_submission && archiving.submission_date && (
                <p className="alert warn" style={{ marginTop: 12 }}>
                  Customer submission date has not been reached yet.
                </p>
              )}
              <p className="muted small">
                Nothing is deleted: the DeepDive, documents, versions, risks, support needs and AI history are kept,
                and the opportunity moves to Archived Opportunities.
              </p>
            </Modal>
          )}

          <div className="monitor-footer">
            <span className="muted small">Showing {visible.length} of {filtered.length} opportunities</span>
            {pages > 1 && (
              <nav className="pagination" aria-label="Monitor pages">
                <button type="button" onClick={() => setPage(current - 1)} disabled={current === 1} aria-label="Previous page">‹</button>
                {Array.from({ length: pages }, (_, i) => (
                  <button type="button" key={i} className={current === i + 1 ? "on" : ""} onClick={() => setPage(i + 1)}
                    aria-current={current === i + 1 ? "page" : undefined}>{i + 1}</button>
                ))}
                <button type="button" onClick={() => setPage(current + 1)} disabled={current === pages} aria-label="Next page">›</button>
              </nav>
            )}
          </div>
        </>
      )}
    </section>
  );
}
