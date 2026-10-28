import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { exportData } from "@/lib/server/export";
import { eachDay } from "@/lib/shared/dates";
import { createBareOwner, importOk } from "./helpers/factory";

function monthOfHistory() {
  const days = eachDay("2026-09-01", "2026-09-30");
  return {
    schema_version: "1.0",
    targets: [{ id: "t-sep", effective_from: "2026-09-01", calories: 2200, protein_g: 160, carbs_g: 220, fat_g: 70, fiber_g: 30, steps: 9000, goal_weight_kg: 75 }],
    food_entries: days.flatMap((date, d) =>
      ["breakfast", "lunch", "evening snack", "dinner"].map((meal, m) => ({
        id: `food-${d}-${m}`,
        date,
        name: `Meal ${m}`,
        meal,
        calories: 500,
        protein_g: 40,
        carbs_g: 50,
        fat_g: 15,
        fiber_g: 8,
      })),
    ),
    workouts: days
      .filter((_, i) => i % 2 === 0)
      .map((date, i) => ({
        id: `wo-${i}`,
        date,
        name: "Full body",
        estimated_calories: 250,
        sets: [1, 2, 3].map((n) => ({ id: `set-${i}-${n}`, exercise: "Squat", set_number: n, reps: 5, weight_kg: 100 + i })),
      })),
    daily_activity: days.map((date, i) => ({ id: `act-${date}`, date, steps: 8000 + i * 100, weight_kg: 80 - i * 0.1 })),
  };
}

describe("bulk imports", () => {
  it("imports a full month across many dates in one go", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, monthOfHistory());
    // 1 target + 120 foods + 15 workouts + 45 sets + 30 activity
    expect(res.counts).toEqual({ created: 211, updated: 0, unchanged: 0, deleted: 0, rejected: 0 });
    expect(await prisma.foodEntry.count({ where: { ownerId: owner } })).toBe(120);
    expect(await prisma.exerciseSet.count({ where: { ownerId: owner } })).toBe(45);
  });

  it("re-importing the month is fully unchanged; editing one record updates only that record", async () => {
    const owner = await createBareOwner("a");
    const payload = monthOfHistory();
    await importOk(owner, payload);
    expect((await importOk(owner, payload)).counts.unchanged).toBe(211);

    payload.food_entries[10].calories = 650;
    const res = await importOk(owner, payload);
    expect(res.counts).toMatchObject({ updated: 1, unchanged: 210 });
  });

  it("applies valid records and reports invalid ones in a mixed bulk payload", async () => {
    const owner = await createBareOwner("a");
    const payload = monthOfHistory();
    (payload.food_entries[3] as Record<string, unknown>).calories = "lots";
    (payload.food_entries[7] as Record<string, unknown>).extra = 1;
    const res = await importOk(owner, payload);
    expect(res.counts).toMatchObject({ created: 209, rejected: 2 });
    expect(res.errors).toHaveLength(2);
  });
});

describe("export round trip", () => {
  it("exports in import format; re-importing the export changes nothing", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { ...monthOfHistory(), profile: { name: "Sam", height_cm: 180 } });
    const exported = await exportData(owner, { scope: "all" });
    const res = await importOk(owner, exported);
    expect(res.counts).toMatchObject({ created: 0, updated: 0, rejected: 0, unchanged: 212 });
  });

  it("an export imported into another owner reproduces the data with the same IDs", async () => {
    const a = await createBareOwner("a");
    const b = await createBareOwner("b");
    await importOk(a, monthOfHistory());
    const exported = await exportData(a, { scope: "month", month: "2026-09" });
    await importOk(b, exported);
    const again = await exportData(b, { scope: "month", month: "2026-09" });
    const strip = (e: Record<string, unknown>) => ({ ...e, export_meta: undefined });
    expect(strip(again)).toEqual(strip(exported));
  });

  it("day and range exports contain only that period plus daily totals", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, monthOfHistory());
    const dayExport = await exportData(owner, { scope: "day", date: "2026-09-10" });
    expect(dayExport.food_entries).toHaveLength(4);
    expect(dayExport.export_meta.daily_totals).toEqual([
      expect.objectContaining({ date: "2026-09-10", calories: 2000, protein_g: 160, nutrition_complete: true }),
    ]);
    const range = await exportData(owner, { scope: "range", from: "2026-09-01", to: "2026-09-07" });
    expect(range.food_entries).toHaveLength(28);
    expect(range.targets).toHaveLength(1);
  });
});
