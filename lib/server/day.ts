import "server-only";
import { addDays, isValidDateString, msUntilNextDay, todayInTimeZone } from "@/lib/shared/dates";
import { getTimezone, listRecords, listWorkoutsWithSets } from "@/lib/server/repo";
import { computeDailySummaries, NUTRIENTS, type DailySummary, type Nutrient } from "@/lib/server/summary";
import { dailyVerdict, type Verdict } from "@/lib/server/verdict";

type JsonRecord = Record<string, unknown>;

export type MealGroup = {
  label: string;
  /** Earliest entry time in the group, if any entry has one. */
  time: string | null;
  entries: JsonRecord[];
  totals: Record<Nutrient, number>;
  /** Entries in the group lacking at least one nutrient. */
  incomplete: number;
  /** Entries in the group lacking each nutrient. */
  missing: Record<Nutrient, number>;
};

export const UNLABELED_MEAL = "Other";

/**
 * Groups a day's food entries by their free-text meal label (case-insensitive,
 * first-seen spelling kept) and orders groups by earliest time; groups without
 * any time follow in the order they were logged.
 */
export function buildMealTimeline(foods: JsonRecord[]): MealGroup[] {
  const groups = new Map<string, MealGroup & { order: number }>();
  foods.forEach((f, i) => {
    const raw = typeof f.meal === "string" && f.meal.trim() ? f.meal.trim() : UNLABELED_MEAL;
    const key = raw.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = {
        label: raw,
        time: null,
        entries: [],
        totals: Object.fromEntries(NUTRIENTS.map((n) => [n, 0])) as Record<Nutrient, number>,
        incomplete: 0,
        missing: Object.fromEntries(NUTRIENTS.map((n) => [n, 0])) as Record<Nutrient, number>,
        order: i,
      };
      groups.set(key, g);
    }
    g.entries.push(f);
    const time = f.time as string | null;
    if (time && (!g.time || time < g.time)) g.time = time;
    for (const n of NUTRIENTS) {
      if (typeof f[n] === "number") g.totals[n] = Math.round((g.totals[n] + (f[n] as number)) * 10) / 10;
      else g.missing[n]++;
    }
    if (NUTRIENTS.some((n) => f[n] == null)) g.incomplete++;
  });
  for (const g of groups.values()) {
    g.entries.sort((a, b) => ((a.time as string | null) ?? "99:99").localeCompare((b.time as string | null) ?? "99:99"));
  }
  return [...groups.values()]
    .sort((a, b) => (a.time && b.time ? a.time.localeCompare(b.time) : a.time ? -1 : b.time ? 1 : 0) || a.order - b.order)
    .map(({ order: _order, ...g }) => {
      void _order;
      return g;
    });
}

export type DayView = {
  date: string;
  today: string;
  timezone: string;
  summary: DailySummary;
  verdict: Verdict;
  meals: MealGroup[];
  workouts: JsonRecord[];
  cardio: JsonRecord[];
  measurements: JsonRecord[];
  note: string | null;
  /** The 7 days ending on this date, for the mini chart. */
  week: DailySummary[];
};

/**
 * Everything the dashboard shows for one date. `ctx` comes from the page's
 * single getDayContext() call so "today" is decided once per request.
 */
export async function getDayView(ownerId: string, date: string, ctx?: DayContext): Promise<DayView> {
  const { timezone, today } = ctx ?? (await getDayContext(ownerId));
  const range = { from: date, to: date };
  const [week, foods, workouts, cardio, measurements, notes] = await Promise.all([
    computeDailySummaries(ownerId, addDays(date, -6), date),
    listRecords(ownerId, "food_entries", range),
    listWorkoutsWithSets(ownerId, range),
    listRecords(ownerId, "cardio_sessions", range),
    listRecords(ownerId, "body_measurements", range),
    listRecords(ownerId, "daily_notes", range),
  ]);
  const summary = week[week.length - 1];
  return {
    date,
    today,
    timezone,
    summary,
    verdict: dailyVerdict(summary, today),
    meals: buildMealTimeline(foods),
    workouts,
    cardio,
    measurements,
    note: (notes[0]?.text as string | undefined) ?? null,
    week,
  };
}

export type DayContext = { timezone: string; today: string; msUntilNextDay: number };

/**
 * "Today" for this owner, decided on the server in the owner's timezone, plus
 * the time until it changes (used by <DayWatcher> to refresh open pages at
 * local midnight). Every page derives "today" from here.
 */
export async function getDayContext(ownerId: string, now: Date = new Date()): Promise<DayContext> {
  const timezone = await getTimezone(ownerId);
  return { timezone, today: todayInTimeZone(timezone, now), msUntilNextDay: msUntilNextDay(timezone, now) };
}

/**
 * The date a page shows: a valid ?date= is always honoured as given (never
 * replaced by today); a missing or invalid one means today.
 */
export async function resolveDate(ownerId: string, raw: string | string[] | undefined, now: Date = new Date()) {
  const ctx = await getDayContext(ownerId, now);
  const requested = typeof raw === "string" ? raw : undefined;
  const valid = requested !== undefined && isValidDateString(requested);
  return { ...ctx, date: valid ? requested : ctx.today, invalidRequest: requested !== undefined && !valid };
}
