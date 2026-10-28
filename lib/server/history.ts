import "server-only";
import { computeDailySummaries, type DailySummary } from "@/lib/server/summary";
import { dailyVerdict, type Verdict } from "@/lib/server/verdict";
import { daysBetweenInclusive, isValidDateString, isValidMonthString, monthRange } from "@/lib/shared/dates";

export type HistoryRange =
  | { kind: "month"; month: string; from: string; to: string }
  | { kind: "range"; from: string; to: string };

export const MAX_HISTORY_DAYS = 366;

/** ?month= or ?from=&to=; defaults to the current month. Never extends past today. */
export function resolveHistoryRange(sp: Record<string, string | string[] | undefined>, today: string): { range: HistoryRange; error: string | null } {
  const from = typeof sp.from === "string" ? sp.from : "";
  const to = typeof sp.to === "string" ? sp.to : "";
  if (from || to) {
    if (isValidDateString(from) && isValidDateString(to) && from <= to && daysBetweenInclusive(from, to) <= MAX_HISTORY_DAYS) {
      return { range: { kind: "range", from, to: to > today ? today : to }, error: null };
    }
    const fallback = monthRange(today.slice(0, 7));
    return {
      range: { kind: "month", month: today.slice(0, 7), from: fallback.from, to: today },
      error: `The date range must be two valid dates, start before end, at most ${MAX_HISTORY_DAYS} days. Showing this month.`,
    };
  }
  const month = typeof sp.month === "string" && isValidMonthString(sp.month) ? sp.month : today.slice(0, 7);
  const r = monthRange(month);
  return { range: { kind: "month", month, from: r.from, to: r.to > today ? today : r.to }, error: null };
}

export type HistoryDay = { summary: DailySummary; verdict: Verdict };

export type HistoryView = {
  /** Days shown: logged days only unless showAll. Newest first. */
  days: HistoryDay[];
  totalDays: number;
  /** Days with at least one meaningful record (food, training, steps, weight, measurements, note). */
  loggedDays: number;
  /** Days whose calorie total is exact; the average uses only these. */
  calorieDays: number;
  avgCalories: number | null;
  sessions: number;
  stepDays: number;
  avgSteps: number | null;
};

export async function getHistory(ownerId: string, range: HistoryRange, today: string, showAll: boolean): Promise<HistoryView> {
  // A range starting in the future has nothing to show.
  const summaries = range.from > today ? [] : await computeDailySummaries(ownerId, range.from, range.to);
  return buildHistory(summaries, today, showAll);
}

export function buildHistory(summaries: DailySummary[], today: string, showAll: boolean): HistoryView {
  const logged = summaries.filter((s) => s.has_data);
  const calorieComplete = summaries.filter((s) => s.food.nutrient_complete.calories);
  const steps = summaries.filter((s) => s.steps != null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    days: (showAll ? summaries : logged).map((s) => ({ summary: s, verdict: dailyVerdict(s, today) })).reverse(),
    totalDays: summaries.length,
    loggedDays: logged.length,
    calorieDays: calorieComplete.length,
    avgCalories: mean(calorieComplete.map((s) => s.food.totals.calories)),
    sessions: summaries.reduce((a, s) => a + s.workouts.count + s.cardio.count, 0),
    stepDays: steps.length,
    avgSteps: mean(steps.map((s) => s.steps!)),
  };
}
