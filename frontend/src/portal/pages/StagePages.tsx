import { api } from "../api/client";
import type { OpportunityListItem, Page } from "../api/types";
import { PERM, useAuth } from "../auth/AuthContext";
import { OpportunityTable } from "../components/OpportunityTable";
import { ErrorAlert, PageHeader } from "../components/ui";
import { useAsync } from "../lib/useAsync";

export function ReviewsPage() {
  const { can } = useAuth();
  const awaiting = useAsync(() => api.get<Page<OpportunityListItem>>("/opportunities", { status: ["submitted", "in_review"], sort: "updated_at", page_size: 50 }), []);
  const exec = can(PERM.DASHBOARD_EXECUTIVE);
  return (
    <main className="content">
      <PageHeader kicker="Stage 2 · Director review" title="Reviews"
        lede={exec ? "DeepDives in Director review across all teams." : "DeepDives your team submitted, oldest first. Open one to review it and record your decision."} />
      <ErrorAlert error={awaiting.error} />
      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-pad" style={{ paddingBottom: 6 }}><h2 className="section">{exec ? "In Director review" : "Awaiting my review"} ({awaiting.data?.total ?? 0})</h2></div>
        <OpportunityTable rows={awaiting.data?.items ?? []}  emptyText="Nothing is waiting for review." />
      </section>
      <div className="alert info" style={{ marginTop: 18 }}>
        <b>Phase 2</b> adds the dedicated Review & Comments screen: DeepDive, generated PowerPoint, documents and structured comments (by section, critical issues, missing information, required actions with owner, due date and priority) side by side.
      </div>
    </main>
  );
}

export function AiPlaceholderPage({ kind }: { kind: "analytics" | "recommendations" }) {
  const ready = useAsync(() => api.get<Page<OpportunityListItem>>("/opportunities", { status: ["ready_for_ai", "ai_analysis", "ai_recommendations", "completed"], page_size: 50 }), []);
  const analytics = kind === "analytics";
  return (
    <main className="content">
      <PageHeader kicker="Stage 3–4 · AI" title={analytics ? "AI Analytics" : "AI Recommendations"}
        lede={analytics
          ? "Cross-checks the DeepDive, the Director’s review and the opportunity documents, with every finding tied to its evidence."
          : "Executive readiness view: overall readiness, area status with evidence, critical findings, required actions and missing information."} />
      <div className="alert info" style={{ marginBottom: 18 }}>
        Open an opportunity to run or read its analysis. Everything runs on the on-premises model; opportunity
        documents never leave the cluster.
      </div>
      <section className="card">
        <div className="card-pad" style={{ paddingBottom: 6 }}><h2 className="section">Opportunities at or past “Ready for AI” ({ready.data?.total ?? 0})</h2></div>
        <OpportunityTable rows={ready.data?.items ?? []} emptyText="No opportunity has reached this stage yet." />
      </section>
    </main>
  );
}
