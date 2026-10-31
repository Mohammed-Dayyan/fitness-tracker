import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { saveDaily } from "@/lib/server/settings";
import { dateToDb } from "@/lib/shared/dates";
import { importToastMessage } from "@/lib/shared/import-summary";
import { buildWeightLog } from "@/lib/shared/weight-log";
import { createBareOwner, importOk } from "./helpers/factory";

const TODAY = "2026-10-28";
const row = (owner: string, date: string) => prisma.dailyActivity.findFirstOrThrow({ where: { ownerId: owner, date: dateToDb(date) } });

describe("saveDaily (the Log today card)", () => {
  it("saves steps and weight together for a past day, and says what it saved", async () => {
    const owner = await createBareOwner("a");
    const r = await saveDaily(owner, { date: "2026-10-27", steps: "12,345", weight_kg: "79.2" }, TODAY);
    expect(r).toEqual({ ok: true, message: "12,345 steps and 79.2 kg recorded for 2026-10-27." });
    expect(await row(owner, "2026-10-27")).toMatchObject({ steps: 12345, weightKg: 79.2 });
  });

  it("steps only leaves the weight alone, and weight only leaves the steps alone", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", daily_activity: [{ date: TODAY, steps: 5000, weight_kg: 80 }], daily_notes: [{ date: TODAY, text: "Slept well" }] });
    expect(await saveDaily(owner, { date: TODAY, steps: "6000", weight_kg: "" }, TODAY)).toMatchObject({ ok: true, message: "6,000 steps recorded for 2026-10-28. It replaced 5,000 steps." });
    expect(await row(owner, TODAY)).toMatchObject({ steps: 6000, weightKg: 80 });
    expect(await saveDaily(owner, { date: TODAY, steps: "  ", weight_kg: "79.4" }, TODAY)).toMatchObject({ ok: true, message: "79.4 kg recorded for 2026-10-28. It replaced 80 kg." });
    expect(await row(owner, TODAY)).toMatchObject({ steps: 6000, weightKg: 79.4 });
    expect(await prisma.dailyNote.count({ where: { ownerId: owner } })).toBe(1);
  });

  it("an unchanged value is not reported as replaced", async () => {
    const owner = await createBareOwner("a");
    await saveDaily(owner, { date: TODAY, weight_kg: "80" }, TODAY);
    const r = await saveDaily(owner, { date: TODAY, weight_kg: "80" }, TODAY);
    expect(r.ok && r.message).toBe("80 kg recorded for 2026-10-28.");
  });

  it("rejects an empty save, bad numbers and future dates, and writes nothing", async () => {
    const owner = await createBareOwner("a");
    const empty = await saveDaily(owner, { date: TODAY, steps: "", weight_kg: " " }, TODAY);
    expect(!empty.ok && empty.fieldErrors.steps).toBe("Enter steps, weight or both");
    for (const steps of ["12.5", "-3", "200001", "abc"]) {
      const r = await saveDaily(owner, { date: TODAY, steps }, TODAY);
      expect(!r.ok && r.fieldErrors.steps, steps).toBeTruthy();
    }
    for (const weight_kg of ["abc", "0", "-5", "700"]) {
      const r = await saveDaily(owner, { date: TODAY, weight_kg }, TODAY);
      expect(!r.ok && r.fieldErrors.weight_kg, weight_kg).toBeTruthy();
    }
    const future = await saveDaily(owner, { date: "2026-10-29", steps: "100" }, TODAY);
    expect(!future.ok && future.fieldErrors.date).toBe("Date can't be in the future");
    // One bad field blocks the whole save: nothing is half-written.
    const mixed = await saveDaily(owner, { date: TODAY, steps: "100", weight_kg: "abc" }, TODAY);
    expect(mixed.ok).toBe(false);
    expect(await prisma.dailyActivity.count({ where: { ownerId: owner } })).toBe(0);
  });
});

describe("buildWeightLog", () => {
  const days = [
    { date: "2026-10-01", weight_kg: 80, weight_avg7: 80 },
    { date: "2026-10-02", weight_kg: null, weight_avg7: 80 },
    { date: "2026-10-03", weight_kg: 79.5, weight_avg7: 79.8 },
    { date: "2026-10-04", weight_kg: 79.9, weight_avg7: 79.8 },
  ];

  it("lists every day newest first, with the change since the previous weigh-in", () => {
    const log = buildWeightLog(days);
    expect(log.map((r) => r.date)).toEqual(["2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01"]);
    expect(log.map((r) => r.change_kg)).toEqual([0.4, -0.5, null, null]); // gap day has none; first weigh-in has none
    expect(log[2]).toMatchObject({ weight_kg: null, weight_avg7: 80 });
  });

  it("copes with unsorted input and empty ranges", () => {
    expect(buildWeightLog([...days].reverse()).map((r) => r.date)[0]).toBe("2026-10-04");
    expect(buildWeightLog([])).toEqual([]);
    expect(buildWeightLog([{ date: "2026-10-01", weight_kg: null, weight_avg7: null }])[0].change_kg).toBeNull();
  });
});

describe("importToastMessage", () => {
  const c = { created: 0, updated: 0, unchanged: 0, deleted: 0, rejected: 0 };
  it("says what changed, then what was skipped", () => {
    expect(importToastMessage({ ...c, created: 3, updated: 1 })).toBe("Imported: 3 created, 1 updated.");
    expect(importToastMessage({ ...c, created: 1, deleted: 2, rejected: 1 })).toBe("Imported: 1 created, 2 deleted. 1 record was skipped.");
    expect(importToastMessage({ ...c, updated: 2, rejected: 3 })).toBe("Imported: 2 updated. 3 records were skipped.");
  });
  it("says so when nothing changed, and never uses the on-page heading text", () => {
    expect(importToastMessage({ ...c, unchanged: 4 })).toBe("No changes: everything was already saved.");
    for (const x of [c, { ...c, created: 1 }, { ...c, rejected: 2 }]) expect(importToastMessage(x)).not.toContain("Import applied");
  });
});
