import type { z } from "zod";

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

function suggest(key: string, known: string[]): string | null {
  let best: { k: string; d: number } | null = null;
  // Longer names tolerate one more edit ("food_entry" -> "food_entries").
  const maxDistance = key.length >= 8 ? 3 : 2;
  for (const k of known) {
    const d = editDistance(key.toLowerCase(), k);
    if (d <= maxDistance && (!best || d < best.d)) best = { k, d };
  }
  return best?.k ?? null;
}

/**
 * Formats Zod issues as "path: message" strings. Unknown keys get a
 * "did you mean" hint drawn from the schema's known keys at that level.
 */
export function formatIssues(
  error: z.ZodError,
  prefix: string,
  knownKeys: (path: PropertyKey[]) => string[] = () => [],
): string[] {
  return error.issues.map((issue) => {
    const path = [prefix, ...issue.path.map(String)].filter(Boolean).join(".");
    if (issue.code === "unrecognized_keys") {
      const known = knownKeys(issue.path);
      return issue.keys
        .map((k) => {
          const hint = suggest(k, known);
          return `${path ? `${path}: ` : ""}unknown field "${k}"${hint ? ` (did you mean "${hint}"?)` : ""}`;
        })
        .join("; ");
    }
    if (issue.code === "invalid_type" && /received null/.test(issue.message)) {
      return `${path}: cannot be null`;
    }
    return `${path}: ${issue.message}`;
  });
}
