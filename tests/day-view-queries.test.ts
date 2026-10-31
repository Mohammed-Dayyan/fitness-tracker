import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/server/db";
import { getDayView } from "@/lib/server/day";
import { createBareOwner, importOk } from "./helpers/factory";

describe("Today's data load", () => {
  async function seed() {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      targets: [{ effective_from: "2026-09-01", calories: 2000 }],
      food_entries: [
        { id: "f1", date: "2026-10-27", name: "Today oats", meal: "Breakfast", time: "08:00", calories: 400 },
        { id: "f2", date: "2026-10-27", name: "Today rice", meal: "Lunch", time: "13:00", calories: 700 },
        { id: "f3", date: "2026-10-26", name: "Yesterday pasta", calories: 900 },
        { id: "f4", date: "2026-10-21", name: "Six days ago", calories: 500 },
        { id: "f5", date: "2026-10-20", name: "Outside the week", calories: 500 },
      ],
      workouts: [
        { id: "w1", date: "2026-10-27", name: "Push", sets: [{ id: "s1", exercise: "Bench", set_number: 1, reps: 5, weight_kg: 60 }] },
        { id: "w2", date: "2026-10-26", name: "Pull" },
      ],
      cardio_sessions: [{ id: "c1", date: "2026-10-27", activity: "Run", duration_min: 30 }, { id: "c2", date: "2026-10-25", activity: "Bike" }],
      body_measurements: [{ id: "m1", date: "2026-10-27", waist_cm: 84 }, { id: "m2", date: "2026-10-24", waist_cm: 85 }],
      daily_notes: [{ date: "2026-10-27", text: "Felt good" }, { date: "2026-10-26", text: "Old note" }],
      daily_activity: [{ date: "2026-10-27", steps: 7000, weight_kg: 79 }, { date: "2026-10-26", steps: 3000 }],
    });
    return owner;
  }
  const ctx = { timezone: "Asia/Kolkata", today: "2026-10-27", msUntilNextDay: 1000 };

  it("reads each table once for the whole week instead of again for the day", async () => {
    const owner = await seed();
    const spies = {
      food: vi.spyOn(prisma.foodEntry, "findMany"),
      workouts: vi.spyOn(prisma.workoutSession, "findMany"),
      cardio: vi.spyOn(prisma.cardioSession, "findMany"),
      measurements: vi.spyOn(prisma.bodyMeasurement, "findMany"),
      notes: vi.spyOn(prisma.dailyNote, "findMany"),
      activity: vi.spyOn(prisma.dailyActivity, "findMany"),
      targets: vi.spyOn(prisma.targetSet, "findMany"),
    };
    await getDayView(owner, "2026-10-27", ctx);
    for (const [name, spy] of Object.entries(spies)) expect(spy, name).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("the day's own lists contain only that day's records, in order, and the week still covers 7 days", async () => {
    const owner = await seed();
    const v = await getDayView(owner, "2026-10-27", ctx);
    expect(v.meals.map((m) => [m.label, m.entries.map((e) => e.name)])).toEqual([["Breakfast", ["Today oats"]], ["Lunch", ["Today rice"]]]);
    expect(v.workouts.map((w) => w.name)).toEqual(["Push"]);
    expect((v.workouts[0].sets as unknown[]).length).toBe(1);
    expect(v.cardio.map((c) => c.activity)).toEqual(["Run"]);
    expect(v.measurements.map((m) => m.id)).toEqual(["m1"]);
    expect(v.note).toBe("Felt good");
    expect(v.summary).toMatchObject({ date: "2026-10-27", steps: 7000, weight_kg: 79 });
    expect(v.summary.food.totals.calories).toBe(1100);
    expect(v.week.map((d) => d.date)).toEqual(["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
    expect(v.week[0].food.totals.calories).toBe(500); // six days ago is inside the week
    expect(v.week.some((d) => d.date === "2026-10-20")).toBe(false); // the day before the window is not
  });

  it("a day with nothing recorded gets empty lists and no note", async () => {
    const owner = await seed();
    const v = await getDayView(owner, "2026-10-23", { ...ctx, today: "2026-10-27" });
    expect(v.meals).toEqual([]);
    expect([v.workouts, v.cardio, v.measurements]).toEqual([[], [], []]);
    expect(v.note).toBeNull();
  });
});
