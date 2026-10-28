import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { getDayView, resolveDate } from "@/lib/server/day";
import { exportData } from "@/lib/server/export";
import { buildHistory, getHistory, resolveHistoryRange } from "@/lib/server/history";
import { saveProfile, saveTargets } from "@/lib/server/settings";
import { computeDailySummaries } from "@/lib/server/summary";
import { getTrends } from "@/lib/server/trends";
import { msUntilNextDay, todayInTimeZone } from "@/lib/shared/dates";
import { suggestTargets } from "@/lib/shared/suggest-targets";
import { createBareOwner, importOk } from "./helpers/factory";

// 18:29:59 UTC = 23:59:59 IST on 26 Oct; one second later it is 27 Oct in India.
const BEFORE_MIDNIGHT_IST = new Date("2026-10-26T18:29:59Z");
const AFTER_MIDNIGHT_IST = new Date("2026-10-26T18:30:00Z");

describe("Today and date resolution (Asia/Kolkata)", () => {
  it("today flips exactly at local midnight, not UTC midnight", () => {
    expect(todayInTimeZone("Asia/Kolkata", BEFORE_MIDNIGHT_IST)).toBe("2026-10-26");
    expect(todayInTimeZone("Asia/Kolkata", AFTER_MIDNIGHT_IST)).toBe("2026-10-27");
    // At UTC midnight India is already 05:30 on the same date.
    expect(todayInTimeZone("Asia/Kolkata", new Date("2026-10-27T00:00:00Z"))).toBe("2026-10-27");
  });

  it("msUntilNextDay counts down to the next local midnight", () => {
    expect(msUntilNextDay("Asia/Kolkata", new Date("2026-10-26T18:29:30Z"))).toBe(30_000);
    expect(msUntilNextDay("Asia/Kolkata", AFTER_MIDNIGHT_IST)).toBe(86_400_000);
    // DST zone: New York on the night clocks fall back (1 Nov 2026) has a 25-hour day.
    expect(msUntilNextDay("America/New_York", new Date("2026-11-01T04:00:00Z"))).toBe(25 * 3600_000);
  });

  it("no ?date means today; the same call after midnight returns the new day", async () => {
    const owner = await createBareOwner("a");
    expect((await resolveDate(owner, undefined, BEFORE_MIDNIGHT_IST)).date).toBe("2026-10-26");
    const after = await resolveDate(owner, undefined, AFTER_MIDNIGHT_IST);
    expect(after).toMatchObject({ date: "2026-10-27", today: "2026-10-27", invalidRequest: false });
  });

  it("a valid ?date is honoured as given, never replaced by today", async () => {
    const owner = await createBareOwner("a");
    const r = await resolveDate(owner, "2026-10-26", AFTER_MIDNIGHT_IST);
    expect(r).toMatchObject({ date: "2026-10-26", today: "2026-10-27", invalidRequest: false });
    expect((await resolveDate(owner, "2027-01-05", AFTER_MIDNIGHT_IST)).date).toBe("2027-01-05");
  });

  it("an invalid ?date falls back to today and is flagged", async () => {
    const owner = await createBareOwner("a");
    for (const bad of ["2026-02-30", "yesterday", "2026-10-1"]) {
      expect(await resolveDate(owner, bad, AFTER_MIDNIGHT_IST)).toMatchObject({ date: "2026-10-27", invalidRequest: true });
    }
    expect((await resolveDate(owner, ["2026-10-01", "x"], AFTER_MIDNIGHT_IST)).date).toBe("2026-10-27");
  });

  it("every section of a day view belongs to the requested date", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      food_entries: [
        { id: "y", date: "2026-10-26", name: "Yesterday", calories: 500 },
        { id: "t", date: "2026-10-27", name: "Today", calories: 300 },
      ],
      workouts: [{ id: "w", date: "2026-10-26", name: "Yesterday workout" }],
      daily_activity: [{ date: "2026-10-26", steps: 1000 }],
      daily_notes: [{ date: "2026-10-26", text: "Yesterday note" }],
    });
    const ctx = await resolveDate(owner, "2026-10-26", AFTER_MIDNIGHT_IST);
    const v = await getDayView(owner, ctx.date, ctx);
    expect(v.date).toBe("2026-10-26");
    expect(v.today).toBe("2026-10-27");
    expect(v.summary.date).toBe("2026-10-26");
    expect(v.meals.flatMap((m) => m.entries.map((e) => e.date))).toEqual(["2026-10-26"]);
    expect(v.workouts.map((w) => w.date)).toEqual(["2026-10-26"]);
    expect(v.note).toBe("Yesterday note");
    expect(v.summary.steps).toBe(1000);
    // The 7-day chart ends on the viewed date and runs back exactly six days.
    expect(v.week.map((d) => d.date)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(v.week.at(-1)!.food.totals.calories).toBe(500);
  });
});

describe("History", () => {
  async function seeded() {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      food_entries: [{ date: "2026-10-03", name: "Oats", calories: 300, protein_g: 10, carbs_g: 50, fat_g: 5, fiber_g: 8 }],
      workouts: [{ date: "2026-10-05", name: "Legs" }],
      daily_activity: [{ date: "2026-10-07", steps: 8000 }, { date: "2026-10-08", weight_kg: 80 }],
      daily_notes: [{ date: "2026-10-09", text: "Rest day" }],
      body_measurements: [{ date: "2026-10-10", waist_cm: 84 }],
    });
    // An activity row with no values is not a record of anything.
    await prisma.dailyActivity.create({ data: { ownerId: owner, id: "empty", date: new Date("2026-10-11") } });
    return owner;
  }

  it("shows only days with meaningful records by default, including non-food days", async () => {
    const owner = await seeded();
    const { range } = resolveHistoryRange({ month: "2026-10" }, "2026-10-27");
    const h = await getHistory(owner, range, "2026-10-27", false);
    expect(h.days.map((d) => d.summary.date)).toEqual(["2026-10-10", "2026-10-09", "2026-10-08", "2026-10-07", "2026-10-05", "2026-10-03"]);
    expect(h.loggedDays).toBe(6);
    expect(h.totalDays).toBe(27); // range stops at today
  });

  it("Show all dates lists every date, empty ones included", async () => {
    const owner = await seeded();
    const { range } = resolveHistoryRange({ month: "2026-10" }, "2026-10-27");
    const h = await getHistory(owner, range, "2026-10-27", true);
    expect(h.days).toHaveLength(27);
    expect(h.days.find((d) => d.summary.date === "2026-10-11")!.summary.has_data).toBe(false);
    expect(h.loggedDays).toBe(6);
  });

  it("an empty month has no logged days; averages are absent, not zero", async () => {
    const owner = await seeded();
    const { range } = resolveHistoryRange({ month: "2026-08" }, "2026-10-27");
    const h = await getHistory(owner, range, "2026-10-27", false);
    expect(h).toMatchObject({ days: [], loggedDays: 0, totalDays: 31, avgCalories: null, avgSteps: null });
  });

  it("average calories use only days whose calories are exact", () => {
    const day = (date: string, cal: number, complete: boolean) =>
      ({
        date,
        has_data: true,
        food: { entries: 1, complete, nutrient_complete: { calories: complete }, totals: { calories: cal }, missing: { calories: complete ? 0 : 1 } },
        workouts: { count: 0 },
        cardio: { count: 0 },
        steps: null,
      }) as never;
    const h = buildHistory([day("2026-10-01", 2000, true), day("2026-10-02", 500, false)], "2026-10-27", false);
    expect(h).toMatchObject({ avgCalories: 2000, calorieDays: 1 });
  });

  it("validates custom ranges and caps them at today", () => {
    expect(resolveHistoryRange({ from: "2026-10-01", to: "2026-12-01" }, "2026-10-27").range).toMatchObject({ kind: "range", to: "2026-10-27" });
    expect(resolveHistoryRange({ from: "2026-10-20", to: "2026-10-01" }, "2026-10-27").error).toMatch(/start before end/);
  });
});

describe("Settings: profile and targets", () => {
  it("saves only the values given; blank profile fields are cleared, nothing invented", async () => {
    const owner = await createBareOwner("a");
    const res = await saveProfile(owner, { height_cm: "178", goal: "Fat loss", timezone: "Asia/Kolkata", name: "" }, "2026-10-27");
    expect(res.ok).toBe(true);
    const p = await prisma.profile.findUniqueOrThrow({ where: { ownerId: owner } });
    expect(p).toMatchObject({ heightCm: 178, goal: "Fat loss", name: null, sex: null, birthDate: null });
    expect(await prisma.dailyActivity.count({ where: { ownerId: owner } })).toBe(0);
  });

  it("a weight sent with a profile save is ignored: profile saves never create weigh-ins", async () => {
    const owner = await createBareOwner("a");
    const res = await saveProfile(owner, { timezone: "Asia/Kolkata", current_weight_kg: "81.5" }, "2026-10-27");
    expect(res).toEqual({ ok: true, message: "Profile saved." });
    expect(await prisma.dailyActivity.count({ where: { ownerId: owner } })).toBe(0);
  });

  it("returns field-level errors and saves nothing when any field is invalid", async () => {
    const owner = await createBareOwner("a");
    const res = await saveProfile(owner, { height_cm: "9000", timezone: "Mars/Base", birth_date: "2031-05-01", name: "Sam" }, "2026-10-27");
    expect(res).toMatchObject({ ok: false, fieldErrors: { height_cm: "Must be at most 300", birth_date: "Birth date can't be in the future" } });
    expect((res as { fieldErrors: Record<string, string> }).fieldErrors.timezone).toMatch(/IANA timezone/);
    expect(await prisma.profile.findUniqueOrThrow({ where: { ownerId: owner } })).toMatchObject({ name: null });

    const t = await saveTargets(owner, { effective_from: "2026-10-27", calories: "-5", protein_g: "150" });
    expect(t).toMatchObject({ ok: false, fieldErrors: { calories: "Must be at least 0" } });
    expect(await prisma.targetSet.count({ where: { ownerId: owner } })).toBe(0);
  });

  it("a new target version keeps history and copies omitted values forward", async () => {
    const owner = await createBareOwner("a");
    expect(await saveTargets(owner, { effective_from: "2026-10-01", calories: "2200", protein_g: "150", steps: "8000" })).toMatchObject({
      ok: true,
      message: "New target version saved, effective from 2026-10-01.",
    });
    const second = await saveTargets(owner, { effective_from: "2026-10-20", calories: "2000", protein_g: "" });
    expect(second.ok && second.message).toBe(
      "New target version saved, effective from 2026-10-20. Protein, steps copied from the version effective 2026-10-01.",
    );
    const rows = await prisma.targetSet.findMany({ where: { ownerId: owner }, orderBy: { effectiveFrom: "asc" } });
    expect(rows.map((r) => [r.calories, r.proteinG, r.steps])).toEqual([
      [2200, 150, 8000],
      [2000, 150, 8000],
    ]);
    // Each day is judged against the version in effect on that day.
    const [oct10] = await computeDailySummaries(owner, "2026-10-10", "2026-10-10");
    const [oct25] = await computeDailySummaries(owner, "2026-10-25", "2026-10-25");
    expect([oct10.targets!.calories, oct25.targets!.calories]).toEqual([2200, 2000]);
  });

  it("saving again for the same date updates that version only", async () => {
    const owner = await createBareOwner("a");
    await saveTargets(owner, { effective_from: "2026-10-01", calories: "2200" });
    await saveTargets(owner, { effective_from: "2026-10-20", calories: "2000" });
    expect(await saveTargets(owner, { effective_from: "2026-10-20", fiber_g: "30" })).toMatchObject({ ok: true, message: "Target version updated, effective from 2026-10-20." });
    const rows = await prisma.targetSet.findMany({ where: { ownerId: owner }, orderBy: { effectiveFrom: "asc" } });
    expect(rows.map((r) => [r.calories, r.fiberG])).toEqual([
      [2200, null],
      [2000, 30],
    ]);
  });

  it("requires at least one target", async () => {
    const owner = await createBareOwner("a");
    expect(await saveTargets(owner, { effective_from: "2026-10-01" })).toMatchObject({ ok: false, error: "Enter at least one target." });
  });
});

describe("Suggested targets", () => {
  const base = {
    sex: "male",
    birthDate: "1996-04-10",
    today: "2026-10-27",
    heightCm: 178,
    weight: { kg: 80, date: "2026-10-27" },
    activityLevel: "Moderately active",
    goal: "Fat loss",
  };

  it("lists what is missing instead of guessing", () => {
    expect(suggestTargets({ ...base, weight: null, sex: "other" })).toEqual({
      ok: false,
      missing: ["sex (male or female, used by the formula)", "a weight (record one under Body weight)"],
    });
  });

  it("computes Mifflin-St Jeor based estimates with a transparent basis", () => {
    const s = suggestTargets(base);
    if (!s.ok) throw new Error("expected a suggestion");
    // BMR = 800 + 1112.5 - 150 + 5 = 1767.5; × 1.55 = 2739.6; × 0.8 = 2191.7 → 2190
    expect(s.values).toEqual({ calories: 2190, protein_g: 160, fat_g: 66, carbs_g: 239, fiber_g: 31 });
    expect(s.basis[1]).toContain("1768 kcal for age 30");
    expect(s.basis[0]).toBe("Weight used: 80 kg, recorded 2026-10-27 (today)");
    expect(s.warnings).toEqual([]);
  });
});

describe("Completeness and totals agree across views", () => {
  it("dashboard, history, trends and exports report the same totals and partial flags", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      date: "2026-10-20",
      targets: [{ effective_from: "2026-10-01", calories: 2000, protein_g: 150 }],
      food_entries: [
        { name: "Rice", calories: 400.4, protein_g: 8.3, carbs_g: 88, fat_g: 1, fiber_g: 1 },
        { name: "Chicken", calories: 300.3, protein_g: 55.1, carbs_g: 0, fat_g: 7, fiber_g: 0 },
        { name: "Mystery sauce" },
      ],
    });
    const day = (await getDayView(owner, "2026-10-20")).summary;
    const hist = (await getHistory(owner, resolveHistoryRange({ month: "2026-10" }, "2026-10-27").range, "2026-10-27", false)).days[0].summary;
    const trend = (await getTrends(owner, "2026-10-20", "2026-10-20")).days[0];
    const exp = (await exportData(owner, { scope: "day", date: "2026-10-20" })).export_meta.daily_totals![0];

    expect(day.food.totals.calories).toBe(700.7);
    expect(hist.food.totals.calories).toBe(day.food.totals.calories);
    expect(trend.calories).toBe(day.food.totals.calories);
    expect(exp.calories).toBe(day.food.totals.calories);
    expect(day.food.complete).toBe(false);
    expect(hist.food.complete).toBe(false);
    expect(trend.complete).toBe(false);
    expect(exp.nutrition_complete).toBe(false);
    expect(day.food.missing.calories).toBe(1);
    // Unknown is excluded from adherence, not counted as a miss or a hit.
    const t = await getTrends(owner, "2026-10-20", "2026-10-20");
    expect(t.adherence.calorie).toEqual({ on_target: 0, evaluated: 0 });
    expect(t.weeks[0]).toMatchObject({ days_logged: 1, calorie_days: 0, avg_calories: null });
  });

  it("one weigh-in never reports a weight trend", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", daily_activity: [{ date: "2026-10-05", weight_kg: 80 }] });
    const t = await getTrends(owner, "2026-10-01", "2026-10-20");
    expect(t.weight).toMatchObject({ weigh_ins: 1, trend_change_kg: null });
  });
});
