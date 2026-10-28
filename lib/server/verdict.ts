import { NUTRIENTS, type DailySummary, type Nutrient } from "@/lib/server/summary";
import { ratioStatus, TARGET_RULES } from "@/lib/shared/targets-policy";

/*
 * Daily status rules (also documented in docs/user-guide.md). The status
 * describes the WHOLE day by direction; it never names a single nutrient, so it
 * cannot mislead when several measures are off (e.g. calories AND protein low).
 * Which measures are off is shown by the per-measure strip and the headline.
 *
 *  1. future       The date is after today.
 *  2. no_data      No meaningful record on the date.
 *  3. in_progress  No targets are set for the date (nothing to assess against).
 *  4. incomplete   A past day with activity but no food.
 *  5. under        Every measure that is off is UNDER its target (finished days only).
 *  6. over         Every measure that is off is OVER its target (any day).
 *  7. mixed        Some measures are under and some are over.
 *  8. incomplete   Nothing is reliably off, but a targeted measure is unknown because
 *                  some food entries lack that nutrient (unknown is never zero).
 *  9. in_progress  Today with nothing over target yet, or a missing calorie target.
 * 10. on_target    A finished day with food, a calorie target, and every measure that
 *                  has a target within range. Never awarded just because nothing
 *                  was flagged.
 *
 * Rules 5-7 look only at RELIABLE results: a total that is short while some entries
 * lack that nutrient is "unknown", not "under", while an excess counts even with
 * unknown entries (the true total can only be higher). Judged per measure, so a
 * missing fiber value never affects calories or protein. Today's shortfalls are
 * "still to go", never "under". Thresholds live in lib/shared/targets-policy.ts and
 * are shared with Trends. Exercise calories are never added back to the food budget.
 */

export type CheckStatus = "ok" | "low" | "high" | "remaining" | "unknown" | "no_target" | "no_data";

export type Check = {
  key: Nutrient | "steps";
  label: string;
  unit: string;
  actual: number | null;
  target: number | null;
  status: CheckStatus;
  detail: string;
};

export type VerdictStatus = "no_data" | "future" | "in_progress" | "incomplete" | "on_target" | "under" | "over" | "mixed";

export type Verdict = {
  status: VerdictStatus;
  /** One sentence naming the actual reason for the status. */
  headline: string;
  /** none = no food logged; high = every nutrient known, exact; medium = known but some entries are estimates; low = some nutrients partial. */
  confidence: "high" | "medium" | "low" | "none";
  /** Why confidence is below high, if it is. */
  confidenceNote: string | null;
  /** Nutrients whose total is partial because some entries lack them. */
  partialNutrients: Nutrient[];
  /** True when at least one target applies to this date. */
  targetsSet: boolean;
  checks: Check[];
  /** The measures that are reliably under / over target (empty unless status is under, over or mixed). */
  off: { under: Check["key"][]; over: Check["key"][] };
  /** Concrete next steps, most important first (max 3). */
  actions: string[];
};

type Rule = { key: Nutrient | "steps"; label: string; unit: string; low: number; high: number | null };

// Labels and units; the thresholds come from the shared policy.
export const RULES: Rule[] = [
  { key: "calories", label: "Calories", unit: "kcal", ...TARGET_RULES.calories },
  { key: "protein_g", label: "Protein", unit: "g", ...TARGET_RULES.protein_g },
  { key: "carbs_g", label: "Carbs", unit: "g", ...TARGET_RULES.carbs_g },
  { key: "fat_g", label: "Fat", unit: "g", ...TARGET_RULES.fat_g },
  { key: "fiber_g", label: "Fiber", unit: "g", ...TARGET_RULES.fiber_g },
  { key: "steps", label: "Steps", unit: "", ...TARGET_RULES.steps },
];

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const withUnit = (v: number, unit: string) => (unit ? `${n(v)} ${unit}` : n(v));
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

function evaluate(rule: Rule, s: DailySummary, phase: "past" | "today"): Check {
  const target = (s.targets?.[rule.key] as number | null | undefined) ?? null;
  const isSteps = rule.key === "steps";
  const actual = isSteps ? s.steps : s.food.entries ? s.food.totals[rule.key as Nutrient] : null;
  const missing = isSteps ? 0 : s.food.missing[rule.key as Nutrient];
  const base = { key: rule.key, label: rule.label, unit: rule.unit, actual, target };

  if (target == null || target === 0) return { ...base, status: "no_target", detail: "Target not set" };
  if (actual == null) return { ...base, status: "no_data", detail: isSteps ? "Not recorded" : "No food logged" };

  const verdict = ratioStatus(rule.key, actual, target);
  // Over target is reliable even with unknown entries: the true total can only be higher.
  if (verdict === "high") {
    return { ...base, status: "high", detail: `${withUnit(actual - target, rule.unit)} over target${missing ? " (at least)" : ""}` };
  }
  if (missing) {
    return {
      ...base,
      status: "unknown",
      detail: `At least ${withUnit(actual, rule.unit)}; ${plural(missing, "entry needs", "entries need")} details`,
    };
  }
  if (verdict === "ok") return { ...base, status: "ok", detail: "Within target" };
  const gap = withUnit(target - actual, rule.unit);
  return phase === "today" ? { ...base, status: "remaining", detail: `${gap} to go` } : { ...base, status: "low", detail: `${gap} under target` };
}

// Headlines list measures in RULES order (calories, protein, carbs, fat, fiber, steps).

const PLURAL_LABELS = new Set(["Calories", "Carbs", "Steps"]);

/** "Calories", "Calories and protein", "Calories, protein and fat" (optionally starting lower-case). */
function listNames(checks: Check[], lowerFirst = false): string {
  const names = checks.map((c, i) => (i === 0 && !lowerFirst ? c.label : c.label.toLowerCase()));
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
const verbFor = (checks: Check[]) => (checks.length > 1 || PLURAL_LABELS.has(checks[0].label) ? "are" : "is");

/** One sentence naming everything that is off, by direction; never just one nutrient. */
function offHeadline(under: Check[], over: Check[], unknown: Check[]): string {
  const parts: string[] = [];
  if (under.length) parts.push(`${listNames(under)} ${verbFor(under)} under target`);
  if (over.length) parts.push(`${listNames(over, parts.length > 0)} ${verbFor(over)} over target`);
  let text = `${parts.join("; ")}.`;
  if (unknown.length) text += ` ${listNames(unknown)} ${unknown.length === 1 ? "total is" : "totals are"} incomplete.`;
  return text;
}

export function dailyVerdict(s: DailySummary, today: string): Verdict {
  const phase = s.date > today ? "future" : s.date === today ? "today" : "past";
  const checks = phase === "future" ? [] : RULES.map((r) => evaluate(r, s, phase));
  const byKey = Object.fromEntries(checks.map((c) => [c.key, c])) as Record<Check["key"], Check>;
  const targetsSet = checks.some((c) => c.status !== "no_target");
  const incompleteEntries = s.food.incomplete_entries;
  const kcal = n(s.food.totals.calories);
  const partialNutrients = s.food.entries > 0 ? NUTRIENTS.filter((k) => s.food.missing[k] > 0) : [];
  const partialNames = partialNutrients.map((k) => RULES.find((r) => r.key === k)!.label.toLowerCase());

  // Reliable results only (see the rules above).
  const under = checks.filter((c) => phase === "past" && c.status === "low");
  const over = checks.filter((c) => c.status === "high");
  const unknown = checks.filter((c) => c.status === "unknown");
  const off = { under: under.map((c) => c.key), over: over.map((c) => c.key) };

  const confidence: Verdict["confidence"] =
    s.food.entries === 0 ? "none" : incompleteEntries > 0 ? "low" : s.food.estimated_entries > 0 ? "medium" : "high";
  const confidenceNote =
    s.food.entries === 0
      ? "No food logged, so nutrition totals aren't available."
      : incompleteEntries > 0
        ? `${plural(incompleteEntries, "food entry lacks", "food entries lack")} some nutrition values (${partialNames.join(", ")}), so those totals are partial.`
        : s.food.estimated_entries > 0
          ? `${s.food.estimated_entries} of ${s.food.entries} food entries are estimates; treat totals as approximate.`
          : null;

  const result = (status: VerdictStatus, headline: string, actions: string[]): Verdict => ({
    status,
    headline,
    confidence,
    confidenceNote,
    partialNutrients,
    targetsSet,
    checks,
    off,
    actions: actions.slice(0, 3),
  });

  if (phase === "future") return result("future", "This day hasn't happened yet.", []);
  if (!s.has_data) {
    return result("no_data", "Nothing logged for this day.", phase === "today" ? ["Import today's meals and activity on the Data page"] : []);
  }

  const actions: string[] = [];
  if (!targetsSet) actions.push("Set your daily targets");
  if (incompleteEntries > 0) {
    actions.push(`Add missing ${partialNames.join(", ")} details to ${plural(incompleteEntries, "food entry", "food entries")}`);
  }
  if (byKey.steps.status === "no_data" && byKey.steps.target != null) actions.push("Log steps if available");

  // 3. Nothing to assess against.
  if (!targetsSet) {
    const what = s.food.entries ? `Food logged: ${kcal} kcal${s.food.missing.calories ? " (partial)" : ""}.` : "Activity logged.";
    return result("in_progress", `${what} Set daily targets to assess progress.`, actions);
  }

  // 4. A finished day without food can't be assessed, whatever else was recorded.
  if (phase === "past" && s.food.entries === 0) {
    return result("incomplete", "No food logged, so nutrition can't be assessed.", ["Import this day's meals if you have them", ...actions]);
  }

  // 5-7. Direction of everything that is reliably off.
  if (under.length || over.length) {
    const status: VerdictStatus = under.length && over.length ? "mixed" : under.length ? "under" : "over";
    const detail = [...over, ...under].map((c) =>
      c.status === "high" ? `${c.label}: ${c.detail}` : c.key === "steps" ? `Steps: ${c.detail}` : `${c.label}: ${c.detail}; plan for it tomorrow`,
    );
    return result(status, offHeadline(under, over, unknown), [...actions, ...detail]);
  }

  // 8. Nothing reliably off, but a targeted measure can't be judged yet.
  if (unknown.length) {
    const names = unknown.map((c) => c.label.toLowerCase());
    const worst = Math.max(...unknown.map((c) => s.food.missing[c.key as Nutrient]));
    const headline =
      unknown.length <= 2
        ? `${unknown.map((c) => c.label).join(" and ")} ${unknown.length === 1 ? "total is" : "totals are"} incomplete because ${plural(worst, "food is", "foods are")} missing ${names.join(" and ")}.`
        : `Some nutrient totals are incomplete because ${plural(worst, "food needs", "foods need")} details.`;
    return result("incomplete", headline, actions);
  }

  // 9. Today, with nothing over target yet.
  const cal = byKey.calories;
  if (phase === "today") {
    const todayActions = [...actions];
    if (cal.status === "remaining" && cal.target != null && cal.actual != null) todayActions.push(`About ${n(cal.target - cal.actual)} kcal left for today`);
    if (byKey.protein_g.status === "remaining") todayActions.push(`Protein: ${byKey.protein_g.detail}`);
    if (byKey.steps.status === "remaining") todayActions.push(`Steps: ${byKey.steps.detail}`);
    const headline =
      cal.target != null && s.food.entries
        ? `${kcal} of ${n(cal.target)} kcal so far.`
        : s.food.entries
          ? `${kcal} kcal logged so far.`
          : "No food logged yet today.";
    return result("in_progress", headline, todayActions);
  }

  // 10. A finished day.
  if (cal.status === "no_target") {
    return result("in_progress", `Food logged: ${kcal} kcal. Set a calorie target to assess the day.`, ["Set a calorie target", ...actions]);
  }
  const nutrientsOk = checks.filter((c) => c.key !== "steps" && c.status !== "no_target").every((c) => c.status === "ok");
  if (cal.status === "ok" && nutrientsOk) {
    const protein = byKey.protein_g.status === "ok" ? " Protein target met." : "";
    return result("on_target", `Calories are within your target range.${protein}`, actions);
  }
  // Defensive: anything not clearly on target is reported as in progress, never as on target.
  return result("in_progress", `${kcal} kcal logged.`, actions);
}
