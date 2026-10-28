import { describe, expect, it } from "vitest";
import { buildContextPackage } from "@/lib/server/export";
import { computeDailySummaries } from "@/lib/server/summary";
import { addDays, isValidDateString, monthRange, todayInTimeZone } from "@/lib/shared/dates";
import { estimateOneRepMax, normalizeExerciseName } from "@/lib/shared/exercise";
import { createBareOwner, importOk } from "./helpers/factory";

describe("daily totals", () => {
  it("sums known values, flags unknowns, and never counts unknown as zero", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      date: "2026-10-27",
      food_entries: [
        { name: "Oats", calories: 300, protein_g: 10, carbs_g: 50, fat_g: 6, fiber_g: 8 },
        { name: "Curry (unknown)", protein_g: 25 },
      ],
    });
    const [s] = await computeDailySummaries(owner, "2026-10-27", "2026-10-27");
    expect(s.food.entries).toBe(2);
    expect(s.food.totals).toEqual({ calories: 300, protein_g: 35, carbs_g: 50, fat_g: 6, fiber_g: 8 });
    expect(s.food.missing).toEqual({ calories: 1, protein_g: 0, carbs_g: 1, fat_g: 1, fiber_g: 1 });
    expect(s.food.complete).toBe(false);
    expect(s.food.incomplete_entries).toBe(1);
  });

  it("keeps exercise estimates separate from intake", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      date: "2026-10-27",
      food_entries: [{ name: "Rice", calories: 400 }],
      workouts: [{ name: "Legs", estimated_calories: 250 }],
      cardio_sessions: [{ activity: "Run", estimated_calories: 300, distance_km: 5, duration_min: 28 }],
    });
    const [s] = await computeDailySummaries(owner, "2026-10-27", "2026-10-27");
    expect(s.food.totals.calories).toBe(400);
    expect(s.estimated_exercise_calories).toBe(550);
    expect(s.cardio).toMatchObject({ count: 1, distance_km: 5, duration_min: 28 });
  });

  it("uses the target version in effect on each date", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      targets: [
        { effective_from: "2026-10-01", calories: 2400 },
        { effective_from: "2026-10-15", calories: 2100 },
      ],
    });
    const days = await computeDailySummaries(owner, "2026-09-30", "2026-10-16");
    expect(days[0].targets).toBeNull();
    expect(days.find((d) => d.date === "2026-10-14")!.targets!.calories).toBe(2400);
    expect(days.find((d) => d.date === "2026-10-15")!.targets!.calories).toBe(2100);
  });

  it("an empty day has no data and zero entries", async () => {
    const owner = await createBareOwner("a");
    const [s] = await computeDailySummaries(owner, "2026-10-27", "2026-10-27");
    expect(s).toMatchObject({ has_data: false, steps: null, weight_kg: null, estimated_exercise_calories: null });
  });
});

describe("context package", () => {
  it("is concise and contains purpose, rules, targets and latest progress", async () => {
    const owner = await createBareOwner("a");
    const today = todayInTimeZone("Asia/Kolkata");
    await importOk(owner, {
      schema_version: "1.0",
      date: today,
      targets: [{ effective_from: addDays(today, -30), calories: 2200, protein_g: 160 }],
      food_entries: Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, name: `Food number ${i}`, calories: 50 })),
      daily_activity: [{ steps: 7000, weight_kg: 79.5 }],
    });
    const text = await buildContextPackage(owner);
    expect(text).toContain("schema_version");
    expect(text).toContain("reuse its exact existing id");
    expect(text).toContain("ask me to export the relevant day or month");
    expect(text).toContain("calories 2200 kcal");
    expect(text).toContain("Calories: 2000 kcal / target 2200 kcal");
    expect(text).toContain("Latest weight: 79.5 kg");
    expect(text).toContain("ask me to upload a JSON export");
    // Detailed history is not embedded.
    expect(text).not.toContain("Food number 7");
    expect(text.length).toBeLessThan(8000);
  });
});

describe("shared helpers", () => {
  it("dates", () => {
    expect(isValidDateString("2024-02-29")).toBe(true);
    expect(isValidDateString("2026-02-29")).toBe(false);
    expect(isValidDateString("2026-1-01")).toBe(false);
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // 20:00 UTC on Oct 27 is already Oct 28 in India.
    expect(todayInTimeZone("Asia/Kolkata", new Date("2026-10-27T20:00:00Z"))).toBe("2026-10-28");
    expect(todayInTimeZone("Asia/Kolkata", new Date("2026-10-27T18:00:00Z"))).toBe("2026-10-27");
  });

  it("exercise names and 1RM", () => {
    expect(normalizeExerciseName("  Bench-Press ")).toBe("bench press");
    expect(normalizeExerciseName("BENCH  press")).toBe("bench press");
    expect(estimateOneRepMax(100, 5)).toBe(116.7);
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(null, 5)).toBeNull();
    expect(estimateOneRepMax(100, 20)).toBeNull();
  });
});
