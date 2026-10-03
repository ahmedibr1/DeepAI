/* Opportunity workspace: document snapshot, AI eligibility, analyses, accepted tracker and readiness.
   Eligibility is derived from the reviewed DeepDive version and the documents inside it — never chosen by hand. */

export const DOC_GROUPS: { key: string; label: string; categories: string[] }[] = [
  { key: "customer", label: "Customer Documents", categories: ["rfp", "rfq", "rfi", "sow", "clarification", "customer_other"] },
  { key: "tp", label: "Technical Proposal (TP)", categories: ["tp"] },
  { key: "cp", label: "Commercial Proposal (CP)", categories: ["cp"] },
  { key: "ta", label: "Tender Analyzer (TA)", categories: ["ta"] },
  { key: "quotation", label: "Quotation", categories: ["quotation"] },
  { key: "other", label: "Supporting documents", categories: ["other"] },
];

export const DOC_CATEGORIES: { value: string; label: string; group: string }[] = [
  { value: "rfp", label: "RFP", group: "customer" },
  { value: "rfq", label: "RFQ", group: "customer" },
  { value: "rfi", label: "RFI", group: "customer" },
  { value: "sow", label: "Scope of Work (SoW)", group: "customer" },
  { value: "clarification", label: "Customer clarification", group: "customer" },
  { value: "customer_other", label: "Other customer document", group: "customer" },
  { value: "tp", label: "Technical Proposal (TP)", group: "tp" },
  { value: "cp", label: "Commercial Proposal (CP)", group: "cp" },
  { value: "ta", label: "Tender Analyzer (TA)", group: "ta" },
  { value: "quotation", label: "Quotation", group: "quotation" },
  { value: "other", label: "Supporting document", group: "other" },
];

export const ANALYSES = [
  { kind: "early", title: "Early Analysis", blurb: "Understand the opportunity and the customer's requirements.",
    requires: ["deepdive", "customer"],
    outputs: ["Questions for Customer", "Risk Findings (Initial)", "Proposed Internal / Subsidiaries / Vendors", "Proposed Solutions"] },
  { kind: "technical", title: "Technical Analysis", blurb: "Technical coverage, gaps and submission readiness.",
    requires: ["deepdive", "customer", "tp"], optional: ["ta"],
    outputs: ["Executive Summary (Modification)", "Scope Coverage & Gaps", "Technical Risk Findings with Mitigation",
              "Value Propositions & References", "Internal Capability Alignment", "Technical Submission Readiness"] },
  { kind: "commercial", title: "Financial Analysis", blurb: "Pricing consistency, financial risks and benchmarking.",
    requires: ["deepdive", "customer", "cp"], optional: ["ta"],
    outputs: ["Commercial Benchmarking", "Financial Risk Findings with Mitigation", "Commercial Submission Readiness"] },
  { kind: "final", title: "Final Review", blurb: "Executive assessment and submission readiness.",
    requires: ["deepdive", "customer", "tp", "cp", "ta"],
    outputs: ["Final Risk Findings with Mitigation", "Submission Readiness"] },
];

const REQUIREMENT_LABEL: Record<string, string> = {
  deepdive: "reviewed DeepDive", customer: "Customer Documents", tp: "Technical Proposal (TP)",
  cp: "Commercial Proposal (CP)", ta: "Tender Analyzer (TA)",
};

export interface DocSnapshot { group: string; label: string; version: string | null; files: number }

/** What the reviewed version holds, in the shape the UI shows. */
export function snapshot(docs: { category: string; doc_version: number }[]): DocSnapshot[] {
  return DOC_GROUPS.map((g) => {
    const mine = docs.filter((d) => g.categories.includes(d.category));
    const version = mine.length ? `v${Math.max(...mine.map((d) => d.doc_version))}` : null;
    return { group: g.key, label: g.label, version, files: mine.length };
  });
}

export interface Analysis {
  kind: string; title: string; blurb: string; status: string; reason: string;
  outputs: string[]; missing: string[];
  inputs: { label: string; optional: boolean; available: boolean; version: string | null }[];
  ran_on?: { version: number; docs: string } | null;
}

/** Status of every analysis, read from the reviewed version. Technical and Commercial never block each other. */
export function eligibility(
  { reviewed, docs, runs }: {
    reviewed: { version_number: number } | null;
    docs: { category: string; doc_version: number }[];
    runs: Record<string, { version_number: number; inputs: string; status: string }>;
  },
): Analysis[] {
  const snap = snapshot(docs);
  const has = (group: string) => snap.some((s) => s.group === group && s.files > 0);

  return ANALYSES.map(({ kind, title, blurb, requires, optional = [], outputs: outs }) => {
    const missing = requires.filter((r) => (r === "deepdive" ? !reviewed : !has(r))).map((r) => REQUIREMENT_LABEL[r]);
    const inputs = [...requires.map((r) => ({ r, optional: false })), ...optional.map((r) => ({ r, optional: true }))]
      .map(({ r, optional: opt }) => ({
        label: r === "deepdive" ? "DeepDive" : REQUIREMENT_LABEL[r], optional: opt,
        available: r === "deepdive" ? !!reviewed : has(r),
        version: r === "deepdive" ? (reviewed ? `v${reviewed.version_number}` : null) : snap.find((x) => x.group === r)?.version ?? null,
      }));
    const outputs = outs;

    const run = runs[kind];
    if (run && run.status === "analyzing") {
      return { kind, title, blurb, outputs, inputs, missing: [], status: "analyzing", reason: "Analysis in progress." };
    }
    if (missing.length) {
      return {
        kind, title, blurb, outputs, inputs, missing,
        status: "not_eligible",
        reason: `Waiting for ${missing.join(", ")}`,
      };
    }
    if (run && run.status === "completed") {
      const sameVersion = run.version_number === (reviewed?.version_number ?? 0);
      const sameInputs = run.inputs === analysisInputs(kind, docs);
      if (sameVersion && sameInputs) {
        return { kind, title, blurb, outputs, inputs, missing: [], status: "completed",
                 reason: `Up to date with DeepDive v${run.version_number}`,
                 ran_on: { version: run.version_number, docs: run.inputs } };
      }
      return { kind, title, blurb, outputs, inputs, missing: [], status: "reanalysis_required",
               reason: sameInputs ? `New reviewed version: DeepDive v${reviewed?.version_number}` : "New document version detected",
               ran_on: { version: run.version_number, docs: run.inputs } };
    }
    return { kind, title, blurb, outputs, inputs, missing: [], status: "ready", reason: "All required inputs are available." };
  });
}

export const analysisInputs = (kind: string, docs: { category: string; doc_version: number }[]) => {
  const a = ANALYSES.find((x) => x.kind === kind);
  // Optional documents count too: uploading a new TA version marks the analysis for re-analysis.
  return [...(a?.requires ?? []), ...(a?.optional ?? [])].filter((r) => r !== "deepdive")
    .map((r) => `${r}:${snapshot(docs).find((s) => s.group === r)?.version ?? "-"}`).join(" ");
};

export const STATUS_LABEL: Record<string, string> = {
  not_eligible: "Not Eligible", ready: "Ready for AI", analyzing: "Analyzing",
  completed: "Completed", reanalysis_required: "Re-analysis Required",
};
