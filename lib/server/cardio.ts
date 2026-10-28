import "server-only";
import { prisma } from "@/lib/server/db";
import { dbToDate } from "@/lib/shared/dates";
import { normalizeExerciseName } from "@/lib/shared/exercise";

export type CardioRow = {
  id: string;
  date: string;
  activity: string;
  start_time: string | null;
  duration_min: number | null;
  distance_km: number | null;
  avg_heart_rate: number | null;
  estimated_calories: number | null;
  notes: string | null;
  /** When the record was created (ms): tie-break for sessions on the same day. */
  created: number;
};

export type CardioStats = {
  key: string;
  /** Most recently used display name. */
  name: string;
  sessions: number;
  last_date: string;
  total_km: number;
  total_min: number;
  longest_km: number | null;
  longest_min: number | null;
  /** Best (lowest) minutes per km. Only sessions that have BOTH distance and time count. */
  best_pace_min_per_km: number | null;
};

/** Minutes per km, or null unless both distance and time are present and positive. */
export function paceMinPerKm(durationMin: number | null, distanceKm: number | null): number | null {
  if (durationMin == null || distanceKm == null || durationMin <= 0 || distanceKm <= 0) return null;
  return durationMin / distanceKm;
}

const newestFirst = (a: CardioRow, b: CardioRow) =>
  b.date.localeCompare(a.date) || (b.start_time ?? "").localeCompare(a.start_time ?? "") || b.created - a.created || b.id.localeCompare(a.id);

/** Groups at read time by the normalised activity name; stored records are never rewritten. */
export function buildCardioStats(rows: CardioRow[]): CardioStats[] {
  const groups = new Map<string, CardioRow[]>();
  for (const r of rows) {
    const key = normalizeExerciseName(r.activity);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const latest = [...list].sort(newestFirst)[0];
      const kms = list.map((r) => r.distance_km).filter((v): v is number => v != null && v > 0);
      const mins = list.map((r) => r.duration_min).filter((v): v is number => v != null && v > 0);
      const paces = list.map((r) => paceMinPerKm(r.duration_min, r.distance_km)).filter((v): v is number => v != null);
      return {
        key,
        name: latest.activity,
        sessions: list.length,
        last_date: latest.date,
        total_km: kms.reduce((a, b) => a + b, 0),
        total_min: mins.reduce((a, b) => a + b, 0),
        longest_km: kms.length ? Math.max(...kms) : null,
        longest_min: mins.length ? Math.max(...mins) : null,
        best_pace_min_per_km: paces.length ? Math.min(...paces) : null,
      };
    })
    .sort((a, b) => b.last_date.localeCompare(a.last_date) || a.name.localeCompare(b.name));
}

/** Sessions of one activity (by normalised key), newest first. */
export function cardioSessionsFor(rows: CardioRow[], key: string): CardioRow[] {
  return rows.filter((r) => normalizeExerciseName(r.activity) === key).sort(newestFirst);
}

/** "5:30 /km" style pace. */
export function fmtPace(minPerKm: number | null): string {
  if (minPerKm == null) return "–";
  let m = Math.floor(minPerKm);
  let s = Math.round((minPerKm - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

export async function getCardioRows(ownerId: string): Promise<CardioRow[]> {
  const rows = await prisma.cardioSession.findMany({ where: { ownerId } });
  return rows.map((r) => ({
    id: r.id,
    date: dbToDate(r.date),
    activity: r.activity,
    start_time: r.startTime,
    duration_min: r.durationMin,
    distance_km: r.distanceKm,
    avg_heart_rate: r.avgHeartRate,
    estimated_calories: r.estimatedCalories,
    notes: r.notes,
    created: r.createdAt.getTime(),
  }));
}
