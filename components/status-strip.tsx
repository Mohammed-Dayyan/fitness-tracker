import type { Check, CheckStatus } from "@/lib/server/verdict";

/**
 * One small marker per measure, so the day's status never has to name a single
 * nutrient: ↓ under, ✓ on target, ↑ over, ○ still to go today, ? incomplete,
 * – no target / nothing logged. Every marker carries a symbol AND a spoken
 * label; colour is only a reinforcement.
 */
const MARKS: Record<CheckStatus, { symbol: string; spoken: string; tone: string }> = {
  ok: { symbol: "✓", spoken: "on target", tone: "bg-good/14 text-good-ink" },
  low: { symbol: "↓", spoken: "under target", tone: "bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-ink" },
  high: { symbol: "↑", spoken: "over target", tone: "bg-warning/20 text-warning-ink" },
  remaining: { symbol: "○", spoken: "still to go today", tone: "bg-surface-2 text-ink-2" },
  unknown: { symbol: "?", spoken: "incomplete data", tone: "bg-surface-2 text-ink-2" },
  no_target: { symbol: "–", spoken: "no target set", tone: "text-muted" },
  no_data: { symbol: "–", spoken: "nothing logged", tone: "text-muted" },
};

const SHORT: Record<Check["key"], string> = { calories: "Cal", protein_g: "Pro", carbs_g: "Carb", fat_g: "Fat", fiber_g: "Fib", steps: "Steps" };

export function StatusStrip({ checks }: { checks: Check[] }) {
  if (checks.length === 0) return null;
  return (
    <ul aria-label="Measures against targets" className="flex flex-wrap gap-1">
      {checks.map((c) => {
        const m = MARKS[c.status];
        return (
          <li
            key={c.key}
            title={`${c.label}: ${m.spoken}`}
            className={`tabular inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${m.tone}`}
          >
            <span className="sr-only">
              {c.label}: {m.spoken}
            </span>
            <span aria-hidden>
              {SHORT[c.key]} {m.symbol}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
