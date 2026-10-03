const dateTime = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : "—");
export const fmtDate = (iso: string | null | undefined) => (iso ? dateOnly.format(new Date(iso)) : "—");

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : fmtDate(iso);
}

export const READINESS_LABEL: Record<string, string> = { ready: "Ready", ready_with_actions: "Ready with actions", not_ready: "Not ready" };

/** Human labels for the workflow statuses, matching the ones the API returns. */
export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", submitted: "Submitted for Review", in_review: "In Review",
  ready_for_ai: "Ready for AI", ai_analysis: "AI Analysis",
  ai_recommendations: "AI Recommendations", completed: "Completed",
};
