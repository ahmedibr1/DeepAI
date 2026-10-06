/* Opportunity tier by estimated solution value (SAR): Strategic above 30M, High from 20M to 30M, Medium below 20M. */
export type Tier = "strategic" | "high" | "medium";
export const TIER_LABELS: Record<Tier, string> = { strategic: "Strategic", high: "High", medium: "Medium" };
export const TIER_RULES: { tier: Tier; range: string }[] = [
  { tier: "strategic", range: "> 30M" }, { tier: "high", range: "20M – 30M" }, { tier: "medium", range: "< 20M" },
];
export function tierOf(value: number | null | undefined): Tier | null {
  if (!value) return null;
  if (value > 30_000_000) return "strategic";
  if (value >= 20_000_000) return "high";
  return "medium";
}

/** Strategic first, then High, then Medium; opportunities with no value recorded come last. */
export function groupByTier<T extends { estimated_value: number }>(rows: T[]) {
  const order: (Tier | "none")[] = ["strategic", "high", "medium", "none"];
  return order.map((tier) => ({
    tier,
    label: tier === "none" ? "No value" : TIER_LABELS[tier],
    range: tier === "none" ? "" : TIER_RULES.find((r) => r.tier === tier)!.range,
    rows: rows.filter((r) => (tierOf(r.estimated_value) ?? "none") === tier),
  })).filter((g) => g.rows.length > 0);
}
