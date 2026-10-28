import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { exportData } from "@/lib/server/export";
import { createBareOwner, importOk } from "./helpers/factory";

describe("cross-owner isolation", () => {
  it("the same record IDs can exist independently for two owners", async () => {
    const a = await createBareOwner("a");
    const b = await createBareOwner("b");
    await importOk(a, { schema_version: "1.0", date: "2026-10-27", food_entries: [{ id: "f1", name: "A's oats", calories: 100 }] });
    const res = await importOk(b, { schema_version: "1.0", date: "2026-10-27", food_entries: [{ id: "f1", name: "B's rice", calories: 300 }] });
    // For B this is a create, not an update of A's record.
    expect(res.counts.created).toBe(1);
    const aRow = await prisma.foodEntry.findUniqueOrThrow({ where: { ownerId_id: { ownerId: a, id: "f1" } } });
    expect(aRow).toMatchObject({ name: "A's oats", calories: 100 });
  });

  it("an owner cannot update, delete or attach sets to another owner's records", async () => {
    const a = await createBareOwner("a");
    const b = await createBareOwner("b");
    await importOk(a, {
      schema_version: "1.0",
      date: "2026-10-27",
      food_entries: [{ id: "secret", name: "A only" }],
      workouts: [{ id: "wa", name: "A's workout" }],
    });

    const del = await importOk(b, { schema_version: "1.0", delete: { food_entries: ["secret"], workouts: ["wa"] } });
    expect(del.counts.deleted).toBe(0);
    const attach = await importOk(b, {
      schema_version: "1.0",
      exercise_sets: [{ workout_id: "wa", exercise: "Curl", set_number: 1 }],
    });
    expect(attach.counts.rejected).toBe(1);
    expect(attach.errors[0]).toMatch(/workout "wa" does not exist/);

    expect(await prisma.foodEntry.count({ where: { ownerId: a } })).toBe(1);
    expect(await prisma.workoutSession.count({ where: { ownerId: a } })).toBe(1);
    expect(await prisma.exerciseSet.count()).toBe(0);
  });

  it("the database refuses a set that references another owner's workout", async () => {
    const a = await createBareOwner("a");
    const b = await createBareOwner("b");
    await importOk(a, { schema_version: "1.0", date: "2026-10-27", workouts: [{ id: "wa" }] });
    await expect(
      prisma.exerciseSet.create({
        data: { ownerId: b, id: "s", workoutId: "wa", exerciseName: "Curl", exerciseKey: "curl", setNumber: 1 },
      }),
    ).rejects.toThrow();
  });

  it("exports contain only the owner's own records", async () => {
    const a = await createBareOwner("a");
    const b = await createBareOwner("b");
    await importOk(a, { schema_version: "1.0", date: "2026-10-27", food_entries: [{ name: "A food" }] });
    await importOk(b, { schema_version: "1.0", date: "2026-10-27", food_entries: [{ name: "B food" }] });
    const exported = await exportData(b, { scope: "all" });
    expect(exported.food_entries.map((f) => f.name)).toEqual(["B food"]);
  });

  it("database CHECK constraints back up validation", async () => {
    const a = await createBareOwner("a");
    await expect(
      prisma.foodEntry.create({ data: { ownerId: a, id: "neg", date: new Date("2026-10-27"), name: "x", calories: -1 } }),
    ).rejects.toThrow();
  });
});
