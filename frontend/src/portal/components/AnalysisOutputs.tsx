/* AI outputs as one grid of cards. Each output collects findings from the analyses that feed it, and is
   available once its source analysis has run; until then it says what is missing to enable it. */
import { Icon } from "./Icon";

type Finding = { id: string; analysis: string; type: string; severity: string; title: string; status: string };
type Analysis = { kind: string; title: string; status: string; missing: string[] };

export interface OutputSpec {
  key: string; title: string; description: string; icon: string; tone: string;
  /** The analysis that has to run for this output to be available. */
  primary: string;
  /** analysis kind → finding types it contributes to this output. */
  sources: Record<string, string[]>;
  /** How to summarise the findings: counts per severity with this noun, or a short list of titles. */
  noun?: string; list?: boolean;
}

export const OUTPUTS: OutputSpec[] = [
  { key: "questions", title: "Questions for Customer", icon: "message", tone: "purple", primary: "early",
    description: "Key clarifications and information needed from the customer.",
    sources: { early: ["Question for Customer"] }, noun: "Priority Questions" },
  { key: "summary", title: "Executive Summary", icon: "doc", tone: "purple", primary: "technical",
    description: "AI-generated summary of the opportunity, key highlights and recommendations.",
    sources: { technical: ["Executive Summary"] }, list: true },
  { key: "scope", title: "Scope Coverage & Gaps", icon: "target", tone: "red", primary: "technical",
    description: "Analysis of customer requirements against the available documents.",
    sources: { technical: ["Scope Gap", "Tender Analyzer Finding", "Submission Readiness"] }, noun: "Gaps" },
  { key: "risks", title: "Risk Findings", icon: "warning", tone: "red", primary: "early",
    description: "Identified technical, commercial and delivery risks.",
    sources: { early: ["Risk Finding"], technical: ["Technical Risk"], commercial: ["Commercial Risk", "Commercial Assumption"],
               final: ["Final Risk", "Submission Blocker"] }, noun: "Risks" },
  { key: "value", title: "Value Proposition & References", icon: "star", tone: "purple", primary: "technical",
    description: "Recommended differentiators, references and value propositions from company knowledge.",
    sources: { technical: ["Value Proposition"] }, list: true },
  { key: "capability", title: "Internal Capability Alignment", icon: "users", tone: "purple", primary: "early",
    description: "Match customer needs with solutions products, subsidiaries and partner capabilities.",
    sources: { early: ["Proposed Vendor", "Proposed Solution"], technical: ["Capability Alignment"] }, list: true },
  { key: "benchmark", title: "Commercial Benchmarking", icon: "dollar", tone: "purple", primary: "commercial",
    description: "Compare pricing with historical quotations and market intelligence.",
    sources: { commercial: ["Commercial Benchmarking", "Pricing Consistency", "Tender Analyzer Finding"] }, noun: "Findings" },
  { key: "readiness", title: "Submission Readiness", icon: "checkSquare", tone: "purple", primary: "final",
    description: "Final check for completeness, consistency and readiness.",
    sources: { final: ["Submission Readiness"] }, list: true },
];

export const belongsTo = (o: OutputSpec, f: { analysis: string; type: string }) => (o.sources[f.analysis] ?? []).includes(f.type);

const DONE = ["completed", "reanalysis_required"];
const SEVERITIES: [string, string][] = [["high", "High"], ["medium", "Medium"], ["low", "Low"]];

const joinAnd = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export function OutputCards({ analyses, findings, selected, onSelect }: {
  analyses: Analysis[]; findings: Finding[]; selected: string | null; onSelect: (key: string) => void;
}) {
  return (
    <div className="out-grid">
      {OUTPUTS.map((o, i) => {
        const primary = analyses.find((a) => a.kind === o.primary);
        const ran = Object.keys(o.sources).some((k) => DONE.includes(analyses.find((a) => a.kind === k)?.status ?? ""));
        const mine = findings.filter((f) => f.status === "open" && belongsTo(o, f));
        const state = ran ? "available" : primary?.status === "not_eligible" ? "locked" : "pending";
        return (
          <article key={o.key} className={`out-card ${state}${selected === o.key ? " selected" : ""}`}>
            <header>
              <span className="out-num">{i + 1}</span>
              <span className={`out-icon tone-${o.tone}`}><Icon name={o.icon} /></span>
            </header>
            <h3>{o.title}</h3>
            <p className="out-desc">{o.description}</p>
            {state === "available" && <>
              <span className="out-chip">Available{primary?.status === "reanalysis_required" ? " · re-analysis required" : ""}</span>
              {mine.length === 0 ? <p className="muted small">Nothing open — all findings were accepted or dismissed.</p>
                : o.list ? (
                  <ul className="out-list">
                    {mine.slice(0, 3).map((f) => <li key={f.id}><Icon name="check" />{f.title}</li>)}
                  </ul>
                ) : (
                  <ul className="out-stats">
                    {SEVERITIES.map(([sev, label]) => {
                      const n = mine.filter((f) => f.severity === sev).length;
                      return n ? <li key={sev} className={`sev-${sev}`}><b>{n}</b> {label} {o.noun}</li> : null;
                    })}
                  </ul>
                )}
              <button type="button" className="out-link" onClick={() => onSelect(o.key)}>
                View Details <Icon name="chevronRight" />
              </button>
            </>}
            {state === "pending" && (
              <div className="out-locked">
                <Icon name="spark" />
                <p>Run the {primary?.title ?? "analysis"} to generate this output.</p>
              </div>
            )}
            {state === "locked" && (
              <div className="out-locked">
                <Icon name="lock" />
                <p>
                  {primary?.missing.length
                    ? `Upload ${joinAnd(primary.missing)} in the next version to enable this analysis.`
                    : "Submit a DeepDive version to enable this analysis."}
                </p>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/** One-line verdict for an opportunity's AI work, used on the Overview and the AI Recommendations page. */
export function aiVerdict(analyses: Analysis[], findings: Finding[]): { tone: string; label: string } {
  const open = findings.filter((f) => f.status === "open");
  const done = analyses.filter((a) => DONE.includes(a.status));
  if (done.length === 0) {
    if (analyses.some((a) => a.status === "ready")) return { tone: "amber", label: "Ready to analyse" };
    return { tone: "muted", label: "Not started" };
  }
  if (open.some((f) => f.severity === "high")) return { tone: "red", label: "Action needed" };
  const final = analyses.find((a) => a.kind === "final");
  if (final?.status === "completed" && open.length === 0) return { tone: "ok", label: "Ready to submit" };
  if (final?.status === "completed") return { tone: "ok", label: "Ready with actions" };
  return { tone: "amber", label: "In progress" };
}

const ANALYSIS_SHORT: Record<string, string> = {
  not_eligible: "Waiting for documents", ready: "Ready to run", analyzing: "Analyzing",
  completed: "Completed", reanalysis_required: "Re-analysis required",
};

/** Compact AI status for one opportunity: the four analyses, the open findings per output and the verdict. */
export function AiSummary({ analyses, findings, onOpen }: {
  analyses: Analysis[]; findings: Finding[]; onOpen?: (output?: string) => void;
}) {
  const open = findings.filter((f) => f.status === "open");
  const verdict = aiVerdict(analyses, findings);
  return (
    <div className="ai-summary">
      <div className="ai-summary-head">
        <span className={`verdict tone-${verdict.tone}`}>{verdict.label}</span>
        <span className="muted small">
          {analyses.filter((a) => DONE.includes(a.status)).length} of {analyses.length} analyses · {open.length} open findings
        </span>
      </div>
      <ul className="ai-summary-analyses">
        {analyses.map((a) => (
          <li key={a.kind} className={`an-${a.status}`}>
            <span className="an-dot" aria-hidden="true" /><b>{a.title}</b>
            <span className="muted small">{ANALYSIS_SHORT[a.status] ?? a.status}</span>
          </li>
        ))}
      </ul>
      {open.length > 0 && (
        <ul className="ai-summary-outputs">
          {OUTPUTS.map((o, i) => {
            const mine = open.filter((f) => belongsTo(o, f));
            if (!mine.length) return null;
            const high = mine.filter((f) => f.severity === "high").length;
            return (
              <li key={o.key}>
                <button type="button" onClick={() => onOpen?.(o.key)} disabled={!onOpen}>
                  <span className="out-num">{i + 1}</span>{o.title}
                  <span className="count">{mine.length}{high ? <em> · {high} high</em> : null}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
