/* The demo analyst: produces evidence-based findings per analysis from the DeepDive and the documents
   in the reviewed version. Rule-based, like the rest of the demo — no model runs in the browser. */

export interface Finding {
  id: string; analysis: string; type: string; severity: string; title: string; description: string;
  evidence: string; recommendation: string; related_document: string | null; related_requirement: string | null;
  status: "open" | "accepted" | "dismissed";
}

const sev = (i: number) => ["high", "medium", "low"][i % 3];

export function analyse(kind: string, ctx: {
  version: number;
  data: Record<string, any>;
  docs: { category: string; file_name: string; doc_version: number }[];
  comments: { body: string; comment_type: string }[];
}): Finding[] {
  const id = (n: number) => `${kind}-${ctx.version}-${n}`;
  const doc = (group: string[]) => ctx.docs.find((d) => group.includes(d.category));
  const customer = doc(["rfp", "rfq", "rfi", "sow", "clarification", "customer_other"]);
  const tp = doc(["tp"]);
  const cp = doc(["cp"]);
  const ta = doc(["ta"]);
  const quotation = doc(["quotation"]);
  const customerRef = customer ? `${customer.file_name} v${customer.doc_version}` : "Customer documents";
  const out: Finding[] = [];
  const push = (f: Omit<Finding, "id" | "analysis" | "status">, n: number) =>
    out.push({ ...f, id: id(n), analysis: kind, status: "open" });

  if (kind === "early") {
    push({ type: "Question for Customer", severity: "high", title: "Confirm the expected service levels",
      description: "The customer documents state availability targets, but the DeepDive does not record the SLA the bid commits to.",
      evidence: `${customerRef} — service levels section`, recommendation: "Ask the customer to confirm the SLA, response times and penalties before pricing.",
      related_document: customer?.file_name ?? null, related_requirement: "Service levels" }, 1);
    push({ type: "Question for Customer", severity: "medium", title: "Clarify integration scope with existing systems",
      description: "Integration endpoints are referenced without a list of systems, protocols or owners.",
      evidence: `${customerRef} — integration requirements`, recommendation: "Request the integration inventory and the owner of each interface.",
      related_document: customer?.file_name ?? null, related_requirement: "Integration" }, 2);
    push({ type: "Risk Finding", severity: "high", title: "Data residency commitment not evidenced",
      description: "The requirement to keep data in-Kingdom is stated by the customer; the DeepDive does not say where the solution will host it.",
      evidence: `${customerRef} — data residency`, recommendation: "Record the hosting region and the certification that evidences it.",
      related_document: customer?.file_name ?? null, related_requirement: "Data residency" }, 3);
    push({ type: "Proposed Vendor", severity: "low", title: "Vendor coverage for the monitoring scope",
      description: `The DeepDive lists ${(ctx.data.vendors ?? []).length} partner(s). The monitoring scope may need a specialised vendor.`,
      evidence: "DeepDive — Partners & vendors", recommendation: "Confirm whether the scope can be delivered internally or needs a partner, and record the justification.",
      related_document: null, related_requirement: "Scope" }, 4);
    push({ type: "Proposed Solution", severity: "low", title: "Platform approach to propose",
      description: "A unified platform with staged rollout matches the stated objectives and the delivery window.",
      evidence: "DeepDive — Scope of work", recommendation: "Describe the phased architecture in the proposed solution section.",
      related_document: null, related_requirement: "Solution" }, 5);
  }

  if (kind === "technical") {
    const tpRef = tp ? `${tp.file_name} v${tp.doc_version}` : "Technical Proposal";
    push({ type: "Scope Gap", severity: "high", title: "Requirements not covered by the Technical Proposal",
      description: "Several customer requirements have no matching section in the TP.",
      evidence: `${tpRef} compared with ${customerRef}`, recommendation: "Add the missing requirement responses, or state the deviation explicitly.",
      related_document: tp?.file_name ?? null, related_requirement: "Compliance matrix" }, 1);
    push({ type: "Technical Risk", severity: "high", title: "Disaster recovery architecture not described",
      description: "The TP describes the primary site only; the customer asks for recovery objectives.",
      evidence: `${tpRef} — architecture section`, recommendation: "Add the DR topology with RTO and RPO figures and who operates it.",
      related_document: tp?.file_name ?? null, related_requirement: "Availability" }, 2);
    push({ type: "Executive Summary", severity: "low", title: "Executive summary can state the outcome, not the components",
      description: "The current summary lists products; the customer's evaluation criteria are outcomes.",
      evidence: `${tpRef} — executive summary`, recommendation: "Rewrite around the three outcomes the customer is measured on.",
      related_document: tp?.file_name ?? null, related_requirement: "Evaluation criteria" }, 3);
    push({ type: "Capability Alignment", severity: "medium", title: "Two scope areas depend on an external partner",
      description: "Field hardware installation and specialist analytics are not covered internally.",
      evidence: "DeepDive — Internal stakeholders and vendors", recommendation: "Confirm the partner and record the commercial terms before submission.",
      related_document: null, related_requirement: "Delivery model" }, 4);
    if (ta) {
      push({ type: "Tender Analyzer Finding", severity: "medium", title: "Mandatory technical clauses missing from the TP",
        description: "The Tender Analyzer flags mandatory technical clauses that the Technical Proposal does not answer.",
        evidence: `${ta.file_name} v${ta.doc_version} compared with ${tpRef}`,
        recommendation: "Answer each flagged clause in the TP compliance matrix.",
        related_document: ta.file_name, related_requirement: "Mandatory clauses" }, 5);
    }
  }

  if (kind === "commercial") {
    const cpRef = cp ? `${cp.file_name} v${cp.doc_version}` : "Commercial Proposal";
    push({ type: "Pricing Consistency", severity: "high", title: "Quotation total differs from the Commercial Proposal",
      description: "The quotation and the CP state different totals for the same scope.",
      evidence: `${cpRef}${quotation ? ` vs ${quotation.file_name} v${quotation.doc_version}` : ""}`,
      recommendation: "Reconcile the two documents and reissue the quotation.",
      related_document: cp?.file_name ?? null, related_requirement: "Price schedule" }, 1);
    push({ type: "Commercial Risk", severity: "high", title: "Price above the customer's stated budget ceiling",
      description: "The customer states a ceiling in the tender; the proposed price exceeds it.",
      evidence: `${customerRef} — budget; ${cpRef} — total price`,
      recommendation: "Prepare a value-engineered option, or an explicit justification for the difference.",
      related_document: cp?.file_name ?? null, related_requirement: "Budget" }, 2);
    push({ type: "Commercial Assumption", severity: "medium", title: "Payment terms assume milestone billing",
      description: "The CP assumes milestone payments; the tender asks for delivery-based payment.",
      evidence: `${cpRef} — payment terms`, recommendation: "Align the payment schedule with the tender or raise a clarification.",
      related_document: cp?.file_name ?? null, related_requirement: "Payment terms" }, 3);
    if (ta) {
      push({ type: "Tender Analyzer Finding", severity: "medium", title: "Mandatory commercial forms not acknowledged",
        description: "The Tender Analyzer lists forms that the commercial response does not reference.",
        evidence: `${ta.file_name} v${ta.doc_version}`, recommendation: "Attach the required forms and reference them in the CP index.",
        related_document: ta.file_name, related_requirement: "Submission forms" }, 4);
    }
  }

  if (kind === "final") {
    push({ type: "Submission Blocker", severity: "high", title: "Open customer questions still unanswered",
      description: "Questions accepted from the early analysis are still waiting for the customer.",
      evidence: "AI Accepted Tracker — questions waiting for customer",
      recommendation: "Chase the answers, or state the assumption in the submission.",
      related_document: null, related_requirement: "Clarifications" }, 1);
    push({ type: "Final Risk", severity: "medium", title: "Residual delivery risk after mitigation",
      description: "Field hardware lead time remains the main schedule risk after the agreed mitigations.",
      evidence: "Technical and commercial findings", recommendation: "Record the residual risk and the contingency in the submission.",
      related_document: null, related_requirement: "Delivery" }, 2);
    push({ type: "Submission Readiness", severity: "low", title: "Compliance matrix ready for sign-off",
      description: "All mandatory responses have an owner and evidence recorded.",
      evidence: "Consolidated analyses", recommendation: "Obtain the final sign-off before the submission date.",
      related_document: null, related_requirement: "Compliance" }, 3);
    if (ta) {
      push({ type: "Submission Readiness", severity: "medium", title: "Tender Analyzer checklist not fully closed",
        description: "Items from the Tender Analyzer are still open across the TP and the CP.",
        evidence: `${ta.file_name} v${ta.doc_version}${tp ? `, ${tp.file_name}` : ""}${cp ? `, ${cp.file_name}` : ""}`,
        recommendation: "Close or justify every open Tender Analyzer item before submission.",
        related_document: ta.file_name, related_requirement: "Tender compliance" }, 4);
    }
  }

  ctx.comments.slice(0, 2).forEach((c, i) => push({
    type: "Governance", severity: sev(i), title: `Director comment to resolve: ${c.body.slice(0, 60)}`,
    description: "Raised during Review & Governance and not yet reflected in the DeepDive.",
    evidence: `Review & Governance — ${c.comment_type}`, recommendation: "Address the comment in the next DeepDive version.",
    related_document: null, related_requirement: null,
  }, 90 + i));

  return out;
}
