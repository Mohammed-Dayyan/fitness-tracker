import { daysBetweenInclusive } from "./dates";
import { ACTIVITY_LABELS, canonicalActivity, canonicalGoal, GOAL_LABELS } from "./profile-terms";

/**
 * Suggested daily targets: a transparent starting point, never saved
 * automatically. Uses the Mifflin-St Jeor equation for resting energy,
 * a standard activity multiplier and a goal adjustment. Returns which
 * inputs are missing instead of guessing them, and warns when the weight
 * it was given is old.
 */

export const ACTIVITY_LEVELS = [
  { label: "Sedentary", factor: 1.2, hint: "desk job, little exercise" },
  { label: "Lightly active", factor: 1.375, hint: "light exercise 1–3 days/week" },
  { label: "Moderately active", factor: 1.55, hint: "exercise 3–5 days/week" },
  { label: "Very active", factor: 1.725, hint: "hard exercise 6–7 days/week" },
  { label: "Extra active", factor: 1.9, hint: "physical job plus training" },
] as const satisfies readonly { label: (typeof ACTIVITY_LABELS)[number]; factor: number; hint: string }[];

export const GOALS = [
  { label: "Body recomposition", calorieFactor: 0.95, proteinPerKg: 2.0 },
  { label: "Fat loss", calorieFactor: 0.8, proteinPerKg: 2.0 },
  { label: "Muscle gain", calorieFactor: 1.1, proteinPerKg: 1.8 },
  { label: "Maintenance", calorieFactor: 1.0, proteinPerKg: 1.6 },
] as const satisfies readonly { label: (typeof GOAL_LABELS)[number]; calorieFactor: number; proteinPerKg: number }[];

/** A weight older than this is flagged as possibly out of date. */
export const STALE_WEIGHT_DAYS = 30;
export const MIN_AGE = 14;
export const MAX_AGE = 100;

export type SuggestInput = {
  sex: string | null;
  birthDate: string | null;
  today: string;
  heightCm: number | null;
  /** Latest recorded weigh-in with its date; null if none. */
  weight: { kg: number; date: string } | null;
  activityLevel: string | null;
  goal: string | null;
};

export type SuggestedTargets = { calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number };

export type Suggestion =
  | { ok: true; values: SuggestedTargets; basis: string[]; warnings: string[] }
  | { ok: false; missing: string[] };

export function ageOn(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** Whole days from `date` to `today` (0 = today). */
export const daysAgo = (date: string, today: string) => daysBetweenInclusive(date, today) - 1;

export function suggestTargets(input: SuggestInput): Suggestion {
  const sex = input.sex?.toLowerCase();
  const activity = ACTIVITY_LEVELS.find((a) => a.label === canonicalActivity(input.activityLevel));
  const goal = GOALS.find((g) => g.label === canonicalGoal(input.goal));
  const missing: string[] = [];
  if (sex !== "male" && sex !== "female") missing.push("sex (male or female, used by the formula)");
  const age = input.birthDate ? ageOn(input.birthDate, input.today) : null;
  if (!input.birthDate) missing.push("birth date");
  else if (age! < MIN_AGE || age! > MAX_AGE) missing.push(`a plausible birth date (the formula covers ages ${MIN_AGE}–${MAX_AGE}; yours gives ${age})`);
  if (input.heightCm == null) missing.push("height");
  if (!input.weight) missing.push("a weight (record one under Body weight)");
  if (!activity) missing.push(input.activityLevel ? `a recognised activity level ("${input.activityLevel}" is not one of ${ACTIVITY_LABELS.join(", ")})` : "activity level");
  if (!goal) missing.push(input.goal ? `a recognised fitness goal ("${input.goal}" is not one of ${GOAL_LABELS.join(", ")})` : "fitness goal");
  if (missing.length) return { ok: false, missing };

  const w = input.weight!.kg;
  const bmr = 10 * w + 6.25 * input.heightCm! - 5 * age! + (sex === "male" ? 5 : -161);
  const maintenance = bmr * activity!.factor;
  const calories = Math.round((maintenance * goal!.calorieFactor) / 10) * 10;
  const protein_g = Math.round(w * goal!.proteinPerKg);
  const fat_g = Math.round((calories * 0.27) / 9);
  const carbs_g = Math.max(0, Math.round((calories - protein_g * 4 - fat_g * 9) / 4));
  const fiber_g = Math.round((calories / 1000) * 14);

  const age_days = daysAgo(input.weight!.date, input.today);
  const when = age_days === 0 ? "today" : age_days === 1 ? "yesterday" : `${age_days} days ago`;
  const warnings: string[] = [];
  if (age_days > STALE_WEIGHT_DAYS) {
    warnings.push(`Your latest weight (${w} kg) is from ${input.weight!.date}, ${age_days} days ago. Record a current weigh-in for a better estimate.`);
  }
  return {
    ok: true,
    values: { calories, protein_g, carbs_g, fat_g, fiber_g },
    warnings,
    basis: [
      `Weight used: ${w} kg, recorded ${input.weight!.date} (${when})`,
      `Resting energy (Mifflin-St Jeor): ${Math.round(bmr)} kcal for age ${age}, ${input.heightCm} cm, ${w} kg`,
      `× ${activity!.factor} for "${activity!.label}"${input.activityLevel !== activity!.label ? ` (from "${input.activityLevel}")` : ""} = ${Math.round(maintenance)} kcal maintenance`,
      `${goal!.calorieFactor === 1 ? "No adjustment" : `× ${goal!.calorieFactor}`} for "${goal!.label}"${input.goal !== goal!.label ? ` (from "${input.goal}")` : ""} = ${calories} kcal`,
      `Protein ${goal!.proteinPerKg} g per kg body weight; fat 27% of calories; carbs the remainder; fiber 14 g per 1,000 kcal`,
    ],
  };
}
