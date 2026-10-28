import { addDays, dateToDb } from "@/lib/shared/dates";
import { meetsTarget } from "@/lib/shared/targets-policy";
import { computeDailySummaries, type DailySummary, type Nutrient } from "@/lib/server/summary";

export type TrendDay = {
  date: string;
  /** At least one food entry. */
  logged: boolean;
  /** Food logged and all five nutrients known on every entry. */
  complete: boolean;
  /** Per nutrient: its total is exact (see DailySummary.food.nutrient_complete). */
  nutrient_complete: Record<Nutrient, boolean>;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  calorie_target: number | null;
  protein_target: number | null;
  steps: number | null;
  steps_target: number | null;
  weight_kg: number | null;
  /** Mean of the weigh-ins in the trailing 7 days (smooths daily noise). */
  weight_avg7: number | null;
  estimated_exercise_calories: number | null;
  workouts: number;
};

export type TrendWeek = {
  week_start: string;
  /** First and last date of this week that fall inside the selected range. */
  from: string;
  to: string;
  /** The range covers fewer than the 7 days of this week. */
  partial_week: boolean;
  /** Days with at least one food entry. */
  days_logged: number;
  /** Averages use only days whose total for that nutrient is exact. */
  calorie_days: number;
  protein_days: number;
  avg_calories: number | null;
  avg_protein_g: number | null;
  avg_steps: number | null;
  workouts: number;
  cardio_sessions: number;
};

export type Average = { value: number | null; days: number };

export type Adherence = {
  days: number;
  days_logged: number;
  /** Days where every nutrient is known. */
  days_complete: number;
  avg_calories: Average;
  avg_protein_g: Average;
  /** Evaluated = days where this metric is known and has a target. */
  calorie: { on_target: number; evaluated: number };
  protein: { hit: number; evaluated: number };
  steps: { hit: number; evaluated: number };
  workouts: number;
  cardio_sessions: number;
};

export type WeightStats = {
  first: { date: string; kg: number } | null;
  last: { date: string; kg: number } | null;
  /** Number of days with a weigh-in in the range. */
  weigh_ins: number;
  /**
   * Change between the first and last 7-day averages in the range. Null with
   * fewer than two weigh-ins: one reading can't show a trend.
   */
  trend_change_kg: number | null;
  min_kg: number | null;
  max_kg: number | null;
};

export type Trends = { days: TrendDay[]; weeks: TrendWeek[]; adherence: Adherence; weight: WeightStats };

const round1 = (v: number) => Math.round(v * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const avgOf = (xs: number[]): Average => {
  const m = mean(xs);
  return { value: m == null ? null : Math.round(m), days: xs.length };
};

/** Monday of the ISO week containing the date. */
export function weekStart(date: string): string {
  const day = dateToDb(date).getUTCDay(); // 0 = Sunday
  return addDays(date, day === 0 ? -6 : 1 - day);
}

/**
 * Builds chart series and adherence statistics from daily summaries, which
 * are themselves computed from stored entries. Each nutrient is judged only on
 * days where that nutrient is fully known, so a missing fiber value never
 * affects calorie or protein figures.
 */
export function buildTrends(summaries: DailySummary[], lookback: DailySummary[] = []): Trends {
  // The days before the range only feed the first 7-day weight averages.
  const all = [...lookback, ...summaries];
  const days: TrendDay[] = summaries.map((s, idx) => {
    const i = idx + lookback.length;
    const windowWeights = all
      .slice(Math.max(0, i - 6), i + 1)
      .map((d) => d.weight_kg)
      .filter((w): w is number => w != null);
    const logged = s.food.entries > 0;
    return {
      date: s.date,
      logged,
      complete: s.food.complete,
      nutrient_complete: s.food.nutrient_complete,
      calories: logged ? s.food.totals.calories : null,
      protein_g: logged ? s.food.totals.protein_g : null,
      carbs_g: logged ? s.food.totals.carbs_g : null,
      fat_g: logged ? s.food.totals.fat_g : null,
      fiber_g: logged ? s.food.totals.fiber_g : null,
      calorie_target: (s.targets?.calories as number | null) ?? null,
      protein_target: (s.targets?.protein_g as number | null) ?? null,
      steps: s.steps,
      steps_target: (s.targets?.steps as number | null) ?? null,
      weight_kg: s.weight_kg,
      weight_avg7: windowWeights.length ? round1(mean(windowWeights)!) : null,
      estimated_exercise_calories: s.estimated_exercise_calories,
      workouts: s.workouts.count,
    };
  });

  const weekMap = new Map<string, DailySummary[]>();
  for (const s of summaries) {
    const w = weekStart(s.date);
    weekMap.set(w, [...(weekMap.get(w) ?? []), s]);
  }
  const weeks: TrendWeek[] = [...weekMap.entries()].map(([week_start, ds]) => {
    const calorieDays = ds.filter((d) => d.food.nutrient_complete.calories);
    const proteinDays = ds.filter((d) => d.food.nutrient_complete.protein_g);
    const steps = ds.map((d) => d.steps).filter((v): v is number => v != null);
    return {
      week_start,
      from: ds[0].date,
      to: ds[ds.length - 1].date,
      partial_week: ds.length < 7,
      days_logged: ds.filter((d) => d.food.entries > 0).length,
      calorie_days: calorieDays.length,
      protein_days: proteinDays.length,
      avg_calories: avgOf(calorieDays.map((d) => d.food.totals.calories)).value,
      avg_protein_g: avgOf(proteinDays.map((d) => d.food.totals.protein_g)).value,
      avg_steps: avgOf(steps).value,
      workouts: ds.reduce((a, d) => a + d.workouts.count, 0),
      cardio_sessions: ds.reduce((a, d) => a + d.cardio.count, 0),
    };
  });

  const adherence: Adherence = {
    days: summaries.length,
    days_logged: days.filter((d) => d.logged).length,
    days_complete: days.filter((d) => d.complete).length,
    avg_calories: avgOf(summaries.filter((s) => s.food.nutrient_complete.calories).map((s) => s.food.totals.calories)),
    avg_protein_g: avgOf(summaries.filter((s) => s.food.nutrient_complete.protein_g).map((s) => s.food.totals.protein_g)),
    calorie: { on_target: 0, evaluated: 0 },
    protein: { hit: 0, evaluated: 0 },
    steps: { hit: 0, evaluated: 0 },
    workouts: summaries.reduce((a, d) => a + d.workouts.count, 0),
    cardio_sessions: summaries.reduce((a, d) => a + d.cardio.count, 0),
  };
  for (const d of days) {
    if (d.nutrient_complete.calories && d.calorie_target) {
      adherence.calorie.evaluated++;
      if (meetsTarget("calories", d.calories!, d.calorie_target)) adherence.calorie.on_target++;
    }
    if (d.nutrient_complete.protein_g && d.protein_target) {
      adherence.protein.evaluated++;
      if (meetsTarget("protein_g", d.protein_g!, d.protein_target)) adherence.protein.hit++;
    }
    if (d.steps != null && d.steps_target) {
      adherence.steps.evaluated++;
      if (meetsTarget("steps", d.steps, d.steps_target)) adherence.steps.hit++;
    }
  }

  const weighIns = days.filter((d) => d.weight_kg != null);
  const averages = days.filter((d) => d.weight_avg7 != null);
  const weight: WeightStats = {
    first: weighIns.length ? { date: weighIns[0].date, kg: weighIns[0].weight_kg! } : null,
    last: weighIns.length ? { date: weighIns.at(-1)!.date, kg: weighIns.at(-1)!.weight_kg! } : null,
    weigh_ins: weighIns.length,
    trend_change_kg:
      weighIns.length >= 2 && averages.length >= 2 ? round1(averages.at(-1)!.weight_avg7! - averages[0].weight_avg7!) : null,
    min_kg: weighIns.length ? Math.min(...weighIns.map((d) => d.weight_kg!)) : null,
    max_kg: weighIns.length ? Math.max(...weighIns.map((d) => d.weight_kg!)) : null,
  };

  return { days, weeks, adherence, weight };
}

export async function getTrends(ownerId: string, from: string, to: string): Promise<Trends> {
  const all = await computeDailySummaries(ownerId, addDays(from, -6), to);
  return buildTrends(all.slice(6), all.slice(0, 6));
}
