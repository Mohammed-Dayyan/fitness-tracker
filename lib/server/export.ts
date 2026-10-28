import "server-only";
import { prisma } from "@/lib/server/db";
import { addDays, daysBetweenInclusive, dbToDate, monthRange, todayInTimeZone } from "@/lib/shared/dates";
import { SCHEMA_VERSION } from "@/lib/server/import/spec";
import {
  getProfileJson,
  getTimezone,
  listRecords,
  listTargets,
  listWorkoutsWithSets,
  targetsInEffect,
  type DateRange,
} from "@/lib/server/repo";
import { buildCardioStats, getCardioRows } from "@/lib/server/cardio";
import { buildExerciseStats, getSetRows } from "@/lib/server/exercises";
import { computeDailySummaries, NUTRIENTS, type DailySummary } from "@/lib/server/summary";

export type ExportScope =
  | { scope: "all" }
  | { scope: "range"; from: string; to: string }
  | { scope: "day"; date: string }
  | { scope: "month"; month: string };

export function scopeToRange(s: ExportScope): DateRange {
  switch (s.scope) {
    case "all":
      return {};
    case "range":
      return { from: s.from, to: s.to };
    case "day":
      return { from: s.date, to: s.date };
    case "month":
      return monthRange(s.month);
  }
}

const MAX_TOTALS_DAYS = 400;

function compactTotals(s: DailySummary) {
  return {
    date: s.date,
    food_entries: s.food.entries,
    ...s.food.totals,
    // null when nothing was logged. Otherwise true only if every nutrient is known on every entry.
    nutrition_complete: s.food.entries > 0 ? s.food.complete : null,
    // Entries lacking each nutrient; a total is exact only where its count is 0.
    entries_missing: s.food.entries > 0 ? s.food.missing : null,
    estimated_exercise_calories: s.estimated_exercise_calories,
    steps: s.steps,
    weight_kg: s.weight_kg,
  };
}

/**
 * Exports in the import format (schema 1.0) so a file can be re-imported
 * unchanged: every record carries its ID, and re-importing is a no-op.
 */
export async function exportData(ownerId: string, s: ExportScope) {
  const range = scopeToRange(s);
  const [timezone, profile, allTargets, food, workouts, cardio, activity, measurements, notes] = await Promise.all([
    getTimezone(ownerId),
    getProfileJson(ownerId),
    listTargets(ownerId),
    listRecords(ownerId, "food_entries", range),
    listWorkoutsWithSets(ownerId, range),
    listRecords(ownerId, "cardio_sessions", range),
    listRecords(ownerId, "daily_activity", range),
    listRecords(ownerId, "body_measurements", range),
    listRecords(ownerId, "daily_notes", range),
  ]);

  // For a bounded export, keep the version in effect at the start plus any
  // that begin inside the range.
  const targets =
    range.from && range.to
      ? allTargets.filter(
          (t) =>
            t === targetsInEffect(allTargets, range.from!) ||
            ((t.effective_from as string) >= range.from! && (t.effective_from as string) <= range.to!),
        )
      : allTargets;

  let dailyTotals: ReturnType<typeof compactTotals>[] | undefined;
  if (range.from && range.to && daysBetweenInclusive(range.from, range.to) <= MAX_TOTALS_DAYS) {
    dailyTotals = (await computeDailySummaries(ownerId, range.from, range.to)).filter((d) => d.has_data).map(compactTotals);
  }

  return {
    schema_version: SCHEMA_VERSION,
    export_meta: {
      app: "personal-fitness-tracker",
      exported_at: new Date().toISOString(),
      timezone,
      scope: s.scope,
      range: range.from || range.to ? range : "all",
      note: "export_meta is informational and ignored on import. Daily totals are computed from the entries.",
      ...(dailyTotals ? { daily_totals: dailyTotals } : {}),
    },
    profile,
    targets,
    food_entries: food,
    workouts,
    cardio_sessions: cardio,
    daily_activity: activity,
    body_measurements: measurements,
    daily_notes: notes,
  };
}

export function exportFilename(s: ExportScope, today: string): string {
  switch (s.scope) {
    case "all":
      return `fitness-export-all-${today}.json`;
    case "range":
      return `fitness-export-${s.from}_to_${s.to}.json`;
    case "day":
      return `fitness-export-${s.date}.json`;
    case "month":
      return `fitness-export-${s.month}.json`;
  }
}

// ---------------------------------------------------------------------------
// Context package for a new ChatGPT conversation
// ---------------------------------------------------------------------------

const fmt = (v: unknown, unit = "") => (v == null ? "not set" : `${v}${unit}`);

function summaryLines(s: DailySummary): string[] {
  const t = s.targets;
  const lines = [`Date ${s.date}: ${s.food.entries} food entries${s.food.entries === 0 || s.food.complete ? "" : ` (${s.food.incomplete_entries} missing some nutrition; those totals are partial)`}`];
  const labels: Record<string, [string, string]> = {
    calories: ["Calories", " kcal"],
    protein_g: ["Protein", " g"],
    carbs_g: ["Carbs", " g"],
    fat_g: ["Fat", " g"],
    fiber_g: ["Fiber", " g"],
  };
  for (const n of NUTRIENTS) {
    const [label, unit] = labels[n];
    const target = t?.[n];
    lines.push(`- ${label}: ${s.food.totals[n]}${unit}${target != null ? ` / target ${target}${unit}` : ""}${s.food.missing[n] ? ` (${s.food.missing[n]} entries unknown)` : ""}`);
  }
  lines.push(
    `- Workouts: ${s.workouts.count} (${s.workouts.sets} sets); cardio: ${s.cardio.count} (${s.cardio.duration_min} min, ${s.cardio.distance_km} km)`,
    `- Estimated exercise calories (estimate, not added to intake): ${fmt(s.estimated_exercise_calories, " kcal")}`,
    `- Steps: ${fmt(s.steps)}${t?.steps != null ? ` / target ${t.steps}` : ""}; weight: ${fmt(s.weight_kg, " kg")}`,
  );
  return lines;
}

export const MAX_EXERCISE_NAMES = 40;
export const MAX_CARDIO_NAMES = 15;

export async function buildContextPackage(ownerId: string, now = new Date()): Promise<string> {
  const timezone = await getTimezone(ownerId);
  const today = todayInTimeZone(timezone, now);
  const [profile, targets, days, lastWeigh, exerciseNames, cardioNames] = await Promise.all([
    getProfileJson(ownerId),
    listTargets(ownerId),
    computeDailySummaries(ownerId, addDays(today, -13), today),
    prisma.dailyActivity.findFirst({
      where: { ownerId, weightKg: { not: null } },
      orderBy: { date: "desc" },
      select: { date: true, weightKg: true },
    }),
    // Most recently used first, one per normalised name, capped so the context stays short.
    getSetRows(ownerId).then((rows) => buildExerciseStats(rows).slice(0, MAX_EXERCISE_NAMES).map((e) => e.name)),
    getCardioRows(ownerId).then((rows) => buildCardioStats(rows).slice(0, MAX_CARDIO_NAMES).map((c) => c.name)),
  ]);
  const current = targetsInEffect(targets, today);
  const todaySummary = days[days.length - 1];
  const latestWithData = [...days].reverse().find((d) => d.has_data && d.date !== today);
  // Each nutrient is averaged over the days where it is fully known, matching the dashboard and Trends rule.
  const weekFor = (n: (typeof NUTRIENTS)[number]) => days.slice(-7).filter((d) => d.food.nutrient_complete[n]);
  const avg = (n: (typeof NUTRIENTS)[number]) => {
    const w = weekFor(n);
    return w.length ? Math.round(w.reduce((a, d) => a + d.food.totals[n], 0) / w.length) : null;
  };
  const week = weekFor("calories");
  const show = (n: (typeof NUTRIENTS)[number], unit: string) => (avg(n) == null ? "unknown" : `${avg(n)} ${unit}`);

  const profileBits = [
    profile.name && `name ${profile.name}`,
    profile.sex && `sex ${profile.sex}`,
    profile.birth_date && `born ${profile.birth_date}`,
    profile.height_cm && `height ${profile.height_cm} cm`,
    profile.activity_level && `activity level ${profile.activity_level}`,
    profile.goal && `goal: ${profile.goal}`,
  ].filter(Boolean);

  return [
    "# Personal fitness tracker: context",
    "",
    "I log meals, workouts, cardio, steps and weight with you. You reply with JSON that I import into my tracker website. There is no direct API between you and the site: I copy and paste JSON.",
    "",
    `Today is ${today} (${timezone}) as of this export. This date goes stale: on any later day, do not reuse it. Ask me which date each meal or workout belongs to if I haven't said.`,
    "",
    "## Profile and targets",
    `Timezone ${timezone} (all dates are local calendar dates). Units: metric (kg, cm, g, kcal).`,
    profileBits.length ? `Profile: ${profileBits.join("; ")}.` : "Profile: not filled in.",
    current
      ? `Current targets (from ${current.effective_from}): calories ${fmt(current.calories, " kcal")}, protein ${fmt(current.protein_g, " g")}, carbs ${fmt(current.carbs_g, " g")}, fat ${fmt(current.fat_g, " g")}, fiber ${fmt(current.fiber_g, " g")}, steps ${fmt(current.steps)}, goal weight ${fmt(current.goal_weight_kg, " kg")}.`
      : "Targets: none set yet.",
    lastWeigh ? `Latest weight: ${lastWeigh.weightKg} kg on ${dbToDate(lastWeigh.date)}.` : "Latest weight: none recorded.",
    "",
    "## Latest progress",
    ...summaryLines(todaySummary),
    ...(latestWithData ? ["", "Most recent earlier day with data:", ...summaryLines(latestWithData)] : []),
    ...(week.length
      ? ["", `Last 7 days, average over ${week.length} day(s) with exact calories (each nutrient uses only days where it is fully known): ${show("calories", "kcal")}, protein ${show("protein_g", "g")}, carbs ${show("carbs_g", "g")}, fat ${show("fat_g", "g")}, fiber ${show("fiber_g", "g")}.`]
      : []),
    "",
    "## JSON import format (schema_version 1.0)",
    "Send only the records that are new or changed. Every top-level key except schema_version is optional:",
    "```json",
    `{ "schema_version": "1.0", "date": "${today}",`,
    '  "food_entries": [{ "id": "food-…", "name": "Chicken breast", "meal": "Post-workout meal", "time": "19:30", "quantity": 150, "unit": "g", "weight_basis": "raw", "calories": 180, "protein_g": 34, "carbs_g": 0, "fat_g": 4, "fiber_g": 0, "source": "estimate", "estimated": true, "notes": null }],',
    '  "workouts": [{ "id": "wo-…", "name": "Push day", "start_time": "18:00", "duration_min": 60, "estimated_calories": 300,',
    '    "sets": [{ "id": "set-…", "exercise": "Bench Press", "set_number": 1, "reps": 8, "weight_kg": 60, "rpe": 8 }] }],',
    '  "exercise_sets": [{ "id": "set-…", "workout_id": "wo-…", "exercise": "Bench Press", "set_number": 4, "reps": 6, "weight_kg": 62.5 }],',
    '  "cardio_sessions": [{ "id": "cardio-…", "activity": "Run", "duration_min": 30, "distance_km": 5, "avg_heart_rate": 150, "estimated_calories": 320 }],',
    '  "daily_activity": [{ "steps": 9500, "weight_kg": 78.4 }],',
    '  "body_measurements": [{ "id": "meas-…", "waist_cm": 84, "body_fat_pct": 18 }],',
    '  "daily_notes": [{ "text": "Slept badly" }],',
    '  "targets": [{ "effective_from": "' + today + '", "calories": 2200, "protein_g": 160 }],',
    '  "profile": { "height_cm": 178, "goal": "Lean bulk" },',
    '  "delete": { "food_entries": ["food-…"] } }',
    "```",
    "Rules:",
    '- IDs for new records: give every NEW record a fresh unique id you invent (e.g. "food-" + 8 random letters/digits). Never reuse an id for a different record. Two identical foods on one day are two records with two ids.',
    "- IDs for corrections: to change or delete an existing record, reuse its exact existing id. If you do not know that id (it is not in this conversation), do NOT send the correction yet: ask me to export the relevant day or month from the tracker and paste the JSON, then use the ids from it. A correction sent with a new or guessed id creates a duplicate instead of updating.",
    "- Updates: send the id plus only the fields that change. Omitted fields are kept. null clears an optional field.",
    "- Dates: always set the top-level \"date\" to the day the food was eaten or the activity happened, confirmed with me. The top-level \"date\" applies to new records without their own \"date\". To move an existing record to another day, send its id with the new \"date\".",
    "- daily_activity, daily_notes and targets are one per date: without an id they update that date's record.",
    "- Deleting happens only through \"delete\" with ids. Records left out of the JSON are never deleted.",
    "- Unknown nutrition is null, never 0. Mark estimates with \"estimated\": true.",
    "- Field names are strict: unknown fields cause that record to be rejected.",
    "- meal is free text (breakfast, office lunch, evening snack…). Times are HH:MM, 24-hour.",
    "- Do not send daily totals: the tracker calculates them from the entries. Exercise calories are estimates and kept separate from food intake.",
    "",
    "## Names already used: reuse exactly",
    "The tracker groups exercises and cardio by name. For the same exercise or activity always reuse the exact name below; a new name starts a new group.",
    exerciseNames.length ? `Exercises: ${exerciseNames.map((n) => JSON.stringify(n)).join(", ")}.` : "Exercises: none logged yet.",
    cardioNames.length ? `Cardio: ${cardioNames.map((n) => JSON.stringify(n)).join(", ")}.` : "Cardio: none logged yet.",
    "",
    "## History",
    "This context has only recent totals, not the detailed history. If you need earlier entries, record IDs or exact past values, ask me to upload a JSON export (day, month or date range) from the tracker. Never guess the ids of existing records.",
  ].join("\n");
}
