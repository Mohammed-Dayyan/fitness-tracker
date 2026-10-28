import "server-only";
import { prisma } from "@/lib/server/db";
import { dbToDate } from "@/lib/shared/dates";
import { estimateOneRepMax } from "@/lib/shared/exercise";

export type SetRow = {
  id: string;
  date: string;
  workout_id: string;
  workout_name: string | null;
  /** The workout's start time "HH:MM", if recorded. */
  start_time: string | null;
  /** When the workout record was created (ms): tie-break between untimed workouts on the same day. */
  workout_created: number;
  exercise: string;
  exercise_key: string;
  set_number: number;
  reps: number | null;
  weight_kg: number | null;
  rpe: number | null;
};

export type PersonalRecords = {
  max_weight: { kg: number; reps: number | null; date: string } | null;
  best_e1rm: { kg: number; weight_kg: number; reps: number; date: string } | null;
  max_reps: { reps: number; weight_kg: number | null; date: string } | null;
};

export type ExerciseStats = {
  key: string;
  /** Most recently used display name. */
  name: string;
  sessions: number;
  sets: number;
  last_date: string;
  prs: PersonalRecords;
};

export type ExerciseSession = {
  date: string;
  workout_id: string;
  workout_name: string | null;
  sets: SetRow[];
  top_weight_kg: number | null;
  best_e1rm_kg: number | null;
  max_reps: number | null;
  /** Sum of reps x weight over loaded sets. */
  volume_kg: number;
  /** This session set a new best (weight, e1RM or reps) at the time. */
  new_pr: boolean;
};

/**
 * Chronological order: date, then workout start time (untimed workouts after
 * timed ones), then when the workout was recorded, then id, then set number.
 * Personal-record attribution depends on this: the earlier session gets the PR.
 */
export const chronological = (a: SetRow, b: SetRow) =>
  a.date.localeCompare(b.date) ||
  (a.start_time ?? "99:99").localeCompare(b.start_time ?? "99:99") ||
  a.workout_created - b.workout_created ||
  a.workout_id.localeCompare(b.workout_id) ||
  a.set_number - b.set_number;

export function personalRecords(rows: SetRow[]): PersonalRecords {
  const prs: PersonalRecords = { max_weight: null, best_e1rm: null, max_reps: null };
  // Chronological, with strict ">" so the first time a record was reached wins.
  for (const r of [...rows].sort(chronological)) {
    if (r.weight_kg != null && r.weight_kg > 0 && (r.reps ?? 0) >= 1 && (!prs.max_weight || r.weight_kg > prs.max_weight.kg)) {
      prs.max_weight = { kg: r.weight_kg, reps: r.reps, date: r.date };
    }
    const e1rm = estimateOneRepMax(r.weight_kg, r.reps);
    if (e1rm != null && (!prs.best_e1rm || e1rm > prs.best_e1rm.kg)) {
      prs.best_e1rm = { kg: e1rm, weight_kg: r.weight_kg!, reps: r.reps!, date: r.date };
    }
    if (r.reps != null && r.reps > 0 && (!prs.max_reps || r.reps > prs.max_reps.reps)) {
      prs.max_reps = { reps: r.reps, weight_kg: r.weight_kg, date: r.date };
    }
  }
  return prs;
}

export function buildExerciseStats(rows: SetRow[]): ExerciseStats[] {
  const groups = new Map<string, SetRow[]>();
  for (const r of rows) groups.set(r.exercise_key, [...(groups.get(r.exercise_key) ?? []), r]);
  return [...groups.entries()]
    .map(([key, sets]) => {
      const sorted = [...sets].sort(chronological);
      const last = sorted.at(-1)!;
      return {
        key,
        name: last.exercise,
        sessions: new Set(sets.map((s) => s.workout_id)).size,
        sets: sets.length,
        last_date: last.date,
        prs: personalRecords(sets),
      };
    })
    .sort((a, b) => b.last_date.localeCompare(a.last_date) || a.name.localeCompare(b.name));
}

/** Sessions for one exercise, newest first. */
export function buildExerciseHistory(rows: SetRow[]): ExerciseSession[] {
  const byWorkout = new Map<string, SetRow[]>();
  for (const r of [...rows].sort(chronological)) byWorkout.set(r.workout_id, [...(byWorkout.get(r.workout_id) ?? []), r]);

  let bestWeight = -Infinity;
  let bestE1rm = -Infinity;
  let bestReps = -Infinity;
  const sessions: ExerciseSession[] = [];
  for (const [workout_id, sets] of byWorkout) {
    const weights = sets.filter((s) => (s.reps ?? 0) >= 1).map((s) => s.weight_kg).filter((w): w is number => w != null && w > 0);
    const e1rms = sets.map((s) => estimateOneRepMax(s.weight_kg, s.reps)).filter((v): v is number => v != null);
    const reps = sets.map((s) => s.reps).filter((v): v is number => v != null && v > 0);
    const top = weights.length ? Math.max(...weights) : null;
    const e1rm = e1rms.length ? Math.max(...e1rms) : null;
    const maxReps = reps.length ? Math.max(...reps) : null;
    const isPr = (top != null && top > bestWeight) || (e1rm != null && e1rm > bestE1rm) || (maxReps != null && maxReps > bestReps);
    bestWeight = Math.max(bestWeight, top ?? -Infinity);
    bestE1rm = Math.max(bestE1rm, e1rm ?? -Infinity);
    bestReps = Math.max(bestReps, maxReps ?? -Infinity);
    sessions.push({
      date: sets[0].date,
      workout_id,
      workout_name: sets[0].workout_name,
      sets,
      top_weight_kg: top,
      best_e1rm_kg: e1rm,
      max_reps: maxReps,
      volume_kg: Math.round(sets.reduce((a, s) => a + (s.reps ?? 0) * (s.weight_kg ?? 0), 0)),
      new_pr: isPr,
    });
  }
  return sessions.reverse();
}

export async function getSetRows(ownerId: string, exerciseKey?: string): Promise<SetRow[]> {
  const rows = await prisma.exerciseSet.findMany({
    where: { ownerId, ...(exerciseKey ? { exerciseKey } : {}) },
    include: { workout: { select: { date: true, name: true, startTime: true, createdAt: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    date: dbToDate(r.workout.date),
    workout_id: r.workoutId,
    workout_name: r.workout.name,
    start_time: r.workout.startTime,
    workout_created: r.workout.createdAt.getTime(),
    exercise: r.exerciseName,
    exercise_key: r.exerciseKey,
    set_number: r.setNumber,
    reps: r.reps,
    weight_kg: r.weightKg,
    rpe: r.rpe,
  }));
}
