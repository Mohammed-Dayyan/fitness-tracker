import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { commitImport, previewImport } from "@/lib/server/import";
import { createBareOwner, importOk } from "./helpers/factory";

const chicken = {
  id: "food-a12",
  name: "Chicken breast",
  meal: "Post-workout meal",
  quantity: 150,
  unit: "g",
  weight_basis: "raw",
  calories: 180,
  protein_g: 34,
  carbs_g: 0,
  fat_g: 4,
  fiber_g: 0,
  estimated: true,
};

describe("partial imports", () => {
  it("accepts the spec's example: one food entry, no profile/workout/summary", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, { schema_version: "1.0", date: "2026-10-27", food_entries: [chicken] });
    expect(res.counts).toEqual({ created: 1, updated: 0, unchanged: 0, deleted: 0, rejected: 0 });
    const row = await prisma.foodEntry.findUniqueOrThrow({ where: { ownerId_id: { ownerId: owner, id: "food-a12" } } });
    expect(row.meal).toBe("Post-workout meal");
    expect(row.date.toISOString().slice(0, 10)).toBe("2026-10-27");
    expect(row.weightBasis).toBe("raw");
  });

  it("accepts profile only, as a partial update", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", profile: { height_cm: 178, name: "Sam" } });
    const res = await importOk(owner, { schema_version: "1.0", profile: { goal: "Lean bulk" } });
    expect(res.records[0]).toMatchObject({ kind: "profile", action: "update", changes: ["goal"] });
    const p = await prisma.profile.findUniqueOrThrow({ where: { ownerId: owner } });
    expect(p).toMatchObject({ heightCm: 178, name: "Sam", goal: "Lean bulk", timezone: "Asia/Kolkata" });
  });

  it("accepts steps only and weight only (as single objects)", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", date: "2026-10-27", daily_activity: { steps: 9000 } });
    const res = await importOk(owner, { schema_version: "1.0", date: "2026-10-27", daily_activity: { weight_kg: 78.4 } });
    // One-per-day: the second import updates the same record, keeping steps.
    expect(res.counts.updated).toBe(1);
    const rows = await prisma.dailyActivity.findMany({ where: { ownerId: owner } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ steps: 9000, weightKg: 78.4 });
  });

  it("accepts a workout only, with nested sets, and a cardio session only", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, {
      schema_version: "1.0",
      date: "2026-10-27",
      workouts: [
        {
          id: "wo-1",
          name: "Push",
          sets: [
            { exercise: "Bench Press", set_number: 1, reps: 8, weight_kg: 60, rpe: 8 },
            { exercise: "bench  press", set_number: 2, reps: 8, weight_kg: 60 },
          ],
        },
      ],
    });
    expect(res.counts.created).toBe(3);
    const sets = await prisma.exerciseSet.findMany({ where: { ownerId: owner }, orderBy: { setNumber: "asc" } });
    expect(sets.map((s) => s.exerciseKey)).toEqual(["bench press", "bench press"]);
    expect(sets.map((s) => s.exerciseName)).toEqual(["Bench Press", "bench  press"]);
    expect(sets.every((s) => s.workoutId === "wo-1")).toBe(true);

    const cardio = await importOk(owner, {
      schema_version: "1.0",
      cardio_sessions: [{ date: "2026-10-26", activity: "Run", duration_min: 30, distance_km: 5 }],
    });
    expect(cardio.counts.created).toBe(1);
    expect(cardio.assigned_ids).toHaveLength(1);
  });

  it("uses record-level dates over the top-level default", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      date: "2026-10-27",
      food_entries: [
        { id: "f1", name: "Oats" },
        { id: "f2", name: "Rice", date: "2026-10-25" },
      ],
    });
    const rows = await prisma.foodEntry.findMany({ where: { ownerId: owner }, orderBy: { id: "asc" } });
    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-10-27", "2026-10-25"]);
  });

  it("rejects a new record with no date, but applies the valid ones", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, {
      schema_version: "1.0",
      food_entries: [{ name: "No date" }, { name: "Dated", date: "2026-10-27" }],
    });
    expect(res.counts).toMatchObject({ created: 1, rejected: 1 });
    expect(res.errors[0]).toMatch(/food_entries\[0\]: no date/);
    expect(await prisma.foodEntry.count({ where: { ownerId: owner } })).toBe(1);
  });

  it("keeps unknown nutrition as null (not zero) and flags it", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, {
      schema_version: "1.0",
      date: "2026-10-27",
      food_entries: [{ id: "f1", name: "Mystery curry", meal: "office meal", protein_g: 20 }],
    });
    expect(res.warnings.join(" ")).toMatch(/missing nutrition: calories, carbs_g, fat_g, fiber_g/);
    const row = await prisma.foodEntry.findFirstOrThrow({ where: { ownerId: owner } });
    expect(row.calories).toBeNull();
    expect(row.proteinG).toBe(20);
  });

  it("accepts arbitrary meal labels", async () => {
    const owner = await createBareOwner("a");
    const meals = ["midnight snack", "Post-workout meal", "office meal", "Grandma's Sunday lunch"];
    await importOk(owner, {
      schema_version: "1.0",
      date: "2026-10-27",
      food_entries: meals.map((meal, i) => ({ id: `f${i}`, name: "Food", meal })),
    });
    const rows = await prisma.foodEntry.findMany({ where: { ownerId: owner } });
    expect(rows.map((r) => r.meal).sort()).toEqual([...meals].sort());
  });
});

describe("validation policy", () => {
  it("rejects a record with an unknown field and suggests the right name", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, {
      schema_version: "1.0",
      date: "2026-10-27",
      food_entries: [
        { name: "Eggs", protien_g: 12 },
        { name: "Toast", calories: 80 },
      ],
    });
    expect(res.counts).toMatchObject({ created: 1, rejected: 1 });
    expect(res.errors[0]).toBe('food_entries[0]: unknown field "protien_g" (did you mean "protein_g"?)');
  });

  it("rejects the whole import for an unknown top-level key, writing nothing", async () => {
    const owner = await createBareOwner("a");
    const res = await previewImport(owner, {
      schema_version: "1.0",
      date: "2026-10-27",
      food_entry: [{ name: "Eggs" }],
      food_entries: [{ name: "Toast" }],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toMatch(/unknown field "food_entry" \(did you mean "food_entries"\?\)/);
  });

  it("requires a supported schema_version", async () => {
    const owner = await createBareOwner("a");
    for (const payload of [{ food_entries: [] }, { schema_version: "2.0" }, []]) {
      const res = await previewImport(owner, payload);
      expect(res.ok).toBe(false);
    }
  });

  it("rejects invalid values without touching existing data", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", date: "2026-10-27", food_entries: [{ id: "f1", name: "Rice", calories: 200 }] });
    const res = await importOk(owner, {
      schema_version: "1.0",
      food_entries: [
        { id: "f1", calories: -5 },
        { id: "f1x", name: "Bad date", date: "2026-02-30" },
        { id: "f1y", name: "Bad time", date: "2026-10-27", time: "25:00" },
        { id: "f1z", name: "Bad basis", date: "2026-10-27", weight_basis: "fried" },
      ],
    });
    expect(res.counts.rejected).toBe(4);
    const row = await prisma.foodEntry.findUniqueOrThrow({ where: { ownerId_id: { ownerId: owner, id: "f1" } } });
    expect(row.calories).toBe(200);
    expect(await prisma.foodEntry.count({ where: { ownerId: owner } })).toBe(1);
  });

  it("explicit null clears nullable fields; null on a required field is rejected", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      date: "2026-10-27",
      food_entries: [{ id: "f1", name: "Rice", calories: 200, notes: "basmati" }],
    });
    const res = await importOk(owner, { schema_version: "1.0", food_entries: [{ id: "f1", notes: null }] });
    expect(res.counts.updated).toBe(1);
    const bad = await importOk(owner, { schema_version: "1.0", food_entries: [{ id: "f1", name: null }] });
    expect(bad.counts.rejected).toBe(1);
    expect(bad.errors[0]).toBe("food_entries[0].name: cannot be null");
    const row = await prisma.foodEntry.findUniqueOrThrow({ where: { ownerId_id: { ownerId: owner, id: "f1" } } });
    expect(row).toMatchObject({ name: "Rice", notes: null, calories: 200 });
  });

  it("reports missing required fields on create", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, {
      schema_version: "1.0",
      date: "2026-10-27",
      cardio_sessions: [{ duration_min: 20 }],
      daily_notes: [{}],
    });
    expect(res.errors).toEqual([
      "cardio_sessions[0]: missing required field: activity",
      "daily_notes[0]: missing required field: text",
    ]);
  });

  it("ignores a summary block with a warning; totals are never imported", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, {
      schema_version: "1.0",
      date: "2026-10-27",
      summary: { calories: 9999 },
      food_entries: [{ name: "Apple", calories: 95 }],
    });
    expect(res.warnings[0]).toMatch(/summary.*ignored/);
  });

  it("rejects a commit without a preview token", async () => {
    const owner = await createBareOwner("a");
    const res = await commitImport(owner, { schema_version: "1.0" }, undefined);
    expect(res).toMatchObject({ ok: false, status: 400 });
  });
});
