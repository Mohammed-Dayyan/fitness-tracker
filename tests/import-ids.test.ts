import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { commitImport, previewImport } from "@/lib/server/import";
import { createBareOwner, importOk } from "./helpers/factory";

const day = (payload: object) => ({ schema_version: "1.0", date: "2026-10-27", ...payload });

describe("stable IDs and idempotency", () => {
  it("generates UUIDs for records without IDs and returns them", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, day({ food_entries: [{ name: "Banana" }, { name: "Banana" }] }));
    expect(res.assigned_ids).toHaveLength(2);
    for (const a of res.assigned_ids) expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(res.assigned_ids.map((a) => a.id)).size).toBe(2);
  });

  it("treats identical foods on one day as distinct records", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, day({ food_entries: [
      { id: "egg-1", name: "Egg", calories: 70 },
      { id: "egg-2", name: "Egg", calories: 70 },
    ] }));
    expect(await prisma.foodEntry.count({ where: { ownerId: owner } })).toBe(2);
  });

  it("re-importing the same payload is a no-op (unchanged)", async () => {
    const owner = await createBareOwner("a");
    const payload = day({
      food_entries: [{ id: "f1", name: "Oats", calories: 150 }],
      workouts: [{ id: "w1", name: "Legs", sets: [{ id: "s1", exercise: "Squat", set_number: 1, reps: 5, weight_kg: 100 }] }],
      daily_activity: [{ steps: 1000 }],
      targets: [{ effective_from: "2026-10-01", calories: 2200 }],
    });
    await importOk(owner, payload);
    const again = await importOk(owner, payload);
    expect(again.counts).toEqual({ created: 0, updated: 0, unchanged: 5, deleted: 0, rejected: 0 });
  });

  it("updates an existing ID, changing only supplied fields", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, day({ food_entries: [{ id: "f1", name: "Oats", calories: 150, protein_g: 5 }] }));
    const res = await importOk(owner, { schema_version: "1.0", food_entries: [{ id: "f1", calories: 160 }] });
    expect(res.records[0]).toMatchObject({ action: "update", changes: ["calories"] });
    const row = await prisma.foodEntry.findUniqueOrThrow({ where: { ownerId_id: { ownerId: owner, id: "f1" } } });
    expect(row).toMatchObject({ name: "Oats", calories: 160, proteinG: 5 });
  });

  it("does not move an existing record to the top-level default date", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", date: "2026-10-26", food_entries: [{ id: "f1", name: "Oats" }] });
    await importOk(owner, { schema_version: "1.0", date: "2026-10-27", food_entries: [{ id: "f1", calories: 150 }] });
    const row = await prisma.foodEntry.findUniqueOrThrow({ where: { ownerId_id: { ownerId: owner, id: "f1" } } });
    expect(row.date.toISOString().slice(0, 10)).toBe("2026-10-26");
  });

  it("moves a record to another date with the same ID instead of duplicating", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, day({ food_entries: [{ id: "f1", name: "Oats" }] }));
    const res = await importOk(owner, { schema_version: "1.0", food_entries: [{ id: "f1", date: "2026-10-28" }] });
    expect(res.records[0]).toMatchObject({ action: "update", date: "2026-10-28", previous_date: "2026-10-27" });
    const rows = await prisma.foodEntry.findMany({ where: { ownerId: owner } });
    expect(rows).toHaveLength(1);
    expect(rows[0].date.toISOString().slice(0, 10)).toBe("2026-10-28");
  });

  it("preserves records omitted from later imports", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, day({ food_entries: [{ id: "f1", name: "A" }, { id: "f2", name: "B" }] }));
    await importOk(owner, day({ food_entries: [{ id: "f3", name: "C" }] }));
    expect(await prisma.foodEntry.count({ where: { ownerId: owner } })).toBe(3);
  });

  it("rejects every occurrence of an ID duplicated within one payload", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, day({ food_entries: [
      { id: "dup", name: "A" },
      { id: "dup", name: "B" },
      { id: "ok", name: "C" },
    ] }));
    expect(res.counts).toMatchObject({ created: 1, rejected: 2 });
    expect(res.errors[0]).toMatch(/id "dup" appears 2 times/);
  });

  it("allows the same ID in different record types", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, day({
      food_entries: [{ id: "x1", name: "Rice" }],
      cardio_sessions: [{ id: "x1", activity: "Walk" }],
    }));
    expect(res.counts.created).toBe(2);
  });

  it("matches one-per-day records by date when no ID is given, and rejects a conflicting ID", async () => {
    const owner = await createBareOwner("a");
    const first = await importOk(owner, day({ daily_notes: [{ text: "Tired" }] }));
    const noteId = first.assigned_ids[0].id;
    const second = await importOk(owner, day({ daily_notes: [{ text: "Tired but trained" }] }));
    expect(second.records[0]).toMatchObject({ action: "update", id: noteId });
    const conflict = await importOk(owner, day({ daily_notes: [{ id: "note-other", text: "x" }] }));
    expect(conflict.counts.rejected).toBe(1);
    expect(conflict.errors[0]).toContain(`already exists for 2026-10-27 with id "${noteId}"`);
  });
});

describe("explicit deletes", () => {
  it("deletes only the identified record", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, day({ food_entries: [{ id: "f1", name: "A" }, { id: "f2", name: "B" }] }));
    const res = await importOk(owner, { schema_version: "1.0", delete: { food_entries: ["f1"] } });
    expect(res.counts.deleted).toBe(1);
    const left = await prisma.foodEntry.findMany({ where: { ownerId: owner } });
    expect(left.map((r) => r.id)).toEqual(["f2"]);
  });

  it("reports a missing ID as unchanged with a warning (re-running a delete is harmless)", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, { schema_version: "1.0", delete: { food_entries: ["nope"] } });
    expect(res.counts).toMatchObject({ deleted: 0, unchanged: 1 });
    expect(res.warnings[0]).toMatch(/no food entry with id "nope"/);
  });

  it("deleting a workout removes its sets; sets cannot be added to it in the same import", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, day({ workouts: [{ id: "w1", sets: [{ id: "s1", exercise: "Row", set_number: 1 }] }] }));
    const res = await importOk(owner, {
      schema_version: "1.0",
      delete: { workouts: ["w1"] },
      exercise_sets: [{ workout_id: "w1", exercise: "Row", set_number: 2 }],
    });
    expect(res.counts).toMatchObject({ deleted: 1, rejected: 1 });
    expect(res.errors[0]).toMatch(/workout "w1" is deleted in this import/);
    expect(await prisma.exerciseSet.count({ where: { ownerId: owner } })).toBe(0);
  });

  it("rejects an ID that is both deleted and upserted", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, day({ food_entries: [{ id: "f1", name: "A" }] }));
    const res = await importOk(owner, {
      schema_version: "1.0",
      food_entries: [{ id: "f1", calories: 5 }],
      delete: { food_entries: ["f1"] },
    });
    expect(res.counts.rejected).toBe(2);
    expect(await prisma.foodEntry.count({ where: { ownerId: owner } })).toBe(1);
  });
});

describe("exercise sets", () => {
  it("adds a set to an existing workout and rejects sets for unknown workouts", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, day({ workouts: [{ id: "w1", name: "Pull" }] }));
    const res = await importOk(owner, {
      schema_version: "1.0",
      exercise_sets: [
        { id: "s1", workout_id: "w1", exercise: "Deadlift", set_number: 1, reps: 5, weight_kg: 140 },
        { id: "s2", workout_id: "missing", exercise: "Deadlift", set_number: 1 },
      ],
    });
    expect(res.counts).toMatchObject({ created: 1, rejected: 1 });
    expect(res.errors[0]).toMatch(/workout "missing" does not exist/);
  });

  it("rejects nested sets when their workout is invalid", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, day({
      workouts: [{ id: "w1", bogus: true, sets: [{ exercise: "Squat", set_number: 1 }] }],
    }));
    expect(res.counts.rejected).toBe(2);
    expect(res.errors[1]).toMatch(/its workout \(workouts\[0\]\) is invalid/);
  });

  it("assigns nested sets to a workout whose ID is generated", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, day({ workouts: [{ name: "Push", sets: [{ exercise: "Dip", set_number: 1, reps: 10 }] }] }));
    const workoutId = res.assigned_ids.find((a) => a.kind === "workouts")!.id;
    const set = await prisma.exerciseSet.findFirstOrThrow({ where: { ownerId: owner } });
    expect(set.workoutId).toBe(workoutId);
  });
});

describe("preview and confirm", () => {
  it("preview writes nothing", async () => {
    const owner = await createBareOwner("a");
    const res = await previewImport(owner, day({ food_entries: [{ name: "Oats" }] }));
    expect(res.ok && res.counts.created).toBe(1);
    expect(res.ok && res.records[0].id).toBeNull();
    expect(await prisma.foodEntry.count()).toBe(0);
  });

  it("refuses a commit when data changed after the preview", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, day({ food_entries: [{ id: "f1", name: "Oats", calories: 100 }] }));
    const payload = { schema_version: "1.0", food_entries: [{ id: "f1", calories: 150 }] };
    const preview = await previewImport(owner, payload);
    if (!preview.ok) throw new Error("preview failed");

    // Something else changes the record between preview and confirm.
    await importOk(owner, { schema_version: "1.0", food_entries: [{ id: "f1", calories: 120 }] });

    const res = await commitImport(owner, payload, preview.preview_token);
    expect(res).toMatchObject({ ok: false, status: 409 });
    const row = await prisma.foodEntry.findUniqueOrThrow({ where: { ownerId_id: { ownerId: owner, id: "f1" } } });
    expect(row.calories).toBe(120);
  });

  it("refuses a commit whose payload differs from the previewed one", async () => {
    const owner = await createBareOwner("a");
    const preview = await previewImport(owner, day({ food_entries: [{ id: "f1", name: "Oats" }] }));
    if (!preview.ok) throw new Error("preview failed");
    const res = await commitImport(owner, day({ food_entries: [{ id: "f1", name: "Pizza" }] }), preview.preview_token);
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.foodEntry.count()).toBe(0);
  });
});

describe("versioned targets", () => {
  it("new versions carry forward omitted values; history is kept", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", targets: [{ effective_from: "2026-10-01", calories: 2200, protein_g: 150, steps: 8000 }] });
    const res = await importOk(owner, { schema_version: "1.0", targets: [{ effective_from: "2026-10-20", calories: 2000 }] });
    expect(res.warnings.join(" ")).toMatch(/protein_g, steps carried forward from the target set effective 2026-10-01/);
    const rows = await prisma.targetSet.findMany({ where: { ownerId: owner }, orderBy: { effectiveFrom: "asc" } });
    expect(rows.map((r) => [r.calories, r.proteinG, r.steps])).toEqual([
      [2200, 150, 8000],
      [2000, 150, 8000],
    ]);
  });
});
