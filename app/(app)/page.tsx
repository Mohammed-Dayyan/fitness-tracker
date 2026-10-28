import { Suspense } from "react";
import Link from "next/link";
import { CalendarRange, Info } from "lucide-react";
import { TargetBarChart } from "@/components/charts/target-bar-chart";
import { CopyButton, DateNav } from "@/components/client-actions";
import { StepsQuickLog } from "@/components/quick-log";
import { ActivityCard, CaloriesCard, MacrosCard, MealTimeline, SERIES, TrainingCard, VerdictCard } from "@/components/dashboard";
import { DayWatcher } from "@/components/day-watcher";
import { TodayHero } from "@/components/today-hero";
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

  return (
    <div className="space-y-6">
      <DayWatcher today={today} msUntilNextDay={ctx.msUntilNextDay} />
      <TodayHero
        view={view}
        date={date}
        kicker={kicker}
        actions={
          <>
            <DateNav date={date} prev={addDays(date, -1)} next={addDays(date, 1)} today={today} />
            <CopyButton url={`/api/export?scope=day&date=${date}`} label="Copy day JSON" json />
          </>
        }
      />

      {ctx.invalidRequest && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
          <Info aria-hidden className="size-4" />
          The date in the address wasn&apos;t a valid calendar date, so today is shown.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <VerdictCard verdict={view.verdict} />
        </div>
        <CaloriesCard summary={view.summary} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <MacrosCard summary={view.summary} />
        <div className="min-w-0 lg:col-span-2">
          <MealTimeline meals={view.meals} />
        </div>
      </div>

      <StepsQuickLog key={date} date={date} today={today} current={view.summary.steps} />

      <div className="grid gap-4 lg:grid-cols-2">
        <TrainingCard workouts={view.workouts} cardio={view.cardio} />
        <ActivityCard summary={view.summary} measurements={view.measurements} note={view.note} />
      </div>

      <Card
        title={`7 days to ${fmtDateShort(date)}: calories`}
        icon={CalendarRange}
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
  );
}
