import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  Clock,
  Dumbbell,
  HeartPulse,
  NotebookPen,
  Ruler,
  Scale,
  Target,
  Timer,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { Badge, Card, EmptyState, Meter, type Tone } from "@/components/ui";
import type { MealGroup } from "@/lib/server/day";
import type { DailySummary } from "@/lib/server/summary";
import type { Check, Verdict, VerdictStatus } from "@/lib/server/verdict";
import { normalizeExerciseName } from "@/lib/shared/exercise";
import { fmtNumber } from "@/lib/shared/format";

type JsonRecord = Record<string, unknown>;

export const SERIES = {
  calories: "var(--s-calories)",
  protein_g: "var(--s-protein)",
  carbs_g: "var(--s-carbs)",
  fat_g: "var(--s-fat)",
  fiber_g: "var(--s-fiber)",
  steps: "var(--s-steps)",
  weight: "var(--s-weight)",
} as const;

/** One map for every place a day's status is shown (Today hero, verdict card, History). */
export const STATUS: Record<VerdictStatus, { tone: Tone; icon: LucideIcon; label: string }> = {
  on_target: { tone: "good", icon: CircleCheck, label: "On target" },
  under: { tone: "info", icon: ArrowDown, label: "Under target" },
  over: { tone: "warning", icon: ArrowUp, label: "Over target" },
  mixed: { tone: "warning", icon: ArrowUpDown, label: "Mixed" },
  in_progress: { tone: "info", icon: Clock, label: "In progress" },
  incomplete: { tone: "neutral", icon: CircleHelp, label: "Incomplete data" },
  no_data: { tone: "neutral", icon: CircleDashed, label: "No data" },
  future: { tone: "neutral", icon: CalendarClock, label: "Upcoming" },
};

const CHECK_STATUS: Record<Check["status"], { tone: Tone; label: string }> = {
  ok: { tone: "good", label: "Within target" },
  low: { tone: "info", label: "Under" },
  high: { tone: "warning", label: "Over" },
  remaining: { tone: "info", label: "To go" },
  unknown: { tone: "neutral", label: "Unknown" },
  no_target: { tone: "neutral", label: "No target" },
  no_data: { tone: "neutral", label: "Not logged" },
};

const NUTRIENT_NAMES = { calories: "calories", protein_g: "protein", carbs_g: "carbs", fat_g: "fat", fiber_g: "fiber" } as const;

export function VerdictBadge({ status }: { status: VerdictStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

export function SetTargetsCta({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 ${compact ? "px-3 py-2" : "p-4"}`}>
      <p className="flex items-center gap-2 text-sm text-ink">
        <Target aria-hidden className="size-4 shrink-0 text-ink-2" />
        No daily targets yet. Set them to see progress and a verdict.
      </p>
      <Link href="/settings#targets" className="rounded-lg btn-primary px-3 py-1.5 text-sm font-medium hover:opacity-90">
        Set targets
      </Link>
    </div>
  );
}

/**
 * What sits under the day's finding: how reliable the totals are, the call to set
 * targets, what to do next, and (collapsed) the per-measure detail behind the
 * status. The headline and the strip are shown at the top of the page.
 */
export function WhyCard({ verdict }: { verdict: Verdict }) {
  const confidence = {
    high: { tone: "good" as const, label: "All nutrients complete" },
    medium: { tone: "neutral" as const, label: "Includes estimates" },
    low: { tone: "neutral" as const, label: `Partial: ${verdict.partialNutrients.map((k) => NUTRIENT_NAMES[k]).join(", ")}` },
    none: { tone: "neutral" as const, label: "No food logged" },
  }[verdict.confidence];
  const assessed = verdict.checks.filter((c) => c.status !== "no_target");
  const showChecks = verdict.targetsSet && verdict.status !== "no_data" && verdict.status !== "future";
  const live = verdict.status !== "future" && verdict.status !== "no_data";
  return (
    <Card title="Status details">
      {live && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
          <Badge tone={confidence.tone}>{confidence.label}</Badge>
          {verdict.confidence !== "none" && verdict.confidenceNote}
        </p>
      )}

      {!verdict.targetsSet && verdict.status !== "future" && (
        <div className="mt-4">
          <SetTargetsCta />
        </div>
      )}

      {verdict.actions.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1.5 text-[13px] font-medium text-ink-2">Next steps</h3>
          <ul className="space-y-1.5">
            {verdict.actions.map((a) => (
              <li key={a} className="flex gap-2 text-sm text-ink">
                <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showChecks && (
        <details className="group mt-4 border-t border-line pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            Why this status
            <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-3 space-y-1.5" aria-label="Checks against targets">
            {assessed.map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 text-ink">
                  <span className="font-medium">{c.label}</span>
                  <span className="ml-2 text-ink-2">{c.detail}</span>
                </span>
                <Badge tone={CHECK_STATUS[c.status].tone}>{CHECK_STATUS[c.status].label}</Badge>
              </li>
            ))}
          </ul>
          {assessed.length < verdict.checks.length && (
            <p className="mt-2 text-xs text-ink-2">
              No target for {verdict.checks.filter((c) => c.status === "no_target").map((c) => c.label.toLowerCase()).join(", ")}.{" "}
              <Link href="/settings#targets" className="font-medium text-ink underline">
                Edit targets
              </Link>
            </p>
          )}
        </details>
      )}
    </Card>
  );
}

const q = (v: unknown, digits = 0) => (typeof v === "number" ? fmtNumber(v, digits) : "?");

function FoodRow({ f, groupTime }: { f: JsonRecord; groupTime: string | null }) {
  const incomplete = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g"].some((k) => f[k] == null);
  const amount = [f.quantity != null ? fmtNumber(f.quantity as number, 1) : null, f.unit, f.weight_basis ? `(${f.weight_basis})` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
          <span className="font-medium" data-testid="food-name">{f.name as string}</span>
          {incomplete && <Badge tone="warning">Needs details</Badge>}
          {f.estimated === true && <Badge>Est.</Badge>}
        </p>
        <p className="text-xs text-ink-2">
          {[f.time !== groupTime ? (f.time as string | null) : null, amount || null, f.source as string | null].filter(Boolean).join(" · ")}
          {typeof f.notes === "string" && <span className="block italic">{f.notes}</span>}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="tabular text-sm font-semibold text-ink">{f.calories == null ? "? kcal" : `${q(f.calories)} kcal`}</p>
        <p className="tabular text-xs text-ink-2">
          P {q(f.protein_g)} · C {q(f.carbs_g)} · F {q(f.fat_g)} · Fi {q(f.fiber_g)}
        </p>
      </div>
    </li>
  );
}

export function MealTimeline({ meals }: { meals: MealGroup[] }) {
  return (
    <Card title="Meals">
      {meals.length === 0 ? (
        <EmptyState icon={Utensils} title="No food logged">
          Import food entries from ChatGPT on the <Link href="/data" className="font-medium underline">Data</Link> page.
        </EmptyState>
      ) : (
        <ol className="relative space-y-5 border-l border-line pl-5">
          {meals.map((m) => (
            <li key={m.label} className="relative">
              <span aria-hidden className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface" style={{ background: SERIES.calories }} />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">
                  {m.label}
                  {m.time && <span className="ml-2 font-normal text-ink-2">{m.time}</span>}
                </h3>
                {/* A single entry already shows its own figures right below. */}
                {m.entries.length > 1 && (
                  <p className="tabular text-xs text-ink-2">
                    {mealTotal(m, "calories", "kcal")} · P {mealTotal(m, "protein_g", "g")}
                  </p>
                )}
              </div>
              <ul className="divide-y divide-line">
                {m.entries.map((f) => (
                  <FoodRow key={f.id as string} f={f} groupTime={m.time} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** A group's total for one nutrient: "379 kcal", "379+ kcal" when some entries lack it, "unknown" when all do. */
function mealTotal(m: MealGroup, key: "calories" | "protein_g", unit: string) {
  if (m.missing[key] === m.entries.length) return "unknown";
  const value = `${fmtNumber(m.totals[key])}${m.missing[key] ? "+" : ""}`;
  return `${value} ${unit}`;
}

function groupSets(sets: JsonRecord[]) {
  const groups = new Map<string, { name: string; sets: JsonRecord[] }>();
  for (const s of sets) {
    const key = normalizeExerciseName(s.exercise as string);
    if (!groups.has(key)) groups.set(key, { name: s.exercise as string, sets: [] });
    groups.get(key)!.sets.push(s);
  }
  return [...groups.entries()];
}

function setLabel(s: JsonRecord) {
  const reps = s.reps != null ? `${s.reps}` : s.duration_s != null ? `${s.duration_s}s` : "?";
  const load = s.weight_kg != null ? ` × ${fmtNumber(s.weight_kg as number, 1)} kg` : "";
  const rpe = s.rpe != null ? ` @${s.rpe}` : "";
  return `${reps}${load}${rpe}`;
}

export function TrainingCard({ workouts, cardio }: { workouts: JsonRecord[]; cardio: JsonRecord[] }) {
  const empty = workouts.length === 0 && cardio.length === 0;
  return (
    <Card title="Training">
      {empty ? (
        <EmptyState icon={Dumbbell} title="No workouts or cardio logged" />
      ) : (
        <div className="space-y-5">
          {workouts.map((w) => (
            <div key={w.id as string}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{(w.name as string) ?? "Workout"}</h3>
                <p className="flex flex-wrap gap-3 text-xs text-ink-2">
                  {typeof w.start_time === "string" && <span>{w.start_time}</span>}
                  {w.duration_min != null && (
                    <span className="inline-flex items-center gap-1">
                      <Timer aria-hidden className="size-3" />
                      {fmtNumber(w.duration_min as number)} min
                    </span>
                  )}
                  {w.estimated_calories != null && <span>≈ {fmtNumber(w.estimated_calories as number)} kcal (est.)</span>}
                </p>
              </div>
              {(w.sets as JsonRecord[]).length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {groupSets(w.sets as JsonRecord[]).map(([key, g]) => (
                    <li key={key} className="text-sm">
                      <Link href={`/exercises?exercise=${encodeURIComponent(key)}`} className="font-medium text-ink hover:underline">
                        {g.name}
                      </Link>
                      <span className="tabular ml-2 text-ink-2">{g.sets.map(setLabel).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-ink-2">No sets recorded.</p>
              )}
              {typeof w.notes === "string" && <p className="mt-1 text-xs text-ink-2 italic">{w.notes}</p>}
            </div>
          ))}
          {cardio.map((c) => (
            <div key={c.id as string} className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <HeartPulse aria-hidden className="size-4 text-ink-2" />
                {c.activity as string}
              </h3>
              <p className="tabular flex flex-wrap gap-3 text-xs text-ink-2">
                {c.duration_min != null && <span>{fmtNumber(c.duration_min as number)} min</span>}
                {c.distance_km != null && <span>{fmtNumber(c.distance_km as number, 2)} km</span>}
                {c.avg_heart_rate != null && <span>{c.avg_heart_rate as number} bpm avg</span>}
                {c.estimated_calories != null && <span>≈ {fmtNumber(c.estimated_calories as number)} kcal (est.)</span>}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function ActivityCard({ summary, measurements, note, quickLog }: { summary: DailySummary; measurements: JsonRecord[]; note: string | null; quickLog?: ReactNode }) {
  const stepsTarget = (summary.targets?.steps as number | null | undefined) ?? null;
  const goal = (summary.targets?.goal_weight_kg as number | null | undefined) ?? null;
  const measureLabels: [string, string][] = [
    ["waist_cm", "Waist"],
    ["chest_cm", "Chest"],
    ["hips_cm", "Hips"],
    ["neck_cm", "Neck"],
    ["arm_cm", "Arm"],
    ["thigh_cm", "Thigh"],
  ];
  return (
    <Card title="Activity & body" className="flex flex-col">
      <Meter
        label="Steps"
        value={summary.steps}
        target={stepsTarget}
        unit=""
        color={SERIES.steps}
        overIsBad={false}
        note={
          summary.steps != null && stepsTarget != null && stepsTarget > 0
            ? summary.steps >= stepsTarget
              ? `${fmtNumber(summary.steps - stepsTarget)} over the target`
              : `${fmtNumber(stepsTarget - summary.steps)} to go`
            : undefined
        }
      />
      <div className="mt-4 flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
        <span className="flex items-center gap-2 text-sm text-ink-2">
          <Scale aria-hidden className="size-4" />
          Weight
        </span>
        <span className="tabular text-sm text-ink">
          <span className="font-semibold">{summary.weight_kg == null ? "Not recorded" : `${fmtNumber(summary.weight_kg, 1)} kg`}</span>
          {goal != null && <span className="ml-2 text-ink-2">goal {fmtNumber(goal, 1)} kg</span>}
        </span>
      </div>
      {measurements.map((m) => (
        <div key={m.id as string} className="mt-3 text-sm">
          <p className="mb-1 flex items-center gap-2 text-ink-2">
            <Ruler aria-hidden className="size-4" />
            Measurements
          </p>
          <p className="tabular flex flex-wrap gap-x-4 gap-y-1 text-ink">
            {measureLabels.filter(([k]) => m[k] != null).map(([k, l]) => (
              <span key={k}>
                {l} {fmtNumber(m[k] as number, 1)} cm
              </span>
            ))}
            {m.body_fat_pct != null && <span>Body fat {fmtNumber(m.body_fat_pct as number, 1)}%</span>}
          </p>
        </div>
      ))}
      {note && (
        <div className="mt-4 border-t border-line pt-3 text-sm text-ink">
          <p className="mb-1 flex items-center gap-2 text-ink-2">
            <NotebookPen aria-hidden className="size-4" />
            Note
          </p>
          <p className="whitespace-pre-line">{note}</p>
        </div>
      )}
      {quickLog && <div className="mt-auto pt-5">{quickLog}</div>}
    </Card>
  );
}
