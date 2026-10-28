/**
 * The single definition of "within target", used by the daily verdict, History,
 * Trends adherence and every other comparison against a target. Ratios are
 * actual ÷ target.
 *
 *   calories   90%–110%      (over 110% is "high")
 *   protein    at least 90%  (no upper limit)
 *   carbs      80%–120%
 *   fat        80%–120%
 *   fiber      at least 80%  (no upper limit)
 *   steps      at least 90%  (no upper limit)  ← one rule on Today AND Trends
 *
 * Boundaries are inclusive: exactly 90% of a target counts as met.
 */
export type PolicyKey = "calories" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g" | "steps";

export const TARGET_RULES: Record<PolicyKey, { low: number; high: number | null }> = {
  calories: { low: 0.9, high: 1.1 },
  protein_g: { low: 0.9, high: null },
  carbs_g: { low: 0.8, high: 1.2 },
  fat_g: { low: 0.8, high: 1.2 },
  fiber_g: { low: 0.8, high: null },
  steps: { low: 0.9, high: null },
};

// Tolerance for floating-point noise only (e.g. 0.9 * 8000 = 7200.000000000001).
const EPS = 1e-9;

export type RatioStatus = "low" | "ok" | "high";

export function ratioStatus(key: PolicyKey, actual: number, target: number): RatioStatus {
  const rule = TARGET_RULES[key];
  if (rule.high != null && actual > target * rule.high + EPS) return "high";
  if (actual < target * rule.low - EPS) return "low";
  return "ok";
}

/** True when the value meets its target under the shared rule (not low, not high). */
export const meetsTarget = (key: PolicyKey, actual: number, target: number) => ratioStatus(key, actual, target) === "ok";
