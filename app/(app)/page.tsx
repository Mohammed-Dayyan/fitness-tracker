import { Suspense } from "react";
import Link from "next/link";
import { Info, Upload } from "lucide-react";
import { TargetBarChart } from "@/components/charts/target-bar-chart";
import { CopyButton, DateNav } from "@/components/client-actions";
import { DailyQuickLog } from "@/components/quick-log";
import { ActivityCard, MealTimeline, SERIES, TrainingCard, WhyCard } from "@/components/dashboard";
import { DayWatcher } from "@/components/day-watcher";
import { AnswerPanel, TodayTitle } from "@/components/today-hero";
import { Card, PageSkeleton } from "@/components/ui";
import { requireOwner } from "@/lib/server/auth/current-owner";
import { getDayView, resolveDate } from "@/lib/server/day";
import { addDays } from "@/lib/shared/dates";
import { fmtDateShort } from "@/lib/shared/format";

export default function DashboardPage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const { ownerId } = await requireOwner();
  // One decision about "today" per request; every section below uses `date`.
  const ctx = await resolveDate(ownerId, (await searchParams).date);
  const { date, today } = ctx;
  const view = await getDayView(ownerId, date, ctx);
  const kicker = date === today ? "Today" : date < today ? "Past day" : "Upcoming day";
  const weekFrom = view.week[0]?.date ?? date;

  // Grid: 3 columns with a 24 px gap. Two-thirds + one-third = (W-48)/3*2 + 24 + (W-48)/3 = W, so every row closes on both edges.
  return (
    <div className="space-y-6">
      <DayWatcher today={today} msUntilNextDay={ctx.msUntilNextDay} />
      <TodayTitle
        view={view}
        date={date}
        kicker={kicker}
        actions={
          <>
            <DateNav date={date} prev={addDays(date, -1)} next={addDays(date, 1)} today={today} />
            <CopyButton url={`/api/export?scope=day&date=${date}`} label="Copy day JSON" json />
            <Link href="/data" className="inline-flex h-9 items-center gap-2 rounded-[10px] btn-primary px-3 text-sm font-medium hover:opacity-90">
              <Upload aria-hidden className="size-4" />
              Log data
            </Link>
          </>
        }
      />

      {ctx.invalidRequest && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
          <Info aria-hidden className="size-4" />
          The date in the address wasn&apos;t a valid calendar date, so today is shown.
        </p>
      )}

      {/* The answer, and the day's one job (logging steps) beside it. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <AnswerPanel summary={view.summary} />
        </div>
        <ActivityCard
          summary={view.summary}
          measurements={view.measurements}
          note={view.note}
          quickLog={<DailyQuickLog key={date} date={date} today={today} steps={view.summary.steps} weightKg={view.summary.weight_kg} embedded />}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <MealTimeline meals={view.meals} />
        </div>
        <WhyCard verdict={view.verdict} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <TrainingCard workouts={view.workouts} cardio={view.cardio} />
        <Card
          title={`7 days to ${fmtDateShort(date)}: calories`}
          action={
            <Link href="/trends" className="text-xs font-medium text-ink-2 hover:text-ink">
              See trends →
            </Link>
          }
        >
          <TargetBarChart
            height={180}
            color={SERIES.calories}
            label="Calories"
            unit="kcal"
            summary={`${fmtDateShort(weekFrom)} to ${fmtDateShort(date)}: food logged on ${view.week.filter((d) => d.food.entries > 0).length} of 7 days.`}
            data={view.week.map((d) => ({
              date: d.date,
              value: d.food.entries ? d.food.totals.calories : null,
              target: (d.targets?.calories as number | null | undefined) ?? null,
              partial: d.food.missing.calories > 0,
            }))}
          />
        </Card>
      </div>
    </div>
  );
}
