import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { DashboardCard, DashboardSummary, OpportunityListItem } from "../api/types";
import { PERM, useAuth } from "../auth/AuthContext";
import { AttentionList } from "../components/AttentionList";
import { OpportunityTable } from "../components/OpportunityTable";
import { Icon } from "../components/Icon";
import { Empty, ErrorAlert, PageHeader } from "../components/ui";
import { fmtDate } from "../lib/format";
import { TIER_LABELS, TIER_RULES } from "../lib/tier";
import { useAsync } from "../lib/useAsync";

/** Money cards are shown compactly so the card keeps one line. */
function formatCard(card: DashboardCard): string {
  if (card.format !== "compact") return String(card.value);
  const v = card.value;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

function cardLink(card: DashboardCard): string {
  const params = new URLSearchParams();
  Object.entries(card.filter ?? {}).forEach(([key, value]) =>
    Array.isArray(value) ? value.forEach((v) => params.append(key, v)) : params.set(key, value));
  return `/opportunities${params.toString() ? `?${params}` : ""}`;
}

const KPI_ICONS: Record<string, string> = {
  active: "briefcase", awaiting: "doc", ready_for_ai: "spark", attention: "warning",
  type_mix: "list", spread: "team", mine: "briefcase", not_submitted: "doc",
  changes: "review", comments: "review", ai: "spark",
};

/** Colour keys for the two legends, so the table colours are explained once. */
function Legends() {
  return (
    <div className="legends">
      <div className="legend">
        <h4>Customer Submission Date (Days Remaining)</h4>
        <ul>
          <li><span className="legend-dot dot-overdue" />Overdue</li>
          <li><span className="legend-dot dot-red" />≤ 3 days</li>
          <li><span className="legend-dot dot-orange" />4 – 7 days</li>
          <li><span className="legend-dot dot-yellow" />8 – 12 days</li>
          <li><span className="legend-dot dot-green" />&gt; 12 days</li>
        </ul>
      </div>
      <div className="legend">
        <h4>Opportunity Tier</h4>
        <ul>
          {TIER_RULES.map((t) => (
            <li key={t.tier} title={t.range}><span className={`legend-dot tier-dot-${t.tier}`} />{TIER_LABELS[t.tier]}
              <span className="tier-range">{t.range}</span></li>
          ))}
        </ul>
      </div>
      <div className="legend">
        <h4>Attention Count (Total)</h4>
        <ul>
          <li><span className="legend-dot dot-red" />≥ 5</li>
          <li><span className="legend-dot dot-orange" />3 – 4</li>
          <li><span className="legend-dot dot-yellow" />0 – 2</li>
        </ul>
      </div>
    </div>
  );
}

function Section({ title, lede, rows, empty }: { title: string; lede?: string; rows?: OpportunityListItem[]; empty: string }) {
  return (
    <section className="card panel">
      <div className="panel-head">
        <h2 className="section">{title} ({rows?.length ?? 0})</h2>
        {lede && <span className="muted small">{lede}</span>}
      </div>
      {rows && rows.length > 0 ? <OpportunityTable rows={rows} showOwner={false} /> : <Empty title={empty} />}
    </section>
  );
}

export function DashboardPage() {
  const { me, can } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.get<DashboardSummary>("/dashboard/summary"), []);
  const first = me?.full_name.split(" ")[0];
  const management = data?.kind === "management";

  return (
    <main className="content wide">
      <div className="dash-head">
        <PageHeader
          kicker={undefined}
          title={`Welcome, ${first}`}
          lede={management ? "Monitor all active opportunities, with risks and support needs highlighted for attention."
            : "What you need to work on, and where your opportunities stand."}
          actions={can(PERM.OPP_CREATE) && <Link className="btn primary" to="/opportunities/new">Create opportunity</Link>} />
        {(
          <div className="when">
            <b>{fmtDate(new Date().toISOString())}</b>
            Last updated {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>
      <ErrorAlert error={error} />
      {loading && !data && <p className="muted">Loading dashboard…</p>}

      {data && (
        <>
          {management && data.monitor && <MonitorKpis rows={data.monitor} entry={data.entry} />}
          {!management && <div className="stat-grid">
            {data.cards.map((card) => (
              <Link key={card.key} to={cardLink(card)}
                className={`stat kpi-${card.key}${card.tone ? ` tone-${card.tone}` : ""}`} aria-label={card.label}>
                <div className="kpi">
                  <div>
                    {card.segments ? (
                      <div className="segments">
                        {card.segments.map((seg) => (
                          <span key={seg.label} className="seg">
                            <b>{seg.value}</b>
                            <small>{seg.label}</small>
                          </span>
                        ))}
                      </div>
                    ) : <div className="v">{formatCard(card)}</div>}
                    {/* the pills already read as RFP / RFI / Non-RFP, so that card needs no caption */}
                    {!card.segments && <div className="l">{card.label}</div>}
                    {card.note && <div className="note">{card.note}</div>}
                  </div>
                  {/* the pills fill the card, so that one needs no icon */}
                  {!card.segments && <span className="kpi-icon"><Icon name={KPI_ICONS[card.key] ?? "briefcase"} /></span>}
                </div>
              </Link>
            ))}
          </div>}

          {management && data.entry && <EntryCriteriaBanner entry={data.entry} />}

          {management ? (
            <section className="card" style={{ background: "transparent", border: 0, boxShadow: "none" }}>
              <div className="monitor-head">
                <div>
                  <h2 className="section">Opportunity Attention Monitor ({data.monitor?.length ?? 0})</h2>
                  <span className="muted small">
                    Strategic and High: opportunities meeting the entry criteria. Medium: active opportunities below SAR 20M. Risks and support needs are highlighted for attention.
                  </span>
                </div>
                <Legends />
              </div>
              <AttentionList rows={data.monitor ?? []} portfolios={data.portfolios ?? []} onChanged={() => void reload()} />
            </section>
          ) : (
            <>
              <Section title="Needs completing" rows={data.to_complete}
                lede="Drafts and opportunities returned for changes — oldest first."
                empty="Nothing waiting on you." />
              <Section title="With management" rows={data.in_review}
                lede="Submitted, in review, or being analysed." empty="Nothing is with management right now." />
              <Section title="AI recommendations available" rows={data.ai_available}
                lede="Analysis completed — review the findings and required actions."
                empty="No analysis has been completed yet." />
            </>
          )}
        </>
      )}
    </main>
  );
}

/** The DeepDive entry criteria: the dashboard lists opportunities that meet at least one of them. */
/** The few numbers a director reads first, from the opportunities on the dashboard. */
function MonitorKpis({ rows, entry }: { rows: NonNullable<DashboardSummary["monitor"]>; entry?: DashboardSummary["entry"] }) {
  const total = rows.reduce((t, r) => t + (r.estimated_value || 0), 0);
  const overdue = rows.filter((r) => r.is_overdue_submission).length;
  const soon = rows.filter((r) => !r.is_overdue_submission && r.days_remaining != null && r.days_remaining <= 7).length;
  const attention = rows.filter((r) => r.attention_count > 0).length;
  const money = (v: number) => (v >= 1_000_000 ? `${Math.round(v / 100_000) / 10}M` : v.toLocaleString("en-US"));
  const kpis: { v: string | number; l: string; note?: string; tone?: string }[] = [
    { v: rows.length, l: "On the dashboard", note: entry ? `of ${entry.active} active opportunities` : undefined },
    { v: `SAR ${money(total)}`, l: "Total estimated value" },
    { v: overdue, l: "Submission overdue", tone: overdue ? "bad" : undefined },
    { v: soon, l: "Submission within 7 days", tone: soon ? "warn" : undefined },
    { v: attention, l: "Need attention", note: "high risks or support needs", tone: attention ? "warn" : undefined },
  ];
  return (
    <div className="kpi-row">
      {kpis.map((k) => (
        <div key={k.l} className={`kpi-tile${k.tone ? ` ${k.tone}` : ""}`}>
          <b>{k.v}</b><span>{k.l}</span>{k.note && <small>{k.note}</small>}
        </div>
      ))}
    </div>
  );
}

/** One line: which opportunities the dashboard shows, and how many meet each criterion. */
function EntryCriteriaBanner({ entry }: { entry: NonNullable<DashboardSummary["entry"]> }) {
  const million = Math.round(entry.min_value / 1_000_000);
  const items: [string, number][] = [
    [`≥ SAR ${million}M value`, entry.value], ["Previous delivered projects", entry.previous_projects],
    ["Flagged strategic", entry.strategic],
  ];
  return (
    <section className="entry-strip" aria-label="Entry criteria">
      <span className="entry-strip-label">Entry criteria</span>
      {items.map(([label, n]) => (
        <span key={label} className="entry-strip-item"><Icon name="check" /> {label} <b>{n}</b></span>
      ))}
      <Link className="entry-strip-link" to="/opportunities?active=1">See all {entry.active} active ›</Link>
    </section>
  );
}
