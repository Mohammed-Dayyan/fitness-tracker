import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { commitImport, previewImport } from "@/lib/server/import";
import { createBareOwner, importOk } from "./helpers/factory";

const day = (payload: object) => ({ schema_version: "1.0", date: "2026-11-02", ...payload });

describe("audit #1: several records for the same date in one import", () => {
  it("compatible id-less daily_activity records are merged into one created record", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, day({ daily_activity: [{ steps: 5000 }, { weight_kg: 80 }] }));
    expect(res.counts).toMatchObject({ created: 1, updated: 1, rejected: 0 });
    expect(res.records[1].warnings![0]).toMatch(/merged into daily_activity\[0\]/);
    const rows = await prisma.dailyActivity.findMany({ where: { ownerId: owner } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ steps: 5000, weightKg: 80 });
  });

  it("the preview never approves a plan that fails on confirm (previously HTTP 500)", async () => {
    const owner = await createBareOwner("a");
    // An id-less record on the same date is the same record as the one with an id.
    const payload = day({ daily_activity: [{ id: "act-9", steps: 100 }, { weight_kg: 70 }] });
    const preview = await previewImport(owner, payload);
    if (!preview.ok) throw new Error("preview failed");
    expect(preview.counts.rejected).toBe(0);
    const res = await commitImport(owner, payload, preview.preview_token);
    expect(res.ok).toBe(true);
    const rows = await prisma.dailyActivity.findMany({ where: { ownerId: owner } });
    expect(rows.map((r) => [r.id, r.steps, r.weightKg])).toEqual([["act-9", 100, 70]]);
  });

  it("a note with an id and an id-less note with different text conflict: the second is rejected, nothing fails", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, day({ daily_notes: [{ id: "n1", text: "first" }, { text: "second" }] }));
    expect(res.counts).toMatchObject({ created: 1, rejected: 1 });
    expect((await prisma.dailyNote.findFirstOrThrow({ where: { ownerId: owner } })).text).toBe("first");
  });

  it("identical values for the same field are compatible; different values are rejected in the preview", async () => {
    const owner = await createBareOwner("a");
    const same = await importOk(owner, day({ daily_activity: [{ steps: 5000 }, { steps: 5000, weight_kg: 80 }] }));
    expect(same.counts.rejected).toBe(0);
    expect(await prisma.dailyActivity.count({ where: { ownerId: owner } })).toBe(1);

    const conflict = await importOk(owner, day({ date: "2026-11-03", daily_activity: [{ steps: 5000 }, { steps: 9000 }] }));
    expect(conflict.counts).toMatchObject({ created: 1, rejected: 1 });
    expect(conflict.errors[0]).toBe(
      "daily_activity[1]: conflicts with an earlier daily activity record for 2026-11-03 in this import on steps. Send one value per field per date, or put them in a single record.",
    );
    const row = await prisma.dailyActivity.findFirstOrThrow({ where: { ownerId: owner, date: new Date("2026-11-03") } });
    expect(row.steps).toBe(5000);
  });

  it("explicit null conflicts with a value set earlier on the same date", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, day({ daily_activity: [{ steps: 5000 }, { steps: null }] }));
    expect(res.counts.rejected).toBe(1);
  });

  it("two target versions for one effective date become one version; conflicting values are rejected", async () => {
    const owner = await createBareOwner("a");
    const ok = await importOk(owner, {
      schema_version: "1.0",
      targets: [{ effective_from: "2026-11-03", calories: 2000 }, { effective_from: "2026-11-03", protein_g: 150 }],
    });
    expect(ok.counts).toMatchObject({ created: 1, updated: 1, rejected: 0 });
    const rows = await prisma.targetSet.findMany({ where: { ownerId: owner } });
    expect(rows.map((r) => [r.calories, r.proteinG])).toEqual([[2000, 150]]);

    const bad = await importOk(owner, {
      schema_version: "1.0",
      targets: [{ effective_from: "2026-11-10", calories: 2000 }, { effective_from: "2026-11-10", calories: 2500 }],
    });
    expect(bad.counts).toMatchObject({ created: 1, rejected: 1 });
    expect(await prisma.targetSet.count({ where: { ownerId: owner } })).toBe(2);
  });

  it("values carried forward from an earlier target version can be overridden by the merged record", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", targets: [{ effective_from: "2026-10-01", calories: 2200, protein_g: 150, steps: 8000 }] });
    const res = await importOk(owner, {
      schema_version: "1.0",
      targets: [{ effective_from: "2026-11-01", calories: 2000 }, { effective_from: "2026-11-01", protein_g: 160 }],
    });
    expect(res.counts.rejected).toBe(0);
    // Only steps is still inherited; protein was given explicitly by the second record.
    expect(res.records[0].warnings!.join(" ")).toMatch(/^steps carried forward/);
    const v = await prisma.targetSet.findFirstOrThrow({ where: { ownerId: owner, effectiveFrom: new Date("2026-11-01") } });
    expect([v.calories, v.proteinG, v.steps]).toEqual([2000, 160, 8000]);
  });

  it("an id-bearing record cannot take a date another record in this import already creates", async () => {
    const owner = await createBareOwner("a");
    const res = await importOk(owner, day({ daily_notes: [{ text: "id-less" }, { id: "n9", text: "with id" }] }));
    expect(res.counts).toMatchObject({ created: 1, rejected: 1 });
    expect(res.errors[0]).toMatch(/daily_notes\[0\] in this import already creates the daily note for 2026-11-02/);
  });

  it("existing records: two id-less updates on the same date apply in order without conflict", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, day({ daily_activity: [{ id: "act-1", steps: 1000 }] }));
    const res = await importOk(owner, day({ daily_activity: [{ steps: 2000 }, { weight_kg: 79 }] }));
    expect(res.counts).toMatchObject({ updated: 2, rejected: 0 });
    expect(await prisma.dailyActivity.findUniqueOrThrow({ where: { ownerId_id: { ownerId: owner, id: "act-1" } } })).toMatchObject({ steps: 2000, weightKg: 79 });
  });

  it("merged results are idempotent: re-importing the same payload changes nothing", async () => {
    const owner = await createBareOwner("a");
    const payload = day({ daily_activity: [{ steps: 5000 }, { weight_kg: 80 }] });
    await importOk(owner, payload);
    const again = await importOk(owner, payload);
    expect(again.counts).toMatchObject({ created: 0, rejected: 0 });
    expect(await prisma.dailyActivity.count({ where: { ownerId: owner } })).toBe(1);
  });
});

describe("audit #2: moving existing exercise sets between workouts", () => {
  async function seeded() {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      date: "2026-11-02",
      workouts: [
        { id: "w-a", name: "Push", sets: [{ id: "s1", exercise: "Bench Press", set_number: 1, reps: 8, weight_kg: 60 }] },
        { id: "w-b", name: "Pull" },
      ],
    });
    return owner;
  }
  const setOf = (owner: string, id: string) => prisma.exerciseSet.findUniqueOrThrow({ where: { ownerId_id: { ownerId: owner, id } } });

  it("a nested set whose id belongs to another workout is rejected with both workouts named", async () => {
    const owner = await seeded();
    const res = await importOk(owner, {
      schema_version: "1.0",
      date: "2026-11-02",
      workouts: [{ id: "w-b", sets: [{ id: "s1", exercise: "Row", set_number: 1 }] }],
    });
    expect(res.counts.rejected).toBe(1);
    expect(res.errors[0]).toContain('set "s1" belongs to workout "w-a" (Push, 2026-11-02)');
    expect(res.errors[0]).toContain('would move it. Add "allow_move": true');
    expect(await setOf(owner, "s1")).toMatchObject({ workoutId: "w-a", exerciseName: "Bench Press" });
  });

  it("a top-level set pointing at a different workout is also rejected", async () => {
    const owner = await seeded();
    const res = await importOk(owner, { schema_version: "1.0", exercise_sets: [{ id: "s1", workout_id: "w-b" }] });
    expect(res.counts.rejected).toBe(1);
    expect((await setOf(owner, "s1")).workoutId).toBe("w-a");
  });

  it("with allow_move the id is kept, the move is shown in the preview, and nothing is duplicated", async () => {
    const owner = await seeded();
    const payload = { schema_version: "1.0", exercise_sets: [{ id: "s1", workout_id: "w-b", allow_move: true }] };
    const preview = await previewImport(owner, payload);
    if (!preview.ok) throw new Error("preview failed");
    expect(preview.records[0]).toMatchObject({ action: "update", changes: ["workout_id"], previous_workout_id: "w-a" });
    expect(preview.records[0].warnings![0]).toBe('moved from workout "w-a" (Push, 2026-11-02) to workout "w-b" (Pull, 2026-11-02)');
    expect((await commitImport(owner, payload, preview.preview_token)).ok).toBe(true);
    expect(await setOf(owner, "s1")).toMatchObject({ workoutId: "w-b", exerciseName: "Bench Press" });
    expect(await prisma.exerciseSet.count({ where: { ownerId: owner } })).toBe(1);
  });

  it("confirm is refused when the move permission differs from the previewed payload", async () => {
    const owner = await seeded();
    const withMove = { schema_version: "1.0", exercise_sets: [{ id: "s1", workout_id: "w-b", allow_move: true }] };
    const withoutMove = { schema_version: "1.0", exercise_sets: [{ id: "s1", workout_id: "w-b" }] };
    const preview = await previewImport(owner, withMove);
    if (!preview.ok) throw new Error("preview failed");
    expect(await commitImport(owner, withoutMove, preview.preview_token)).toMatchObject({ ok: false, status: 409 });
    expect((await setOf(owner, "s1")).workoutId).toBe("w-a");
  });

  it("same-workout updates need no permission; a real exercise rename is warned about, a case change is not", async () => {
    const owner = await seeded();
    const edit = await importOk(owner, {
      schema_version: "1.0",
      date: "2026-11-02",
      workouts: [{ id: "w-a", sets: [{ id: "s1", reps: 10 }] }],
    });
    expect(edit.counts).toMatchObject({ updated: 1, rejected: 0 });
    expect(edit.records.find((r) => r.kind === "exercise_sets")!.warnings).toBeUndefined();

    const caseOnly = await importOk(owner, { schema_version: "1.0", exercise_sets: [{ id: "s1", exercise: "bench press" }] });
    expect(caseOnly.records[0].warnings).toBeUndefined();

    const rename = await importOk(owner, { schema_version: "1.0", exercise_sets: [{ id: "s1", exercise: "Overhead Press" }] });
    expect(rename.records[0].warnings).toEqual(['exercise changed from "bench press" to "Overhead Press"']);
    expect(await setOf(owner, "s1")).toMatchObject({ exerciseName: "Overhead Press", exerciseKey: "overhead press" });
  });

  it("allow_move must be a boolean and is never stored or exported", async () => {
    const owner = await seeded();
    const bad = await importOk(owner, { schema_version: "1.0", exercise_sets: [{ id: "s1", workout_id: "w-b", allow_move: "yes" }] });
    expect(bad.counts.rejected).toBe(1);
    await importOk(owner, { schema_version: "1.0", exercise_sets: [{ id: "s1", workout_id: "w-b", allow_move: true }] });
    const { exportData } = await import("@/lib/server/export");
    expect(JSON.stringify(await exportData(owner, { scope: "all" }))).not.toContain("allow_move");
  });

  it("explicit deletes still work, and another owner's sets can't be moved or seen", async () => {
    const owner = await seeded();
    const other = await createBareOwner("b");
    await importOk(other, { schema_version: "1.0", date: "2026-11-02", workouts: [{ id: "w-x", name: "Theirs" }] });
    // Owner B using A's set id just creates B's own set; A's stays where it is.
    const res = await importOk(other, { schema_version: "1.0", exercise_sets: [{ id: "s1", workout_id: "w-x", exercise: "Curl", set_number: 1 }] });
    expect(res.counts.created).toBe(1);
    expect((await setOf(owner, "s1")).workoutId).toBe("w-a");
    // Attaching to a workout owned by someone else is rejected.
    const bad = await importOk(other, { schema_version: "1.0", exercise_sets: [{ id: "s2", workout_id: "w-a", exercise: "Curl", set_number: 1 }] });
    expect(bad.errors[0]).toMatch(/workout "w-a" does not exist/);

    await importOk(owner, { schema_version: "1.0", delete: { exercise_sets: ["s1"] } });
    expect(await prisma.exerciseSet.count({ where: { ownerId: owner } })).toBe(0);
  });
});
