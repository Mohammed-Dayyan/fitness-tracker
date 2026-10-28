/**
 * Grouping key for exercise names: "Bench Press", "bench-press" and
 * "  BENCH  press " all become "bench press". The display name is stored
 * separately and never altered.
 */
export function normalizeExerciseName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The grouping key for an exercise named in a URL or search box (case, spacing and punctuation don't matter). */
export function exerciseKeyFromQuery(raw: string): string {
  return normalizeExerciseName(raw.slice(0, 200));
}

/**
 * Estimated one-rep max using the Epley formula. Only meaningful for loaded
 * sets of 1–12 reps; returns null otherwise.
 */
export function estimateOneRepMax(weightKg: number | null, reps: number | null): number | null {
  if (weightKg == null || reps == null || weightKg <= 0 || reps < 1 || reps > 12) return null;
  if (reps === 1) return weightKg;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}
