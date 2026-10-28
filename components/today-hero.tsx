import type { ReactNode } from "react";
import { Dumbbell } from "lucide-react";
import { VerdictBadge } from "@/components/dashboard";
import { StatusStrip } from "@/components/status-strip";
import type { DayView } from "@/lib/server/day";
import type { DailySummary } from "@/lib/server/summary";
import { fmtDateLong, fmtNumber } from "@/lib/shared/format";

/**
 * The top of the Today page: the date, whether it is today, and the one finding
 * (the status and its headline, then the per-measure strip). `actions` holds the
 * date navigation and the copy button. Everything shown is derived from the same
 * DayView as the panels below it.
 */
export function TodayTitle({ view, date, kicker, actions }: { view: DayView; date: string; kicker: string; actions: ReactNode }) {
  const { verdict } = view;
  return (
    <header aria-label="Day summary">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted" data-testid="day-kicker">
            {kicker}
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl" data-testid="day-heading" data-date={date}>
            {fmtDateLong(date)}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      <div className="mt-4 space-y-2">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <VerdictBadge status={verdict.status} />
          <span className="text-base font-medium text-ink">{verdict.headline}</span>
        </p>
        {verdict.targetsSet && verdict.status !== "no_data" && verdict.status !== "future" && <StatusStrip checks={verdict.checks} />}
      </div>
    </header>
  );
}

/** A thin bar on the answer panel's dark field. The number beside it carries the meaning; the bar is only a picture of it. */
function FieldBar({
  label,
  value,
  target,
  unit,
  fill,
  overIsBad,
  emptyLabel,
  height = "h-1.5",
}: {
  label: string;
  value: number | null;
  target: number | null;
  unit: string;
  fill: string;
  overIsBad: boolean;
  emptyLabel: string;
  height?: string;
}) {
  const pct = value != null && target != null && target > 0 ? value / target : null;
  if (target == null || target <= 0) return <p className="mt-1 text-xs text-hero-ink-2">Target not set</p>;
  return (
    <div
      role="meter"
      aria-label={`${label}: ${value == null ? emptyLabel.toLowerCase() : fmtNumber(value)} of ${fmtNumber(target)} ${unit}`.trim()}
      aria-valuemin={0}
      aria-valuemax={target}
      aria-valuenow={value ?? 0}
      className={`relative mt-2 overflow-hidden rounded-full bg-white/15 ${height}`}
    >
      <div className="h-full rounded-full" style={{ width: `${Math.min(pct ?? 0, 1) * 100}%`, background: fill }} />
      {overIsBad && pct != null && pct > 1 && <div aria-hidden className="absolute inset-y-0 right-0 w-1 bg-warning" title="Over target" />}
    </div>
  );
}

const ROWS = [
  { key: "protein_g", label: "Protein", overIsBad: false },
  { key: "carbs_g", label: "Carbs", overIsBad: true },
  { key: "fat_g", label: "Fat", overIsBad: true },
  { key: "fiber_g", label: "Fiber", overIsBad: false },
] as const;

/**
 * The answer to "am I on track, and what's left?": calories as the leading
 * figure with what remains, then protein, carbs, fat and fiber against their
 * targets. Replaces the old ring pair, Calories card and Macros card.
 * Partial totals keep their "+" and their explanation.
 */
export function AnswerPanel({ summary }: { summary: DailySummary }) {
  const t = summary.targets;
  const logged = summary.food.entries > 0;
  const target = (t?.calories as number | null | undefined) ?? null;
  const eaten = summary.food.totals.calories;
  const missing = summary.food.missing.calories;
  const diff = target != null ? target - eaten : null;
  const exercise = summary.estimated_exercise_calories;

  return (
    <section className="hero rounded-2xl p-6" aria-label="Calories and macros">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="tabular font-display text-[44px] leading-none font-semibold tracking-tight">
          {logged ? fmtNumber(eaten) : "–"}
          {logged && missing > 0 && <span className="text-3xl text-hero-ink-2">+</span>}
        </p>
        <p className="text-sm text-hero-ink-2">{target != null ? `of ${fmtNumber(target)} kcal` : "kcal"}</p>
      </div>
      <p className="mt-1.5 text-sm text-hero-ink-2">
        {!logged
          ? `No food logged${target != null ? ` · target ${fmtNumber(target)} kcal` : ""}.`
          : missing > 0
            ? `Partial: ${missing} ${missing === 1 ? "entry has" : "entries have"} no calories yet`
            : diff == null
              ? "Calorie target not set"
              : diff >= 0
                ? `${fmtNumber(diff)} kcal remaining`
                : `${fmtNumber(-diff)} kcal over target`}
      </p>
      <FieldBar label="Food intake" value={logged ? eaten : null} target={target} unit="kcal" fill="var(--accent)" overIsBad emptyLabel="No food logged" height="h-2.5" />

      <ul className="mt-7 grid gap-x-8 gap-y-5 sm:grid-cols-2" aria-label="Macros against targets">
        {ROWS.map((r) => {
          const value = logged ? summary.food.totals[r.key] : null;
          const rowTarget = (t?.[r.key] as number | null | undefined) ?? null;
          const gaps = summary.food.missing[r.key];
          return (
            <li key={r.key}>
              <p className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{r.label}</span>
                <span className="tabular text-hero-ink-2">
                  {value == null ? (
                    "No food logged"
                  ) : (
                    <>
                      <span className="font-semibold text-hero-ink">{fmtNumber(value)}</span>
                      {rowTarget != null ? ` / ${fmtNumber(rowTarget)}` : ""} g
                    </>
                  )}
                </span>
              </p>
              <FieldBar label={r.label} value={value} target={rowTarget} unit="g" fill="var(--hero-ink-2)" overIsBad={r.overIsBad} emptyLabel="No food logged" />
              {gaps > 0 && (
                <p className="mt-1 text-xs text-hero-ink-2">
                  Partial: {gaps} {gaps === 1 ? "entry" : "entries"} unknown, so the true total may be higher
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-6 flex items-start gap-2 text-xs text-hero-ink-2">
        <Dumbbell aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Exercise (estimated): <span className="font-medium text-hero-ink">{exercise == null ? "none recorded" : `≈ ${fmtNumber(exercise)} kcal`}</span>. Shown separately and never added back to your food budget.
        </span>
      </p>
    </section>
  );
}

