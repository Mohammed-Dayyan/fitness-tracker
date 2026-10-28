import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Beef, CalendarRange, Flame, Footprints, Scale } from "lucide-react";
import { TargetBarChart } from "@/components/charts/target-bar-chart";
import { WeightChart } from "@/components/charts/weight-chart";
import { SERIES } from "@/components/dashboard";
import { Card, EmptyState, KpiStrip, PageHeader, PageSkeleton, SEG_ITEM, Segmented, StatTile } from "@/components/ui";
import { requireOwner } from "@/lib/server/auth/current-owner";
import { getDayContext } from "@/lib/server/day";
import { DayWatcher } from "@/components/day-watcher";
import { getTrends } from "@/lib/server/trends";
import { resolveTrendRange } from "@/lib/shared/trend-range";
import { fmtDateShort, fmtNumber } from "@/lib/shared/format";

export const metadata: Metadata = { title: "Trends" };

const PRESETS = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "mtd", label: "This month" },
] as const;

export default function TrendsPage({ searchParams }: PageProps<"/trends">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TrendsView searchParams={searchParams} />
    </Suspense>
  );
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

async function TrendsView({ searchParams }: { searchParams: PageProps<"/trends">["searchParams"] }) {
  const { ownerId } = await requireOwner();
  const ctx = await getDayContext(ownerId);
  const today = ctx.today;
  const range = resolveTrendRange(await searchParams, today);
  const t = await getTrends(ownerId, range.from, range.to);
  const a = t.adherence;
  const hasWeights = t.days.some((d) => d.weight_kg != null);
  const foodDays = t.days.filter((d) => d.logged).length;
  const stepDays = t.days.filter((d) => d.steps != null).length;
  const coverage = (n: number, what: string) =>
    `${what} on ${n} of ${a.days} days. Days without data are left empty, never drawn as zero.`;
  const change = t.weight.trend_change_kg;

  return (
    <div className="space-y-6">
      <DayWatcher today={today} msUntilNextDay={ctx.msUntilNextDay} />
      <PageHeader title="Trends" subtitle={`${fmtDateShort(range.from)} – ${fmtDateShort(range.to)} · ${a.days} days`} />

      {/* Filters: one row above the charts. */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Date range">
          {PRESETS.map((p) => (
            <Link key={p.key} href={`/trends?range=${p.key}`} aria-current={range.key === p.key ? "true" : undefined} className={SEG_ITEM}>
              {p.label}
            </Link>
          ))}
        </Segmented>
        <form action="/trends" method="get" className="ml-auto flex flex-wrap items-center gap-2">
          <input type="hidden" name="range" value="custom" />
          <label className="sr-only" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={range.from} required className="h-9 rounded-[10px] border border-line bg-surface px-2 text-sm text-ink" />
          <span className="text-sm text-ink-2">to</span>
          <label className="sr-only" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={range.to} required className="h-9 rounded-[10px] border border-line bg-surface px-2 text-sm text-ink" />
          <button type="submit" aria-current={range.key === "custom" ? "true" : undefined} className={`${SEG_ITEM} h-9 bg-surface-2`}>
            Apply
          </button>
        </form>
      </div>
      {range.notice && (
        <p role="status" className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
          {range.notice}
        </p>
      )}
      {range.error && (
        <p role="alert" className="rounded-lg bg-warning/18 px-3 py-2 text-sm text-warning-ink">
          {range.error}
        </p>
      )}

      <KpiStrip className="grid-cols-2 lg:grid-cols-4">
        <StatTile label="Avg calories" value={a.avg_calories.value == null ? "–" : fmtNumber(a.avg_calories.value)} sub={`over ${a.avg_calories.days} day${a.avg_calories.days === 1 ? "" : "s"} with exact calories (${a.days_logged} with food)`} />
        <StatTile label="Avg protein" value={a.avg_protein_g.value == null ? "–" : `${fmtNumber(a.avg_protein_g.value)} g`} sub={`over ${a.avg_protein_g.days} day${a.avg_protein_g.days === 1 ? "" : "s"} with exact protein`} />
        <StatTile label="Calories on target" value={pct(a.calorie.on_target, a.calorie.evaluated)} sub={`${a.calorie.on_target} of ${a.calorie.evaluated} days with exact calories and a target, within ±10%`} />
        <StatTile label="Protein goal hit" value={pct(a.protein.hit, a.protein.evaluated)} sub={`${a.protein.hit} of ${a.protein.evaluated} days with exact protein and a target, at ≥90%`} />
        <StatTile label="Steps goal hit" value={pct(a.steps.hit, a.steps.evaluated)} sub={`${a.steps.hit} of ${a.steps.evaluated} days with steps and a goal, at ≥90%`} />
        <StatTile label="Training sessions" value={a.workouts + a.cardio_sessions} sub={`${a.workouts} workouts · ${a.cardio_sessions} cardio`} />
        <StatTile
          label="Weight trend"
         
          value={change == null ? "–" : `${change > 0 ? "+" : ""}${fmtNumber(change, 1)} kg`}
          sub={change == null ? `needs 2+ weigh-ins (${t.weight.weigh_ins} in range)` : `7-day average, ${t.weight.weigh_ins} weigh-ins`}
        />
        <StatTile label="Latest weight" value={t.weight.last ? `${fmtNumber(t.weight.last.kg, 1)} kg` : "–"} sub={t.weight.last ? fmtDateShort(t.weight.last.date) : "no weigh-ins in range"} />
      </KpiStrip>
      <p className="text-xs text-ink-2">
        Each nutrient is judged only on days where that nutrient is fully known and a target exists; a day missing one
        nutrient (say fiber) still counts for the others. Unknown days are excluded rather than guessed, and every figure
        shows its denominator. A target counts as met by the same rule everywhere (see the user guide): steps at ≥90%.
      </p>

      {a.days_logged === 0 && !hasWeights && a.steps.evaluated === 0 ? (
        <Card>
          <EmptyState icon={CalendarRange} title="No data in this range">
            Choose another range or import history on the <Link href="/data" className="font-medium underline">Data</Link> page.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Calories vs target">
              {foodDays < 2 ? (
                <EmptyState icon={Flame} title={foodDays ? "Only 1 day with food in this range" : "No food logged in this range"}>
                  A chart needs at least two days. See the day itself on Today or History.
                </EmptyState>
              ) : (
                <TargetBarChart summary={coverage(foodDays, "Food logged")} color={SERIES.calories} label="Calories" unit="kcal" data={t.days.map((d) => ({ date: d.date, value: d.calories, target: d.calorie_target, partial: d.logged && !d.nutrient_complete.calories }))} />
              )}
            </Card>
            <Card title="Protein vs target">
              {foodDays < 2 ? (
                <EmptyState icon={Beef} title={foodDays ? "Only 1 day with food in this range" : "No food logged in this range"} />
              ) : (
                <TargetBarChart summary={coverage(foodDays, "Food logged")} color={SERIES.protein_g} label="Protein" unit="g" data={t.days.map((d) => ({ date: d.date, value: d.protein_g, target: d.protein_target, partial: d.logged && !d.nutrient_complete.protein_g }))} />
              )}
            </Card>
            <Card title="Steps vs goal">
              {stepDays < 2 ? (
                <EmptyState icon={Footprints} title={stepDays ? "Only 1 day with steps in this range" : "No steps recorded in this range"} />
              ) : (
                <TargetBarChart summary={coverage(stepDays, "Steps recorded")} color={SERIES.steps} label="Steps" unit="" data={t.days.map((d) => ({ date: d.date, value: d.steps, target: d.steps_target }))} />
              )}
            </Card>
            <Card title="Body weight">
              {t.weight.weigh_ins >= 2 ? (
                <WeightChart
                  summary={`${t.weight.weigh_ins} weigh-ins in ${a.days} days. The line is the average of weigh-ins in the previous 7 days.`}
                  data={t.days.map((d) => ({ date: d.date, weight_kg: d.weight_kg, weight_avg7: d.weight_avg7 }))}
                />
              ) : (
                <EmptyState icon={Scale} title={t.weight.weigh_ins ? "Only 1 weigh-in in this range" : "No weigh-ins in this range"}>
                  {t.weight.last ? `${fmtNumber(t.weight.last.kg, 1)} kg on ${fmtDateShort(t.weight.last.date)}. ` : ""}A trend needs at least two.
                </EmptyState>
              )}
            </Card>
          </div>

          <Card title="Weekly averages">
            <p className="mb-2 text-xs text-ink-2">
              Weeks run Monday to Sunday and show only the dates inside your range. (Nd) is how many days each average covers:
              only days where that nutrient is fully known.
            </p>
            <div className="-mx-5 overflow-x-auto">
              <table className="tabular w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs text-ink-2">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-5 py-2 font-medium">Dates</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Food days</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Avg calories</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Avg protein</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Avg steps</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...t.weeks].reverse().map((w) => (
                    <tr key={w.week_start} className="border-b border-line last:border-0">
                      <th scope="row" className="px-5 py-2 text-left font-medium text-ink">
                        {w.from === w.to ? fmtDateShort(w.from) : `${fmtDateShort(w.from)} – ${fmtDateShort(w.to)}`}
                        {w.partial_week && <span className="ml-2 text-xs font-normal text-ink-2">(partial week)</span>}
                      </th>
                      <td className="px-2 py-2 text-right">{w.days_logged}</td>
                      <td className="px-2 py-2 text-right">
                        {w.avg_calories == null ? "–" : fmtNumber(w.avg_calories)}
                        {w.avg_calories != null && <span className="ml-1 text-xs text-ink-2">({w.calorie_days}d)</span>}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {w.avg_protein_g == null ? "–" : `${fmtNumber(w.avg_protein_g)} g`}
                        {w.avg_protein_g != null && <span className="ml-1 text-xs text-ink-2">({w.protein_days}d)</span>}
                      </td>
                      <td className="px-2 py-2 text-right">{fmtNumber(w.avg_steps)}</td>
                      <td className="px-5 py-2 text-right">{w.workouts + w.cardio_sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
