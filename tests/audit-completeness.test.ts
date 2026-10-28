import { describe, expect, it } from "vitest";
import { exportData } from "@/lib/server/export";
import { computeDailySummaries, NUTRIENTS, type Nutrient } from "@/lib/server/summary";
import { getTrends } from "@/lib/server/trends";
import { dailyVerdict } from "@/lib/server/verdict";
import { eachDay } from "@/lib/shared/dates";
import { meetsTarget, ratioStatus } from "@/lib/shared/targets-policy";
import { resolveTrendRange } from "@/lib/shared/trend-range";
import { createBareOwner, importOk } from "./helpers/factory";

const TODAY = "2026-10-27";
const TARGETS = { effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, fiber_g: 30 };
const FULL = { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, fiber_g: 30 };

describe("audit #6: nutrient completeness is tracked per nutrient (all 32 combinations)", () => {
  // Day i has one complete entry at exactly the targets, plus a second entry
  // that lacks the nutrients in subset i (and has an explicit 0 for the rest).
  const dates = eachDay("2026-08-01", "2026-09-01"); // 32 days
  const missingIn = (i: number) => NUTRIENTS.filter((_, bit) => (i >> bit) & 1);

  async function seeded() {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      targets: [TARGETS],
      food_entries: dates.flatMap((date, i) => {
        const gaps = new Set<Nutrient>(missingIn(i));
        const second: Record<string, unknown> = { id: `b-${i}`, date, name: "Second" };
        for (const n of NUTRIENTS) if (!gaps.has(n)) second[n] = 0;
        return [{ id: `a-${i}`, date, name: "Main", ...FULL }, second];
      }),
    });
    return owner;
  }

  it("flags, verdict checks and adherence follow each nutrient independently", async () => {
    const owner = await seeded();
    const summaries = await computeDailySummaries(owner, dates[0], dates.at(-1)!);
    const trends = await getTrends(owner, dates[0], dates.at(-1)!);
    expect(summaries).toHaveLength(32);

    summaries.forEach((s, i) => {
      const gaps = new Set<Nutrient>(missingIn(i));
      for (const n of NUTRIENTS) {
        expect(s.food.nutrient_complete[n], `day ${i} ${n}`).toBe(!gaps.has(n));
        expect(trends.days[i].nutrient_complete[n]).toBe(!gaps.has(n));
        // Unknown never turns into zero: the known part of the total is intact.
        expect(s.food.totals[n]).toBe(FULL[n]);
      }
      expect(s.food.complete).toBe(gaps.size === 0);

      const v = dailyVerdict(s, TODAY);
      for (const n of NUTRIENTS) {
        expect(v.checks.find((c) => c.key === n)!.status, `day ${i} ${n}`).toBe(gaps.has(n) ? "unknown" : "ok");
      }
      expect(v.status).toBe(gaps.size === 0 ? "on_target" : "incomplete");
      expect(v.partialNutrients).toEqual([...gaps]);
    });

    // Calories: evaluated on every day where calories are known, regardless of other gaps.
    const calorieDays = summaries.filter((s) => s.food.nutrient_complete.calories).length;
    const proteinDays = summaries.filter((s) => s.food.nutrient_complete.protein_g).length;
    expect(calorieDays).toBe(16);
    expect(trends.adherence.calorie).toEqual({ on_target: 16, evaluated: 16 });
    expect(trends.adherence.protein).toEqual({ hit: 16, evaluated: 16 });
    expect(trends.adherence.avg_calories).toEqual({ value: 2000, days: calorieDays });
    expect(trends.adherence.avg_protein_g).toEqual({ value: 150, days: proteinDays });
    expect(trends.adherence.days_complete).toBe(1); // only the no-gap day has all five nutrients
  });

  it("calories known but fiber unknown: calorie adherence and average still count the day", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      date: "2026-09-10",
      targets: [TARGETS],
      food_entries: [
        { id: "f1", name: "Meal", calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, fiber_g: 30 },
        { id: "f2", name: "Snack", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, // fiber unknown
      ],
    });
    const t = await getTrends(owner, "2026-09-10", "2026-09-10");
    expect(t.adherence.calorie).toEqual({ on_target: 1, evaluated: 1 });
    expect(t.adherence.protein).toEqual({ hit: 1, evaluated: 1 });
    expect(t.adherence.avg_calories).toEqual({ value: 2000, days: 1 });
    expect(t.weeks[0]).toMatchObject({ calorie_days: 1, protein_days: 1, avg_calories: 2000, avg_protein_g: 150 });
    const [s] = await computeDailySummaries(owner, "2026-09-10", "2026-09-10");
    const v = dailyVerdict(s, TODAY);
    expect(v.checks.find((c) => c.key === "calories")!.status).toBe("ok");
    expect(v.headline).toBe("Fiber total is incomplete because 1 food is missing fiber.");
  });

  it("an unknown nutrient does not hide a real miss in another one", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      date: "2026-09-10",
      targets: [TARGETS],
      food_entries: [{ name: "Meal", calories: 2000, protein_g: 100, carbs_g: 200, fat_g: 60 }], // fiber unknown, protein low
    });
    const [s] = await computeDailySummaries(owner, "2026-09-10", "2026-09-10");
    const v = dailyVerdict(s, TODAY);
    expect(v.status).toBe("under");
    expect(v.headline).toBe("Protein is under target. Fiber total is incomplete.");
    expect(v.checks.find((c) => c.key === "protein_g")!.detail).toBe("50 g under target");
  });

  it("exports mark exactness per nutrient", async () => {
    const owner = await seeded();
    const day = await exportData(owner, { scope: "day", date: dates[1] }); // i=1 → calories unknown
    expect(day.export_meta.daily_totals![0]).toMatchObject({ nutrition_complete: false, entries_missing: { calories: 1, protein_g: 0, fiber_g: 0 } });
    const clean = await exportData(owner, { scope: "day", date: dates[0] });
    expect(clean.export_meta.daily_totals![0]).toMatchObject({ nutrition_complete: true });
  });
});

describe("audit #4: one shared 'within target' rule", () => {
  it("boundaries are inclusive and identical for every consumer", () => {
    expect(ratioStatus("steps", 7199, 8000)).toBe("low");
    expect(ratioStatus("steps", 7200, 8000)).toBe("ok"); // exactly 90%
    expect(ratioStatus("steps", 12000, 8000)).toBe("ok"); // no upper limit
    expect(ratioStatus("calories", 1799, 2000)).toBe("low");
    expect(ratioStatus("calories", 1800, 2000)).toBe("ok");
    expect(ratioStatus("calories", 2200, 2000)).toBe("ok");
    expect(ratioStatus("calories", 2201, 2000)).toBe("high");
    expect(ratioStatus("carbs_g", 160, 200)).toBe("ok");
    expect(ratioStatus("carbs_g", 241, 200)).toBe("high");
    expect(ratioStatus("fiber_g", 24, 30)).toBe("ok");
    expect(ratioStatus("fiber_g", 23, 30)).toBe("low");
    expect(meetsTarget("protein_g", 135, 150)).toBe(true);
    expect(meetsTarget("protein_g", 134, 150)).toBe(false);
  });

  it("Today's verdict and Trends agree on a steps target at 89.9%, 90% and 100%", async () => {
    const owner = await createBareOwner("a");
    const cases = [
      ["2026-09-01", 7199, false],
      ["2026-09-02", 7200, true],
      ["2026-09-03", 8000, true],
    ] as const;
    await importOk(owner, {
      schema_version: "1.0",
      targets: [{ effective_from: "2026-01-01", steps: 8000, calories: 2000 }],
      food_entries: cases.map(([date]) => ({ date, name: "x", ...FULL })),
      daily_activity: cases.map(([date, steps]) => ({ date, steps })),
    });
    const summaries = await computeDailySummaries(owner, "2026-09-01", "2026-09-03");
    const trends = await getTrends(owner, "2026-09-01", "2026-09-03");
    summaries.forEach((s, i) => {
      const stepsCheck = dailyVerdict(s, TODAY).checks.find((c) => c.key === "steps")!;
      expect(stepsCheck.status, cases[i][0]).toBe(cases[i][2] ? "ok" : "low");
    });
    expect(trends.adherence.steps).toEqual({ hit: 2, evaluated: 3 });
  });
});

describe("audit #5: a day with no food is never 'complete'", () => {
  it("confidence is 'none', not 'high', and the day is not marked complete", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      targets: [TARGETS],
      daily_activity: [{ date: "2026-09-01", steps: 9000 }],
    });
    const [s] = await computeDailySummaries(owner, "2026-09-01", "2026-09-01");
    expect(s.food.complete).toBe(false);
    expect(Object.values(s.food.nutrient_complete).every((v) => v === false)).toBe(true);
    const v = dailyVerdict(s, TODAY);
    expect(v).toMatchObject({ status: "incomplete", confidence: "none", headline: "No food logged, so nutrition can't be assessed." });
    expect(v.confidenceNote).toBe("No food logged, so nutrition totals aren't available.");
  });

  it("distinguishes high, medium and low confidence", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      targets: [TARGETS],
      food_entries: [
        { date: "2026-09-01", name: "exact", ...FULL },
        { date: "2026-09-02", name: "estimate", ...FULL, estimated: true },
        { date: "2026-09-03", name: "partial", calories: 2000 },
      ],
    });
    const s = await computeDailySummaries(owner, "2026-09-01", "2026-09-03");
    expect(s.map((d) => dailyVerdict(d, TODAY).confidence)).toEqual(["high", "medium", "low"]);
  });

  it("exports report null (not true) for nutrition_complete on a day without food", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", daily_activity: [{ date: "2026-09-01", steps: 100 }] });
    const e = await exportData(owner, { scope: "day", date: "2026-09-01" });
    expect(e.export_meta.daily_totals![0]).toMatchObject({ nutrition_complete: null, entries_missing: null });
  });
});

describe("audit #8: future dates never inflate ranges or denominators", () => {
  it("a custom range ending in the future is cut at today, with a notice", () => {
    const r = resolveTrendRange({ range: "custom", from: "2026-10-01", to: "2026-12-31" }, TODAY);
    expect(r).toMatchObject({ key: "custom", from: "2026-10-01", to: TODAY, error: null });
    expect(r.notice).toBe("Future dates are not included: the range ends today (2026-10-27).");
  });

  it("a range that starts in the future falls back to the last 30 days with an error", () => {
    const r = resolveTrendRange({ range: "custom", from: "2026-11-01", to: "2026-11-30" }, TODAY);
    expect(r).toMatchObject({ key: "30", from: "2026-09-28", to: TODAY });
    expect(r.error).toMatch(/start date is in the future/);
  });

  it("the 366-day limit applies to the days actually shown, so a far-future end date is simply cut at today", () => {
    const r = resolveTrendRange({ range: "custom", from: "2026-10-18", to: "2099-12-31" }, TODAY);
    expect(r).toMatchObject({ key: "custom", from: "2026-10-18", to: TODAY, error: null });
    expect(r.notice).toMatch(/^Future dates are not included/);
    // A genuinely over-long range (even after cutting at today) is still refused.
    expect(resolveTrendRange({ range: "custom", from: "2024-01-01", to: "2099-12-31" }, TODAY).error).toMatch(/at most 366 days/);
  });

  it("valid historical ranges and presets are untouched", () => {
    expect(resolveTrendRange({ range: "custom", from: "2026-09-01", to: "2026-09-30" }, TODAY)).toMatchObject({ from: "2026-09-01", to: "2026-09-30", notice: null, error: null });
    expect(resolveTrendRange({ range: "7" }, TODAY)).toMatchObject({ from: "2026-10-21", to: TODAY });
    expect(resolveTrendRange({ range: "mtd" }, TODAY)).toMatchObject({ from: "2026-10-01", to: TODAY });
    expect(resolveTrendRange({}, TODAY)).toMatchObject({ key: "30" });
    expect(resolveTrendRange({ range: "custom", from: "2026-10-10", to: "2026-10-01" }, TODAY).error).toMatch(/start before end/);
  });

  it("the clamped range yields the real day count, so denominators are not inflated", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", targets: [TARGETS], food_entries: [{ date: "2026-10-05", name: "x", ...FULL }] });
    const r = resolveTrendRange({ range: "custom", from: "2026-10-01", to: "2026-12-31" }, TODAY);
    const t = await getTrends(owner, r.from, r.to);
    expect(t.adherence.days).toBe(27);
    expect(t.days.at(-1)!.date).toBe(TODAY);
    expect(t.days.filter((d) => d.calories === 0)).toHaveLength(0); // unlogged days are null, never zero
  });
});

describe("audit #19: weekly rows show the dates actually included", () => {
  it("partial first and last weeks are labelled with their real range", async () => {
    const owner = await createBareOwner("a");
    const t = await getTrends(owner, "2026-10-08", "2026-10-27"); // Thu → Tue
    expect(t.weeks.map((w) => [w.week_start, w.from, w.to, w.partial_week])).toEqual([
      ["2026-10-05", "2026-10-08", "2026-10-11", true],
      ["2026-10-12", "2026-10-12", "2026-10-18", false],
      ["2026-10-19", "2026-10-19", "2026-10-25", false],
      ["2026-10-26", "2026-10-26", "2026-10-27", true],
    ]);
  });
});
