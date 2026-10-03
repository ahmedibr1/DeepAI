/* Browser version of the AI engine for the demo: the same shape of work as the backend
   (chunk with provenance → analyse → check the grounding → store an immutable run), using the
   rule-based analyst rather than a model. It never invents anything: every finding cites a chunk. */

export interface DemoChunk {
  id: string; source_kind: "document" | "deepdive" | "review"; document_name: string;
  location_label: string; text: string; field_path?: string | null;
}

const TOPICS: [string, RegExp, string, string][] = [
  ["sla", /\bsla\b|service level|availability|uptime|99\./i, "Service levels", "high"],
  ["integration", /integrat|interface|\bapi\b|opc-ua|scada/i, "Integration", "high"],
  ["residency", /residency|in-?kingdom|shall remain|sovereign/i, "Data residency and compliance", "critical"],
  ["security", /security|cyber|iso 27|penetration|encryption/i, "Cybersecurity", "medium"],
  ["schedule", /milestone|delivery date|penalt|schedule|deadline/i, "Schedule and penalties", "medium"],
  ["pricing", /budget|ceiling|price|payment terms|bill of quantit/i, "Commercial", "high"],
  ["support", /support|maintenance|warranty|managed service/i, "Support and managed services", "medium"],
];

const HEADING = /^\s*((?:\d+\.){0,4}\d+)\s+(\S.{0,120})$/;

/** Splits plain text into blocks that start at each numbered heading, keeping the section for citations. */
export function chunkText(text: string, documentName: string, idFor: (n: number) => string): DemoChunk[] {
  const chunks: DemoChunk[] = [];
  const section: string[] = [];
  let current: string[] = [];
  let path: string | null = null;
  const flush = () => {
    const body = current.join("\n").trim();
    if (body) {
      chunks.push({
        id: idFor(chunks.length), source_kind: "document", document_name: documentName,
        location_label: `${documentName}${path ? ` — Section ${path}` : ""}`, text: body,
      });
    }
    current = [];
  };
  for (const line of text.split("\n")) {
    const match = HEADING.exec(line);
    if (match && line.length <= 160) {
      flush();
      const depth = match[1].split(".").length;
      section.length = Math.max(0, depth - 1);
      section.push(`${match[1]} ${match[2].trim()}`);
      path = section.join(" › ");
    }
    if (line.trim()) current.push(line.trimEnd());
  }
  flush();
  return chunks;
}

const area = (status: string, summary: string, evidence = "", citations: unknown[] = []) =>
  ({ status, summary, evidence, citations });

export function analyse(chunks: DemoChunk[]) {
  const documents = chunks.filter((c) => c.source_kind === "document");
  const deepdive = chunks.filter((c) => c.source_kind === "deepdive").map((c) => c.text).join(" ").toLowerCase();
  const comments = chunks.filter((c) => c.source_kind === "review");

  const gaps: Record<string, unknown>[] = [];
  const criticals: Record<string, unknown>[] = [];
  for (const [, pattern, label, severity] of TOPICS) {
    const source = documents.find((c) => pattern.test(c.text));
    if (!source) continue;
    const covered = pattern.test(deepdive);
    const citations = [{ chunk_id: source.id, quote: source.text.slice(0, 160) }];
    gaps.push({
      requirement: `${label} requirement stated in ${source.document_name}`,
      coverage: covered ? "covered" : "not_covered",
      explanation: covered ? `The DeepDive refers to ${label.toLowerCase()}.`
        : `${label} is required by the customer document but is not addressed in the DeepDive.`,
      severity: covered ? "low" : severity, citations,
    });
    if (!covered && (severity === "critical" || severity === "high")) {
      criticals.push({
        id: `${source.id}-${label}`, section: "critical_findings", title: `${label} not addressed in the DeepDive`,
        finding: `${label} appears in the customer material but no matching scope, deliverable or commitment is present in the DeepDive.`,
        category: label.toLowerCase(), severity, evidence_class: "fact", evidence: source.text.slice(0, 300),
        business_impact: "May cause non-compliance or rework after award.",
        recommended_action: `Add ${label.toLowerCase()} to the scope and confirm the owner and evidence.`,
        suggested_owner: "Account Presales", citations,
      });
    }
  }

  const unmet = gaps.filter((g) => g.coverage !== "covered");
  const overall = unmet.some((g) => g.severity === "critical") ? "not_ready" : unmet.length ? "ready_with_actions" : "ready";
  const status = overall === "not_ready" ? "red" : unmet.length ? "amber" : "green";

  const readiness_areas = {
    opportunity_understanding: area(documents.length ? "green" : "amber", `${documents.length} document passages were indexed for this version.`),
    technical_readiness: area(status, `${unmet.length} customer requirement(s) are not reflected in the DeepDive.`),
    commercial_readiness: area("amber", "Pricing evidence was not assessed by the demo analyst."),
    partner_readiness: area("amber", "Vendor readiness is taken from the checklist; not assessed here."),
    proposal_readiness: area(status, "Depends on the gaps listed above."),
    risk_readiness: area("amber", "Risks were taken from the DeepDive; no independent assessment."),
    director_concerns: area(comments.length ? "amber" : "green", `${comments.length} Director comment(s) were included as a source.`),
    customer_requirement_coverage: area(status, gaps.length
      ? `${gaps.length - unmet.length} of ${gaps.length} checked requirements are reflected in the DeepDive.`
      : "Not found in the provided opportunity information."),
  };

  const findings = [
    ...criticals,
    ...gaps.map((g, i) => ({
      id: `gap-${i}`, section: "customer_requirement_gaps", title: g.requirement, finding: g.explanation,
      category: g.coverage, severity: g.severity, evidence_class: "fact", evidence: "",
      business_impact: "", recommended_action: "", suggested_owner: "", citations: g.citations,
    })),
  ];

  return {
    executive_summary: gaps.length
      ? `Demo analysis: ${unmet.length} of ${gaps.length} checked customer requirements are not reflected in the DeepDive.`
      : "Demo analysis: no customer requirements could be matched in the uploaded documents.",
    overall_readiness: overall,
    confidence: 0.4,
    findings,
    director_comment_analysis: comments.map((c) => ({
      comment_id: c.field_path ?? c.id, comment_summary: c.text.slice(0, 200), addressed: "unclear",
      explanation: "This rule-based demo analyst cannot judge whether the DeepDive answers the comment. The production model performs this check.",
      citations: [{ chunk_id: c.id, quote: c.text.slice(0, 120) }],
    })),
    recommendation: {
      overall_readiness: overall, confidence: 0.4, readiness_areas,
      required_actions: unmet.slice(0, 8).map((g) => ({
        priority: g.severity, action: `Address: ${g.requirement}`, reason: g.explanation,
        owner: "Account Presales", due: "",
        source: documents.find((d) => d.id === (g.citations as { chunk_id: string }[])[0].chunk_id)?.location_label ?? "",
      })),
      missing_information: unmet.slice(0, 6).map((g) => ({
        item: g.requirement, why_it_matters: "Required by the customer document.", where_to_get_it: "Customer document / clarification",
      })),
      management_recommendation:
        "This result comes from the demo analyst, which applies keyword rules rather than a language model. Use it to review "
        + "the workflow and the evidence trail, not to make a bid decision. Install the on-premises model to produce a real analysis.",
    },
  };
}

/** The same grounding check the backend applies: citations must exist, facts must cite. */
export function checkGrounding(result: ReturnType<typeof analyse>, supplied: Record<string, string>) {
  const warnings: { kind: string; where: string; detail: string }[] = [];
  result.findings.forEach((f, index) => {
    const valid = (f.citations as { chunk_id: string }[]).filter((c) => supplied[c.chunk_id]);
    if (valid.length !== (f.citations as unknown[]).length) {
      warnings.push({ kind: "unknown_citation", where: `findings[${index + 1}]`, detail: "A citation pointed at a source that was not supplied." });
      f.citations = valid;
    }
    if (f.evidence_class === "fact" && valid.length === 0) {
      f.evidence_class = "ai_inference";
      warnings.push({ kind: "fact_without_citation", where: `findings[${index + 1}]`, detail: "Claimed as fact with no source; recorded as an AI inference." });
    }
  });
  return warnings;
}

export const SAMPLE_RFP = `Red Sea Global — Environment and Sustainability Solution
Request for Proposal (extract)

4 Requirements
4.1 Scope
The supplier shall deliver a unified environmental monitoring platform covering marine, terrestrial and
air quality domains across the destination.
4.2 Integration
The platform shall integrate with the existing SCADA system over OPC-UA and with the Smart Destination
command centre.
4.3 Data residency
All environmental data shall remain inside the Kingdom and be hosted in an in-Kingdom data centre.
4.4 Service levels
The supplier shall meet a 99.9% availability SLA with 24/7 support and a four-hour response time for
critical incidents.
4.5 Cybersecurity
The solution shall comply with the National Cybersecurity Authority essential controls and provide
encryption in transit and at rest.

5 Commercial
5.1 Budget
The ceiling budget for this scope is SAR 28,000,000 over five years.
5.2 Milestones
Delivery milestones apply from contract signature, with penalties for late delivery of the field hardware.
`;
