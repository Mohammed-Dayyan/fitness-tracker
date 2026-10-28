import { describe, expect, it } from "vitest";
import { buildMealTimeline, getDayView } from "@/lib/server/day";
import { buildExerciseHistory, buildExerciseStats, getSetRows } from "@/lib/server/exercises";
import { computeDailySummaries, type DailySummary } from "@/lib/server/summary";
import { buildTrends, getTrends, weekStart } from "@/lib/server/trends";
import { dailyVerdict } from "@/lib/server/verdict";
import { eachDay } from "@/lib/shared/dates";
import { createBareOwner, importOk } from "./helpers/factory";

const targets = { effective_from: "2026-10-01", calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, fiber_g: 30, steps: 8000 };

async function dayWith(foods: object[], extra: object = {}, date = "2026-10-20") {
  const owner = await createBareOwner("a");
  await importOk(owner, { schema_version: "1.0", date, targets: [targets], food_entries: foods, ...extra });
  const [s] = await computeDailySummaries(owner, date, date);
  return { owner, s };
}

const complete = (cal: number, p: number, c = 200, f = 60, fi = 30) => ({ name: "Meal", calories: cal, protein_g: p, carbs_g: c, fat_g: f, fiber_g: fi });

describe("daily verdict", () => {
  const T = "2026-10-27"; // "today" for these tests; most data is on the 20th (a finished day)

  it("no data: nothing logged", async () => {
    const owner = await createBareOwner("a");
    const [s] = await computeDailySummaries(owner, "2026-10-20", "2026-10-20");
    expect(dailyVerdict(s, T)).toMatchObject({ status: "no_data", headline: "Nothing logged for this day." });
  });

  it("in progress when no targets exist: names the food logged and asks for targets", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", date: "2026-10-20", food_entries: [complete(1996, 100)] });
    const [s] = await computeDailySummaries(owner, "2026-10-20", "2026-10-20");
    const v = dailyVerdict(s, T);
    expect(v.status).toBe("in_progress");
    expect(v.headline).toBe("Food logged: 1,996 kcal. Set daily targets to assess progress.");
    expect(v.targetsSet).toBe(false);
    expect(v.actions).toContain("Set your daily targets");
    expect(v.checks.every((c) => c.status === "no_target" && c.detail === "Target not set")).toBe(true);
  });

  it("on target only with complete nutrition and every targeted nutrient within range", async () => {
    const { s } = await dayWith([complete(1000, 80, 100, 30, 15), complete(1000, 75, 100, 30, 15)], {
      daily_activity: { steps: 9000, weight_kg: 80 },
    });
    const v = dailyVerdict(s, T);
    expect(v.status).toBe("on_target");
    expect(v.headline).toBe("Calories are within your target range. Protein target met.");
    expect(v.confidence).toBe("high");
  });

  it("under target: lists what is off (here only protein); the amount is in the measure's detail", async () => {
    const { s } = await dayWith([complete(2000, 130, 200, 60, 30)]);
    const v = dailyVerdict(s, T);
    expect(v.status).toBe("under");
    expect(v.headline).toBe("Protein is under target.");
    expect(v.off).toEqual({ under: ["protein_g"], over: [] });
    expect(v.checks.find((c) => c.key === "protein_g")!.detail).toBe("20 g under target");
  });

  it("over target for a large calorie excess, with the amount in the detail", async () => {
    const { s } = await dayWith([complete(2600, 160)]);
    const v = dailyVerdict(s, T);
    expect(v.status).toBe("over");
    expect(v.headline).toBe("Calories are over target.");
    expect(v.checks.find((c) => c.key === "calories")!.detail).toBe("600 kcal over target");
  });

  it("incomplete data: unknown values are never a shortfall", async () => {
    const { s } = await dayWith([complete(1500, 100), { name: "Unknown curry", calories: 400 }]);
    const v = dailyVerdict(s, T);
    expect(v.status).toBe("incomplete");
    expect(v.headline).toBe("Some nutrient totals are incomplete because 1 food needs details.");
    expect(v.partialNutrients).toEqual(["protein_g", "carbs_g", "fat_g", "fiber_g"]);
    const protein = v.checks.find((c) => c.key === "protein_g")!;
    expect(protein.status).toBe("unknown");
    expect(protein.detail).toBe("At least 100 g; 1 entry needs details");
    expect(v.confidence).toBe("low");
    expect(v.actions[0]).toBe("Add missing protein, carbs, fat, fiber details to 1 food entry");
  });

  it("a reliable excess still counts even when other entries are unknown", async () => {
    const { s } = await dayWith([complete(2500, 100), { name: "Unknown dessert" }]);
    const v = dailyVerdict(s, T);
    expect(v.status).toBe("over");
    expect(v.headline).toBe("Calories are over target. Protein, carbs, fat and fiber totals are incomplete.");
    expect(v.checks.find((c) => c.key === "calories")).toMatchObject({ status: "high", detail: "500 kcal over target (at least)" });
  });

  it("a past day with activity but no food is incomplete, not on track", async () => {
    const { s } = await dayWith([], { daily_activity: { steps: 9000 } });
    const v = dailyVerdict(s, T);
    expect(v.status).toBe("incomplete");
    expect(v.headline).toBe("No food logged, so nutrition can't be assessed.");
  });

  it("today is in progress: shortfalls are 'to go', not failures", async () => {
    const { s } = await dayWith([complete(800, 50)], { daily_activity: { steps: 3000 } }, T);
    const v = dailyVerdict(s, T);
    expect(v.status).toBe("in_progress");
    expect(v.headline).toBe("800 of 2,000 kcal so far.");
    expect(v.checks.find((c) => c.key === "protein_g")!.status).toBe("remaining");
    expect(v.actions).toContain("About 1,200 kcal left for today");
  });

  it("missing steps on a target day is a next step, not a failure", async () => {
    const { s } = await dayWith([complete(2000, 150)]);
    const v = dailyVerdict(s, T);
    expect(v.status).toBe("on_target");
    expect(v.checks.find((c) => c.key === "steps")).toMatchObject({ status: "no_data", detail: "Not recorded" });
    expect(v.actions).toContain("Log steps if available");
  });

  it("explains estimates in the confidence note", async () => {
    const { s } = await dayWith([{ ...complete(2000, 150), estimated: true }, { ...complete(0, 0, 0, 0, 0), name: "Water" }]);
    const v = dailyVerdict(s, T);
    expect(v.confidence).toBe("medium");
    expect(v.confidenceNote).toBe("1 of 2 food entries are estimates; treat totals as approximate.");
  });

  it("never subtracts exercise calories from intake", async () => {
    const { s } = await dayWith([complete(2150, 150)], { workouts: [{ name: "Legs", estimated_calories: 500 }] });
    const v = dailyVerdict(s, T);
    expect(v.checks.find((c) => c.key === "calories")!.actual).toBe(2150);
    expect(s.estimated_exercise_calories).toBe(500);
  });

  it("future days are not judged", async () => {
    const { s } = await dayWith([complete(500, 20)]);
    expect(dailyVerdict(s, "2026-10-19").status).toBe("future");
  });
});

describe("meal timeline", () => {
  it("groups free-text meals case-insensitively and orders by time", () => {
    const groups = buildMealTimeline([
      { id: "1", name: "Shake", meal: "Post-workout meal", time: "19:00", calories: 200, protein_g: 40, carbs_g: 5, fat_g: 2, fiber_g: 0 },
      { id: "2", name: "Oats", meal: "breakfast", time: "08:00", calories: 300, protein_g: 10, carbs_g: 50, fat_g: 6, fiber_g: 8 },
      { id: "3", name: "Banana", meal: "Breakfast", time: null, calories: 100, protein_g: 1, carbs_g: 25, fat_g: 0, fiber_g: 3 },
      { id: "4", name: "Biscuit", meal: null, time: null, calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["breakfast", "Post-workout meal", "Other"]);
    expect(groups[0].entries.map((e) => e.name)).toEqual(["Oats", "Banana"]);
    expect(groups[0].totals.calories).toBe(400);
    expect(groups[2].incomplete).toBe(1);
  });
});

describe("trends and adherence", () => {
  it("computes adherence only on complete, targeted days", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      targets: [targets],
      food_entries: [
        { ...complete(2000, 150), date: "2026-10-05" }, // on target
        { ...complete(2600, 100), date: "2026-10-06" }, // over, protein low
        { name: "Unknown", date: "2026-10-07" }, // incomplete: excluded
      ],
      daily_activity: [
        { date: "2026-10-05", steps: 9000, weight_kg: 80 },
        { date: "2026-10-06", steps: 4000, weight_kg: 80.4 },
        { date: "2026-10-11", weight_kg: 79.6 },
      ],
      workouts: [{ date: "2026-10-05", name: "Push" }],
    });
    const t = await getTrends(owner, "2026-10-05", "2026-10-11");
    expect(t.adherence).toMatchObject({
      days: 7,
      days_logged: 3,
      days_complete: 2,
      calorie: { on_target: 1, evaluated: 2 },
      protein: { hit: 1, evaluated: 2 },
      steps: { hit: 1, evaluated: 2 },
      workouts: 1,
    });
    expect(t.weight).toMatchObject({ weigh_ins: 3, first: { date: "2026-10-05", kg: 80 }, last: { date: "2026-10-11", kg: 79.6 }, min_kg: 79.6, max_kg: 80.4 });
    // 7-day average on the 11th covers all three weigh-ins.
    expect(t.days.at(-1)!.weight_avg7).toBe(80);
    expect(t.days.find((d) => d.date === "2026-10-07")!.calories).toBe(0);
    expect(t.days.find((d) => d.date === "2026-10-08")!.calories).toBeNull();
    expect(t.weeks.map((w) => w.week_start)).toEqual(["2026-10-05"]);
  });

  it("weight average looks back before the range start", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      daily_activity: [
        { date: "2026-10-01", weight_kg: 82 },
        { date: "2026-10-03", weight_kg: 80 },
      ],
    });
    const t = await getTrends(owner, "2026-10-03", "2026-10-04");
    expect(t.days[0].weight_avg7).toBe(81);
  });

  it("weeks start on Monday", () => {
    expect(weekStart("2026-10-27")).toBe("2026-10-26"); // Tuesday -> Monday
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // Sunday -> previous Monday
    expect(buildTrends([] as DailySummary[]).days).toEqual([]);
  });
});

describe("exercise history and PRs", () => {
  it("tracks max weight, estimated 1RM and max reps across sessions", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      workouts: [
        { id: "w1", date: "2026-10-01", name: "Push", sets: [
          { exercise: "Bench Press", set_number: 1, reps: 5, weight_kg: 80 },
          { exercise: "Bench Press", set_number: 2, reps: 12, weight_kg: 50 },
        ] },
        { id: "w2", date: "2026-10-08", name: "Push", sets: [
          { exercise: "bench press", set_number: 1, reps: 2, weight_kg: 85 },
          { exercise: "Pull-up", set_number: 1, reps: 15, weight_kg: null },
        ] },
        { id: "w3", date: "2026-10-15", name: "Push", sets: [{ exercise: "Bench-Press", set_number: 1, reps: 5, weight_kg: 75 }] },
      ],
    });
    const stats = buildExerciseStats(await getSetRows(owner));
    const bench = stats.find((s) => s.key === "bench press")!;
    expect(bench).toMatchObject({ name: "Bench-Press", sessions: 3, sets: 4, last_date: "2026-10-15" });
    expect(bench.prs.max_weight).toEqual({ kg: 85, reps: 2, date: "2026-10-08" });
    expect(bench.prs.best_e1rm).toEqual({ kg: 93.3, weight_kg: 80, reps: 5, date: "2026-10-01" });
    expect(bench.prs.max_reps).toEqual({ reps: 12, weight_kg: 50, date: "2026-10-01" });
    const pullup = stats.find((s) => s.key === "pull up")!;
    expect(pullup.prs).toMatchObject({ max_weight: null, best_e1rm: null, max_reps: { reps: 15, weight_kg: null } });

    const history = buildExerciseHistory(await getSetRows(owner, "bench press"));
    expect(history.map((h) => [h.date, h.new_pr])).toEqual([
      ["2026-10-15", false],
      ["2026-10-08", true],
      ["2026-10-01", true],
    ]);
    expect(history[2].volume_kg).toBe(1000);
  });
});

describe("data integrity: views always reflect stored records", () => {
  it("moving, correcting and deleting entries updates every derived view", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      date: "2026-10-20",
      targets: [targets],
      food_entries: [
        { id: "f1", ...complete(600, 40) },
        { id: "f2", ...complete(400, 30) },
      ],
    });
    let day = await getDayView(owner, "2026-10-20");
    expect(day.summary.food.totals.calories).toBe(1000);

    // Move f2 to the next day with the same ID.
    await importOk(owner, { schema_version: "1.0", food_entries: [{ id: "f2", date: "2026-10-21" }] });
    day = await getDayView(owner, "2026-10-20");
    const next = await getDayView(owner, "2026-10-21");
    expect(day.summary.food.totals.calories).toBe(600);
    expect(next.summary.food.totals.calories).toBe(400);

    // Correct f1's calories; delete f2.
    await importOk(owner, { schema_version: "1.0", food_entries: [{ id: "f1", calories: 700 }], delete: { food_entries: ["f2"] } });
    const trends = await getTrends(owner, "2026-10-20", "2026-10-21");
    expect(trends.days.map((d) => d.calories)).toEqual([700, null]);

    // A re-import containing a stale "summary" never overrides computed totals.
    await importOk(owner, { schema_version: "1.0", date: "2026-10-20", summary: { calories: 5000 } });
    expect((await getDayView(owner, "2026-10-20")).summary.food.totals.calories).toBe(700);
  });

  it("totals across a month equal the sum of the stored entries", async () => {
    const owner = await createBareOwner("a");
    const dates = eachDay("2026-09-01", "2026-09-30");
    await importOk(owner, {
      schema_version: "1.0",
      food_entries: dates.flatMap((date, i) => [
        { id: `a${i}`, date, name: "A", calories: 100 + i, protein_g: 10 },
        { id: `b${i}`, date, name: "B", calories: 200, protein_g: 5 },
      ]),
    });
    const t = await getTrends(owner, "2026-09-01", "2026-09-30");
    const total = t.days.reduce((a, d) => a + (d.calories ?? 0), 0);
    expect(total).toBe(dates.reduce((a, _, i) => a + 100 + i + 200, 0));
  });
});
