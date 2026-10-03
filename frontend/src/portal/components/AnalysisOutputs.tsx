/* The outputs each AI analysis produces, laid out as numbered rows: number, titled tile, what it covers.
   Findings are grouped under an output by their type; anything unmapped falls under "Other findings". */
import { Icon } from "./Icon";

export interface OutputSpec {
  key: string; title: string; subtitle?: string; icon: string; tone: string; bullets: string[]; types: string[];
}

export const ANALYSIS_THEME: Record<string, string> = {
  early: "purple", technical: "blue", commercial: "green", final: "teal",
};

export const OUTPUT_SPECS: Record<string, OutputSpec[]> = {
  early: [
    { key: "questions", title: "Questions for Customer", icon: "message", tone: "blue", types: ["Question for Customer"],
      bullets: ["Clarifications on requirements", "Missing information", "Assumptions to be confirmed", "Dependencies and constraints"] },
    { key: "risks", title: "Risk Findings", subtitle: "Initial", icon: "warning", tone: "red", types: ["Risk Finding"],
      bullets: ["Early technical, commercial and contractual risks", "Impact assessment", "Key assumptions and uncertainties"] },
    { key: "vendors", title: "Proposed Internal / Subsidiaries / Vendors", icon: "users", tone: "green", types: ["Proposed Vendor"],
      bullets: ["Recommended delivery model", "Internal capabilities vs partners", "Potential partners / vendors per scope", "Justification for selection"] },
    { key: "solutions", title: "Proposed Solutions", subtitle: "Suggested on DeepDive", icon: "bulb", tone: "amber", types: ["Proposed Solution"],
      bullets: ["High-level solution approach", "Solution options and alternatives", "Alignment with customer requirements", "Initial architecture / technology direction"] },
  ],
  technical: [
    { key: "summary", title: "Executive Summary", subtitle: "Modification", icon: "doc", tone: "purple", types: ["Executive Summary"],
      bullets: ["Revised and refined summary", "Updated objectives and key talking points", "Aligned with the TP and Early Analysis findings"] },
    { key: "scope", title: "Scope Coverage & Gaps", icon: "target", tone: "green", types: ["Scope Gap"],
      bullets: ["Requirement-by-requirement coverage", "Gaps, missing items and assumptions", "Compliance with the RFP and customer needs"] },
    { key: "tech-risks", title: "Technical Risk Findings", subtitle: "with Mitigation", icon: "shieldCheck", tone: "red", types: ["Technical Risk"],
      bullets: ["Detailed technical risks", "Impact assessment", "Suggested mitigation actions", "Alternative approaches"] },
    { key: "value", title: "Value Propositions & References", icon: "star", tone: "amber", types: ["Value Proposition"],
      bullets: ["Key differentiators", "Relevant use cases and references", "Customer benefits and value messaging"] },
    { key: "capability", title: "Internal Capability Alignment", icon: "building", tone: "blue", types: ["Capability Alignment"],
      bullets: ["Match with solutions capabilities", "Subsidiaries / partners alignment", "Resource availability and readiness"] },
    { key: "tech-readiness", title: "Technical Submission Readiness", icon: "clipboard", tone: "purple",
      types: ["Tender Analyzer Finding", "Submission Readiness"],
      bullets: ["Completeness of the technical response", "Compliance with RFP requirements", "Pending items and recommendations"] },
  ],
  commercial: [
    { key: "benchmark", title: "Commercial Benchmarking", icon: "chart", tone: "green", types: ["Commercial Benchmarking"],
      bullets: ["Price comparison with market", "Competitiveness analysis", "Market insights and trends", "Commercial terms evaluation"] },
    { key: "fin-risks", title: "Financial Risk Findings", subtitle: "with Mitigation", icon: "shieldCheck", tone: "red",
      types: ["Commercial Risk", "Commercial Assumption"],
      bullets: ["Pricing and budget risks", "Payment terms and commercial assumptions", "Impact assessment", "Suggested mitigation actions"] },
    { key: "fin-readiness", title: "Commercial Submission Readiness", icon: "clipboard", tone: "purple",
      types: ["Pricing Consistency", "Tender Analyzer Finding"],
      bullets: ["CP and Quotation consistency", "Tender Analyzer commercial items", "Pending items and actions"] },
  ],
  final: [
    { key: "final-risks", title: "Final Risk Findings", subtitle: "with Mitigation", icon: "shieldCheck", tone: "red",
      types: ["Final Risk", "Submission Blocker"],
      bullets: ["Consolidated technical, commercial, legal and delivery risks", "Impact assessment",
                "Suggested mitigation actions", "Residual risks and recommendations"] },
    { key: "readiness", title: "Submission Readiness", icon: "clipboard", tone: "purple", types: ["Submission Readiness"],
      bullets: ["Final checklist (technical + commercial)", "Compliance with all requirements", "Pending items and actions",
                "Overall win readiness and probability view"] },
  ],
};

export const OTHER_OUTPUT: OutputSpec = {
  key: "other", title: "Other findings", subtitle: "Director comments and governance", icon: "review", tone: "grey",
  types: [], bullets: ["Review & Governance comments still to resolve"],
};

/** Which output of an analysis a finding belongs to. */
export const outputOf = (analysis: string, type: string) =>
  (OUTPUT_SPECS[analysis] ?? []).find((o) => o.types.includes(type))?.key ?? OTHER_OUTPUT.key;

export function AnalysisOutputs({ kind, title, status, counts, selected, onSelect }: {
  kind: string; title: string; status: string; counts: Record<string, number>;
  selected: string | null; onSelect: (key: string | null) => void;
}) {
  const specs = [...(OUTPUT_SPECS[kind] ?? []), ...(counts[OTHER_OUTPUT.key] ? [OTHER_OUTPUT] : [])];
  const generated = status === "completed" || status === "reanalysis_required";
  return (
    <section className={`outputs-board theme-${ANALYSIS_THEME[kind] ?? "purple"}`}>
      <h2 className="outputs-bar">Outputs from {title}</h2>
      {!generated && <p className="muted small outputs-note">Run the analysis to generate these outputs.</p>}
      <ol className="output-rows">
        {specs.map((o, i) => {
          const n = counts[o.key] ?? 0;
          const active = selected === o.key;
          return (
            <li key={o.key} className={`output-row tone-${o.tone}${active ? " active" : ""}${generated ? "" : " pending"}`}>
              <span className="output-num" aria-hidden="true">{i + 1}</span>
              <button type="button" className="output-tile" aria-pressed={active} disabled={!generated}
                onClick={() => onSelect(active ? null : o.key)}>
                <span className="output-icon"><Icon name={o.icon} /></span>
                <span className="output-title">
                  <b>{o.title}</b>
                  {o.subtitle && <span>({o.subtitle})</span>}
                  {generated && <span className="output-count">{n} {n === 1 ? "finding" : "findings"}</span>}
                </span>
              </button>
              <ul className="output-bullets">{o.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
