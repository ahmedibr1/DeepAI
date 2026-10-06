/* Opportunity tier by estimated solution value (SAR): Strategic above 30M, High from 20M to 30M, Medium below 20M. */
export type Tier = "strategic" | "high" | "medium";
export const TIER_LABELS: Record<Tier, string> = { strategic: "Strategic", high: "High", medium: "Medium" };
export const TIER_RULES: { tier: Tier; range: string }[] = [
  { tier: "medium", range: "< 20M" }, { tier: "strategic", range: "> 30M" }, { tier: "high", range: "20M – 30M" },
];
export function tierOf(value: number | null | undefined): Tier | null {
  if (!value) return null;
  if (value > 30_000_000) return "strategic";
  if (value >= 20_000_000) return "high";
  return "medium";
}
