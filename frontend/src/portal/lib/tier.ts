/* Opportunity tier. No Presales Lead assigned yet → Low, whatever the value. Otherwise by estimated solution value
   (SAR): Strategic above 30M, High from 20M to 30M, Medium below 20M. */
export type Tier = "strategic" | "high" | "medium" | "low";
export const TIER_LABELS: Record<Tier, string> = { strategic: "Strategic", high: "High", medium: "Medium", low: "Low" };
export const TIER_RULES: { tier: Tier; range: string }[] = [
  { tier: "strategic", range: "> 30M" }, { tier: "high", range: "20M – 30M" }, { tier: "medium", range: "< 20M" },
  { tier: "low", range: "no Presales Lead" },
];
export function tierOf(value: number | null | undefined, leadAssigned = true): Tier | null {
  if (!leadAssigned) return "low";
  if (!value) return null;
  if (value > 30_000_000) return "strategic";
  if (value >= 20_000_000) return "high";
  return "medium";
}

/** Strategic, High, Medium, then Low; opportunities with a lead but no value recorded come last. */
export function groupByTier<T extends { estimated_value: number; lead_assigned?: boolean }>(rows: T[]) {
  const order: (Tier | "none")[] = ["strategic", "high", "medium", "low", "none"];
  return order.map((tier) => ({
    tier,
    label: tier === "none" ? "No value" : TIER_LABELS[tier],
    range: tier === "none" ? "" : tier === "low" ? "no Presales Lead" : `value ${TIER_RULES.find((r) => r.tier === tier)!.range}`,
    rows: rows.filter((r) => (tierOf(r.estimated_value, r.lead_assigned !== false) ?? "none") === tier),
  })).filter((g) => g.rows.length > 0);
}
