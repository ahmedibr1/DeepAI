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

export const belongsTo = (o: OutputSpec, f: Finding) => (o.sources[f.analysis] ?? []).includes(f.type);

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
