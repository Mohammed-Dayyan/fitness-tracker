import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronRightIcon, Dumbbell, Flame, Footprints } from "lucide-react";
import { VerdictBadge } from "@/components/dashboard";
import { StatusStrip } from "@/components/status-strip";
import { DayWatcher } from "@/components/day-watcher";
import { Card, EmptyState, PageHeader, PageSkeleton, StatTile } from "@/components/ui";
import { requireOwner } from "@/lib/server/auth/current-owner";
import { getDayContext } from "@/lib/server/day";
import { getHistory, resolveHistoryRange, type HistoryDay } from "@/lib/server/history";
import { addMonths, fmtDateMedium, fmtDateShort, fmtMonth, fmtNumber } from "@/lib/shared/format";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage({ searchParams }: PageProps<"/history">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <History searchParams={searchParams} />
    </Suspense>
  );
}

function calories(d: HistoryDay) {
  const f = d.summary.food;
  if (!f.entries) return "–";
  const target = d.summary.targets?.calories as number | null | undefined;
  return `${fmtNumber(f.totals.calories)}${f.missing.calories ? "+" : ""}${target != null ? ` / ${fmtNumber(target)}` : ""}`;
}
const protein = (d: HistoryDay) =>
  d.summary.food.entries && d.summary.food.missing.protein_g < d.summary.food.entries
    ? `${fmtNumber(d.summary.food.totals.protein_g)}${d.summary.food.missing.protein_g ? "+" : ""} g`
    : "–";
const training = (d: HistoryDay) => {
  const w = d.summary.workouts.count;
  const c = d.summary.cardio.count;
  return w + c === 0 ? "–" : [w ? `${w} workout${w > 1 ? "s" : ""}` : null, c ? `${c} cardio` : null].filter(Boolean).join(", ");
};
// Partial only for the figure shown: missing fiber doesn't make the calories partial.
// The per-measure strip is only meaningful on days that have a status and targets.
const showStrip = (d: HistoryDay) => d.verdict.targetsSet && d.verdict.status !== "no_data" && d.verdict.status !== "future";
const partial = (d: HistoryDay) => d.summary.food.entries > 0 && d.summary.food.missing.calories > 0;

async function History({ searchParams }: { searchParams: PageProps<"/history">["searchParams"] }) {
  const { ownerId } = await requireOwner();
  const ctx = await getDayContext(ownerId);
  const sp = await searchParams;
  const { range, error } = resolveHistoryRange(sp, ctx.today);
  const showAll = sp.all === "1";
  const view = await getHistory(ownerId, range, ctx.today, showAll);

  const base = range.kind === "month" ? `month=${range.month}` : `from=${range.from}&to=${range.to}`;
  const toggleHref = `/history?${base}${showAll ? "" : "&all=1"}`;
  const thisMonth = ctx.today.slice(0, 7);
  const navBtn = "inline-flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink";
  const title = range.kind === "month" ? fmtMonth(range.month) : `${fmtDateShort(range.from)} – ${fmtDateShort(range.to)}`;

  return (
    <div className="space-y-6">
      <DayWatcher today={ctx.today} msUntilNextDay={ctx.msUntilNextDay} />
      <PageHeader
        title="History"
        subtitle={title}
        actions={
          range.kind === "month" ? (
            <div className="flex items-center gap-2">
              <Link href={`/history?month=${addMonths(range.month, -1)}${showAll ? "&all=1" : ""}`} className={navBtn} aria-label="Previous month">
                <ChevronLeft aria-hidden className="size-4" />
              </Link>
              {range.month < thisMonth ? (
                <Link href={`/history?month=${addMonths(range.month, 1)}${showAll ? "&all=1" : ""}`} className={navBtn} aria-label="Next month">
                  <ChevronRight aria-hidden className="size-4" />
                </Link>
              ) : (
                <span className={`${navBtn} opacity-40`} aria-hidden>
                  <ChevronRight className="size-4" />
                </span>
              )}
            </div>
          ) : (
            <Link href="/history" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
              Back to this month
            </Link>
          )
        }
      />

      <form action="/history" method="get" className="flex flex-wrap items-end gap-2 card rounded-2xl p-3">
        <div>
          <label htmlFor="h-from" className="block text-xs text-ink-2">From</label>
          <input id="h-from" name="from" type="date" defaultValue={range.from} max={ctx.today} required className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
        </div>
        <div>
          <label htmlFor="h-to" className="block text-xs text-ink-2">To</label>
          <input id="h-to" name="to" type="date" defaultValue={range.to} max={ctx.today} required className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
        </div>
        {showAll && <input type="hidden" name="all" value="1" />}
        <button type="submit" className="h-9 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2">
          Show range
        </button>
        <Link href={toggleHref} className="ml-auto h-9 rounded-lg px-3 text-sm leading-9 font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
          {showAll ? "Show logged days only" : "Show all dates"}
        </Link>
      </form>
      {error && (
        <p role="alert" className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Days with records" icon={CalendarDays} value={`${view.loggedDays} / ${view.totalDays}`} sub="food, training, steps, weight or notes" />
        <StatTile
          label="Avg calories"
          icon={Flame}
          value={view.avgCalories == null ? "–" : fmtNumber(view.avgCalories)}
          sub={view.calorieDays ? `over ${view.calorieDays} day${view.calorieDays > 1 ? "s" : ""} with exact calories` : "no days with exact calories"}
        />
        <StatTile label="Training sessions" icon={Dumbbell} value={view.sessions} sub="workouts + cardio" />
        <StatTile label="Avg steps" icon={Footprints} value={view.avgSteps == null ? "–" : fmtNumber(view.avgSteps)} sub={view.stepDays ? `over ${view.stepDays} day${view.stepDays > 1 ? "s" : ""} with steps` : "no steps recorded"} />
      </div>

      <Card title={showAll ? "All dates" : "Logged days"} icon={CalendarDays}>
        {view.totalDays === 0 ? (
          <EmptyState icon={CalendarDays} title="This period hasn't started yet" />
        ) : view.days.length === 0 ? (
          <EmptyState icon={CalendarDays} title={`Nothing logged in ${title}`}>
            Log today on the <Link href="/" className="font-medium underline">Today</Link> page, or import history on the{" "}
            <Link href="/data" className="font-medium underline">Data</Link> page.
          </EmptyState>
        ) : (
          <>
            {/* Wider screens: a table. */}
            <table className="tabular hidden w-full text-left text-sm md:table">
              <caption className="sr-only">{showAll ? "Every date in the period" : "Days with records"}, newest first</caption>
              <thead className="text-xs text-ink-2">
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-2 font-medium">Date</th>
                  <th scope="col" className="px-2 py-2 font-medium">Status</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Calories</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Protein</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Training</th>
                  <th scope="col" className="py-2 pl-2 text-right font-medium">Steps</th>
                </tr>
              </thead>
              <tbody>
                {view.days.map((d) => (
                  <tr key={d.summary.date} className={`relative border-b border-line last:border-0 hover:bg-surface-2 focus-within:bg-surface-2 ${d.summary.has_data ? "" : "text-muted"}`}>
                    <th scope="row" className="py-2 pr-2 font-medium">
                      <Link href={`/?date=${d.summary.date}`} className="text-ink hover:underline after:absolute after:inset-0 after:content-['']">
                        {fmtDateMedium(d.summary.date)}
                      </Link>
                    </th>
                    <td className="px-2 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <VerdictBadge status={d.verdict.status} />
                        {showStrip(d) && <StatusStrip checks={d.verdict.checks} />}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {calories(d)}
                      {partial(d) && <span className="ml-1 text-xs text-ink-2">(partial)</span>}
                    </td>
                    <td className="px-2 py-2 text-right">{protein(d)}</td>
                    <td className="px-2 py-2 text-right">{training(d)}</td>
                    <td className="py-2 pl-2 text-right">{fmtNumber(d.summary.steps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Phones: compact cards, no sideways scrolling. */}
            <ul className="divide-y divide-line md:hidden">
              {view.days.map((d) => {
                const facts = [
                  d.summary.food.entries ? `${calories(d)} kcal${partial(d) ? " (partial)" : ""}` : null,
                  protein(d) !== "–" ? `P ${protein(d)}` : null,
                  training(d) !== "–" ? training(d) : null,
                  d.summary.steps != null ? `${fmtNumber(d.summary.steps)} steps` : null,
                  d.summary.weight_kg != null ? `${fmtNumber(d.summary.weight_kg, 1)} kg` : null,
                ].filter(Boolean);
                return (
                  <li key={d.summary.date}>
                    <Link href={`/?date=${d.summary.date}`} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink">{fmtDateMedium(d.summary.date)}</span>
                          <VerdictBadge status={d.verdict.status} />
                        </div>
                        <p className="tabular mt-0.5 text-sm text-ink-2">{facts.length ? facts.join(" · ") : "Nothing logged"}</p>
                        {showStrip(d) && (
                          <div className="mt-1.5">
                            <StatusStrip checks={d.verdict.checks} />
                          </div>
                        )}
                      </div>
                      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
