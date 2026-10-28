import "server-only";
import { eachDay } from "@/lib/shared/dates";
import { listRecords, listTargets, listWorkoutsWithSets, targetsInEffect } from "@/lib/server/repo";

type JsonRecord = Record<string, unknown>;

export const NUTRIENTS = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const;
export type Nutrient = (typeof NUTRIENTS)[number];

export type DailySummary = {
  date: string;
  food: {
    entries: number;
    /** Sum of known values. Unknown values are excluded, never treated as 0. */
    totals: Record<Nutrient, number>;
    /** How many entries lack each nutrient. */
    missing: Record<Nutrient, number>;
    /** Entries lacking at least one nutrient. */
    incomplete_entries: number;
    /** Entries marked as estimated. */
    estimated_entries: number;
    /**
     * Per nutrient: at least one entry, and every entry has this nutrient, so
     * this nutrient's total is exact. A gap in one nutrient (say fiber) never
     * affects another's (say calories).
     */
    nutrient_complete: Record<Nutrient, boolean>;
    /** Food was logged and every entry has every nutrient (all five totals exact). False when nothing was logged. */
    complete: boolean;
  };
  targets: JsonRecord | null;
  workouts: { count: number; sets: number; duration_min: number; estimated_calories: number | null };
  cardio: { count: number; duration_min: number; distance_km: number; estimated_calories: number | null };
  /** Exercise calories are estimates only and never offset food intake here. */
  estimated_exercise_calories: number | null;
  steps: number | null;
  weight_kg: number | null;
  /** Body measurement records on this date. */
  measurements: number;
  has_note: boolean;
  /**
   * At least one meaningful record: food, workout, cardio, steps, weight,
   * measurements or a note. An activity row with no values doesn't count.
   */
  has_data: boolean;
};

const round = (n: number) => Math.round(n * 10) / 10;

function sumKnown(values: unknown[]): number | null {
  const known = values.filter((v): v is number => typeof v === "number");
  return known.length ? round(known.reduce((a, b) => a + b, 0)) : null;
}

/** Totals derived from stored entries for every date in [from, to]. */
export async function computeDailySummaries(ownerId: string, from: string, to: string): Promise<DailySummary[]> {
  const range = { from, to };
  const [foods, workouts, cardio, activity, measurements, notes, targets] = await Promise.all([
    listRecords(ownerId, "food_entries", range),
    listWorkoutsWithSets(ownerId, range),
    listRecords(ownerId, "cardio_sessions", range),
    listRecords(ownerId, "daily_activity", range),
    listRecords(ownerId, "body_measurements", range),
    listRecords(ownerId, "daily_notes", range),
    listTargets(ownerId),
  ]);

  const byDate = <T extends JsonRecord>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.date as string, [...(m.get(r.date as string) ?? []), r]);
    return m;
  };
  const foodsBy = byDate(foods);
  const workoutsBy = byDate(workouts);
  const cardioBy = byDate(cardio);
  const activityBy = byDate(activity);
  const measurementsBy = byDate(measurements);
  const notesBy = byDate(notes);

  return eachDay(from, to).map((date) => {
    const f = foodsBy.get(date) ?? [];
    const w = workoutsBy.get(date) ?? [];
    const c = cardioBy.get(date) ?? [];
    const a = activityBy.get(date)?.[0];
    const m = measurementsBy.get(date)?.length ?? 0;
    const hasNote = notesBy.has(date) || typeof a?.notes === "string";
    const steps = (a?.steps as number | null | undefined) ?? null;
    const weight = (a?.weight_kg as number | null | undefined) ?? null;

    const totals = {} as Record<Nutrient, number>;
    const missing = {} as Record<Nutrient, number>;
    for (const n of NUTRIENTS) {
      totals[n] = sumKnown(f.map((e) => e[n])) ?? 0;
      missing[n] = f.filter((e) => e[n] == null).length;
    }
    const incomplete = f.filter((e) => NUTRIENTS.some((n) => e[n] == null)).length;

    const workoutCalories = sumKnown(w.map((x) => x.estimated_calories));
    const cardioCalories = sumKnown(c.map((x) => x.estimated_calories));
    const exercise =
      workoutCalories == null && cardioCalories == null ? null : round((workoutCalories ?? 0) + (cardioCalories ?? 0));

    return {
      date,
      food: {
        entries: f.length,
        totals,
        missing,
        incomplete_entries: incomplete,
        estimated_entries: f.filter((e) => e.estimated === true).length,
        nutrient_complete: Object.fromEntries(NUTRIENTS.map((n) => [n, f.length > 0 && missing[n] === 0])) as Record<Nutrient, boolean>,
        complete: f.length > 0 && incomplete === 0,
      },
      targets: targetsInEffect(targets, date),
      workouts: {
        count: w.length,
        sets: w.reduce((n, x) => n + (x.sets as unknown[]).length, 0),
        duration_min: round(w.reduce((n, x) => n + ((x.duration_min as number) ?? 0), 0)),
        estimated_calories: workoutCalories,
      },
      cardio: {
        count: c.length,
        duration_min: round(c.reduce((n, x) => n + ((x.duration_min as number) ?? 0), 0)),
        distance_km: round(c.reduce((n, x) => n + ((x.distance_km as number) ?? 0), 0)),
        estimated_calories: cardioCalories,
      },
      estimated_exercise_calories: exercise,
      steps,
      weight_kg: weight,
      measurements: m,
      has_note: hasNote,
      has_data: f.length + w.length + c.length + m > 0 || steps != null || weight != null || hasNote,
    };
  });
}
