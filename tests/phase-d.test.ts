import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { buildContextPackage, MAX_CARDIO_NAMES, MAX_EXERCISE_NAMES } from "@/lib/server/export";
import { saveSteps } from "@/lib/server/settings";
import { dateToDb } from "@/lib/shared/dates";
import { createBareOwner, importOk } from "./helpers/factory";

const TODAY = "2026-10-28";
const row = (owner: string, date: string) => prisma.dailyActivity.findFirstOrThrow({ where: { ownerId: owner, date: dateToDb(date) } });

describe("steps quick log (saveSteps)", () => {
  it("records steps for today and for a past day, keeping weight and notes", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", daily_activity: [{ date: "2026-10-27", weight_kg: 80 }], daily_notes: [{ date: "2026-10-27", text: "Slept well" }] });
    const past = await saveSteps(owner, { date: "2026-10-27", steps: "8,500" }, TODAY);
    expect(past).toMatchObject({ ok: true });
    expect((await row(owner, "2026-10-27")).weightKg).toBe(80);
    expect((await row(owner, "2026-10-27")).steps).toBe(8500);
    expect(await prisma.dailyNote.count({ where: { ownerId: owner } })).toBe(1);

    expect(await saveSteps(owner, { date: TODAY, steps: 1200 }, TODAY)).toMatchObject({ ok: true });
    expect((await row(owner, TODAY)).steps).toBe(1200);
  });

  it("replaces an earlier count and says so", async () => {
    const owner = await createBareOwner("a");
    await saveSteps(owner, { date: TODAY, steps: "1000" }, TODAY);
    const res = await saveSteps(owner, { date: TODAY, steps: "4000" }, TODAY);
    expect(res).toMatchObject({ ok: true });
    expect(res.ok && res.message).toContain("It replaced 1000");
    expect((await row(owner, TODAY)).steps).toBe(4000);
  });

  it("rejects blank, decimal, negative, huge, text and future-date input without writing", async () => {
    const owner = await createBareOwner("a");
    for (const steps of ["", "  ", "12.5", "-3", "200001", "abc", "1e3"]) {
      const r = await saveSteps(owner, { date: TODAY, steps }, TODAY);
      expect(r.ok, String(steps)).toBe(false);
      expect(!r.ok && r.fieldErrors.steps, String(steps)).toBeTruthy();
    }
    const future = await saveSteps(owner, { date: "2026-10-29", steps: "100" }, TODAY);
    expect(!future.ok && future.fieldErrors.date).toBe("Date can't be in the future");
    expect(await saveSteps(owner, { date: "nope", steps: "100" }, TODAY)).toMatchObject({ ok: false });
    expect(await prisma.dailyActivity.count({ where: { ownerId: owner } })).toBe(0);
    // Boundaries are allowed.
    expect(await saveSteps(owner, { date: TODAY, steps: "0" }, TODAY)).toMatchObject({ ok: true });
    expect(await saveSteps(owner, { date: TODAY, steps: "200000" }, TODAY)).toMatchObject({ ok: true });
  });
});

describe("context lists names already used", () => {
  it("lists exercise and cardio names once each, newest first, and says to reuse them", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      workouts: [
        { id: "w1", date: "2026-10-01", sets: [{ id: "s1", exercise: "Bench Press", set_number: 1, reps: 5, weight_kg: 60 }] },
        { id: "w2", date: "2026-10-10", sets: [{ id: "s2", exercise: "bench  press", set_number: 1, reps: 5, weight_kg: 62 }, { id: "s3", exercise: "Squat", set_number: 1, reps: 5, weight_kg: 80 }] },
      ],
      cardio_sessions: [
        { id: "c1", date: "2026-10-02", activity: "Run" },
        { id: "c2", date: "2026-10-12", activity: "run" },
        { id: "c3", date: "2026-10-05", activity: "Cycling" },
      ],
    });
    const text = await buildContextPackage(owner);
    expect(text).toContain("Names already used: reuse exactly");
    expect(text).toContain('Exercises: "bench  press", "Squat".');
    expect(text).toContain('Cardio: "run", "Cycling".');
  });

  it("caps the lists and stays short; empty is stated", async () => {
    const owner = await createBareOwner("a");
    expect(await buildContextPackage(owner)).toContain("Exercises: none logged yet.");
    await importOk(owner, {
      schema_version: "1.0",
      workouts: [{ id: "w1", date: "2026-10-01", sets: Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, exercise: `Move ${i}`, set_number: 1, reps: 5 })) }],
      cardio_sessions: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, date: "2026-10-01", activity: `Activity ${i}` })),
    });
    const text = await buildContextPackage(owner);
    expect((text.match(/"Move \d+"/g) ?? []).length).toBe(MAX_EXERCISE_NAMES);
    expect((text.match(/"Activity \d+"/g) ?? []).length).toBe(MAX_CARDIO_NAMES);
    expect(text.length).toBeLessThan(8000);
  });
});
