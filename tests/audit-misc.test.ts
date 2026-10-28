import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { buildExerciseHistory, buildExerciseStats, getSetRows } from "@/lib/server/exercises";
import { previewImport } from "@/lib/server/import";
import { listWorkoutsWithSets } from "@/lib/server/repo";
import { saveProfile, saveWeighIn } from "@/lib/server/settings";
import { addDays, todayInTimeZone } from "@/lib/shared/dates";
import { exerciseKeyFromQuery } from "@/lib/shared/exercise";
import { canonicalActivity, canonicalGoal } from "@/lib/shared/profile-terms";
import { safeNextPath } from "@/lib/shared/redirect";
import { suggestTargets } from "@/lib/shared/suggest-targets";
import { createBareOwner, importOk } from "./helpers/factory";

const TODAY = "2026-10-27";

describe("audit #3: weigh-ins are explicit, dated and never a side effect of a profile save", () => {
  it("repeated profile saves (even with a stale weight in the request) create no weigh-ins", async () => {
    const owner = await createBareOwner("a");
    for (let i = 0; i < 3; i++) await saveProfile(owner, { timezone: "Asia/Kolkata", height_cm: "178", current_weight_kg: "81.5" }, TODAY);
    expect(await prisma.dailyActivity.count({ where: { ownerId: owner } })).toBe(0);
  });

  it("an explicit weigh-in is recorded for its date, with a clear confirmation", async () => {
    const owner = await createBareOwner("a");
    const res = await saveWeighIn(owner, { date: "2026-10-26", weight_kg: "81.5" }, TODAY);
    expect(res).toEqual({ ok: true, message: "Weight 81.5 kg recorded for 2026-10-26." });
    const rows = await prisma.dailyActivity.findMany({ where: { ownerId: owner } });
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.weightKg])).toEqual([["2026-10-26", 81.5]]);
  });

  it("recording again for the same date replaces that weight (one record per day), keeps steps, and says so", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", daily_activity: [{ date: TODAY, steps: 9000, weight_kg: 80 }] });
    const res = await saveWeighIn(owner, { date: TODAY, weight_kg: "79.5" }, TODAY);
    expect(res).toEqual({ ok: true, message: "Weight 79.5 kg recorded for 2026-10-27. It replaced 80 kg." });
    const rows = await prisma.dailyActivity.findMany({ where: { ownerId: owner } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ steps: 9000, weightKg: 79.5 });
    // Submitting the identical value again changes nothing and doesn't claim a replacement.
    expect(await saveWeighIn(owner, { date: TODAY, weight_kg: "79.5" }, TODAY)).toEqual({ ok: true, message: "Weight 79.5 kg recorded for 2026-10-27." });
    expect(await prisma.dailyActivity.count({ where: { ownerId: owner } })).toBe(1);
  });

  it("validates date and weight with field-level errors, and never accepts a future date", async () => {
    const owner = await createBareOwner("a");
    expect(await saveWeighIn(owner, { date: "2026-10-28", weight_kg: "80" }, TODAY)).toMatchObject({ ok: false, fieldErrors: { date: "Date can't be in the future" } });
    expect(await saveWeighIn(owner, { date: "2026-02-30", weight_kg: "80" }, TODAY)).toMatchObject({ ok: false, fieldErrors: { date: "Enter a valid date" } });
    expect(await saveWeighIn(owner, { date: TODAY, weight_kg: "" }, TODAY)).toMatchObject({ ok: false, fieldErrors: { weight_kg: "Enter a weight" } });
    expect(await saveWeighIn(owner, { date: TODAY, weight_kg: "abc" }, TODAY)).toMatchObject({ ok: false, fieldErrors: { weight_kg: "Enter a number" } });
    expect(await saveWeighIn(owner, { date: TODAY, weight_kg: "5" }, TODAY)).toMatchObject({ ok: false });
    expect(await prisma.dailyActivity.count({ where: { ownerId: owner } })).toBe(0);
  });

  it("a form left open past midnight can't invent a future day: its stale date still validates against the new today", async () => {
    const owner = await createBareOwner("a");
    // The form was loaded on the 26th; it now submits on the 27th with the date it showed (the 26th): recorded on the 26th.
    expect((await saveWeighIn(owner, { date: "2026-10-26", weight_kg: "80" }, "2026-10-27")).ok).toBe(true);
    // Had the page been loaded on the 28th and the server is still on the 27th, the 28th is rejected.
    expect((await saveWeighIn(owner, { date: "2026-10-28", weight_kg: "80" }, "2026-10-27")).ok).toBe(false);
  });
});

describe("audit #11: birth dates", () => {
  it("settings: today is allowed, tomorrow and impossible dates are rejected, per the owner's own day", async () => {
    const owner = await createBareOwner("a");
    expect((await saveProfile(owner, { timezone: "Asia/Kolkata", birth_date: TODAY }, TODAY)).ok).toBe(true);
    expect(await saveProfile(owner, { timezone: "Asia/Kolkata", birth_date: "2026-10-28" }, TODAY)).toMatchObject({
      ok: false,
      fieldErrors: { birth_date: "Birth date can't be in the future" },
    });
    expect(await saveProfile(owner, { timezone: "Asia/Kolkata", birth_date: "2026-02-30" }, TODAY)).toMatchObject({ ok: false });
    expect(await saveProfile(owner, { timezone: "Asia/Kolkata", birth_date: "1899-12-31" }, TODAY)).toMatchObject({ ok: false });
  });

  it("import: judged on the owner's calendar day, so the same date can be valid in one timezone and future in another", async () => {
    const east = await createBareOwner("east");
    const west = await createBareOwner("west");
    await importOk(east, { schema_version: "1.0", profile: { timezone: "Pacific/Kiritimati" } }); // UTC+14
    await importOk(west, { schema_version: "1.0", profile: { timezone: "Etc/GMT+12" } }); // UTC-12
    const eastToday = todayInTimeZone("Pacific/Kiritimati");
    expect(eastToday > todayInTimeZone("Etc/GMT+12")).toBe(true); // 26 h apart: always a later calendar date

    expect((await importOk(east, { schema_version: "1.0", profile: { birth_date: eastToday } })).counts.rejected).toBe(0);
    const bad = await importOk(west, { schema_version: "1.0", profile: { birth_date: eastToday } });
    expect(bad.counts.rejected).toBe(1);
    expect(bad.errors[0]).toMatch(/profile\.birth_date: .* is in the future \(today is .* in Etc\/GMT\+12\)/);
    expect((await prisma.profile.findFirstOrThrow({ where: { ownerId: west } })).birthDate).toBeNull();
  });

  it("an unrelated profile import isn't blocked by a birth date that was already stored", async () => {
    const owner = await createBareOwner("a");
    await prisma.profile.update({ where: { ownerId: owner }, data: { birthDate: new Date(`${addDays(todayInTimeZone("Asia/Kolkata"), 30)}T00:00:00Z`) } });
    expect((await importOk(owner, { schema_version: "1.0", profile: { height_cm: 180 } })).counts).toMatchObject({ updated: 1, rejected: 0 });
  });

  it("suggested targets refuse an implausible age instead of computing with it", () => {
    const base = { sex: "male", today: TODAY, heightCm: 178, weight: { kg: 80, date: TODAY }, activityLevel: "Sedentary", goal: "Maintenance" };
    const young = suggestTargets({ ...base, birthDate: "2020-01-01" });
    expect(young.ok === false && young.missing[0]).toMatch(/plausible birth date.*yours gives 6/);
    expect(suggestTargets({ ...base, birthDate: "1900-01-01" }).ok).toBe(false);
    expect(suggestTargets({ ...base, birthDate: "1996-01-01" }).ok).toBe(true);
  });
});

describe("audit #12: goals, activity levels and stale weights", () => {
  it("recognises common wordings of the canonical goals and activity levels", () => {
    const goals: [string, string | null][] = [
      ["recomp", "Body recomposition"],
      ["Body Recomposition", "Body recomposition"],
      ["Lean bulk", "Muscle gain"],
      ["cut", "Fat loss"],
      ["  MAINTAIN ", "Maintenance"],
      ["marathon training", null],
      ["", null],
    ];
    for (const [raw, want] of goals) expect(canonicalGoal(raw), raw).toBe(want);
    expect(canonicalActivity("moderate")).toBe("Moderately active");
    expect(canonicalActivity("Very Active!")).toBe("Very active");
    expect(canonicalActivity("couch")).toBeNull();
  });

  it("an imported goal such as 'recomp' is stored as given and still drives suggestions", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, { schema_version: "1.0", profile: { goal: "recomp", activity_level: "moderate", sex: "male", birth_date: "1996-04-10", height_cm: 178 } });
    const p = await prisma.profile.findUniqueOrThrow({ where: { ownerId: owner } });
    expect(p.goal).toBe("recomp"); // not rewritten
    const s = suggestTargets({ sex: p.sex, birthDate: "1996-04-10", today: TODAY, heightCm: p.heightCm, weight: { kg: 80, date: TODAY }, activityLevel: p.activityLevel, goal: p.goal });
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.basis.join("\n")).toContain('"Body recomposition" (from "recomp")');
      expect(s.basis.join("\n")).toContain('"Moderately active" (from "moderate")');
    }
  });

  it("an unrecognised goal is reported as such, not as 'missing'", () => {
    const s = suggestTargets({ sex: "male", birthDate: "1996-04-10", today: TODAY, heightCm: 178, weight: { kg: 80, date: TODAY }, activityLevel: "Sedentary", goal: "marathon training" });
    expect(s.ok === false && s.missing[0]).toMatch(/a recognised fitness goal \("marathon training" is not one of Body recomposition/);
  });

  it("an old weight is shown with its date and flagged; it is never presented as current", () => {
    const base = { sex: "female", birthDate: "1990-01-01", today: TODAY, heightCm: 165, activityLevel: "Lightly active", goal: "Maintenance" };
    const at = (days: number) => {
      const s = suggestTargets({ ...base, weight: { kg: 70, date: addDays(TODAY, -days) } });
      if (!s.ok) throw new Error("expected a suggestion");
      return s;
    };
    expect(at(0).warnings).toEqual([]);
    expect(at(30).warnings).toEqual([]);
    expect(at(31).warnings[0]).toBe("Your latest weight (70 kg) is from 2026-09-26, 31 days ago. Record a current weigh-in for a better estimate.");
    expect(at(1).basis[0]).toBe("Weight used: 70 kg, recorded 2026-10-26 (yesterday)");
    expect(at(45).basis[0]).toContain("(45 days ago)");
  });

  it("no weight recorded means no suggestion, not a guess", () => {
    const s = suggestTargets({ sex: "male", birthDate: "1996-01-01", today: TODAY, heightCm: 178, weight: null, activityLevel: "Sedentary", goal: "Fat loss" });
    expect(s).toEqual({ ok: false, missing: ["a weight (record one under Body weight)"] });
  });
});

describe("audit #14: post-login destination is always a safe same-site path", () => {
  it("rejects anything that could leave the site", () => {
    expect(safeNextPath("/history?month=2026-09")).toBe("/history?month=2026-09");
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "evil", "", null, undefined]) {
      expect(safeNextPath(bad as string | null | undefined), String(bad)).toBe("/");
    }
  });
});

describe("audit #9: exercise lookups use the stored normalised key", () => {
  it("a display name, odd spacing or case all find the same records; the display name is preserved", async () => {
    const owner = await createBareOwner("a");
    await importOk(owner, {
      schema_version: "1.0",
      workouts: [{ id: "w", date: "2026-10-01", sets: [{ id: "s1", exercise: "Bench Press", set_number: 1, reps: 5, weight_kg: 80 }] }],
    });
    for (const q of ["Bench Press", "bench press", "  BENCH   press ", "bench-press", "Bench_Press!"]) {
      const rows = await getSetRows(owner, exerciseKeyFromQuery(q));
      expect(rows, q).toHaveLength(1);
      expect(buildExerciseStats(rows)[0].name).toBe("Bench Press");
    }
    expect(await getSetRows(owner, exerciseKeyFromQuery("Squat"))).toHaveLength(0);
    expect(exerciseKeyFromQuery("!!!")).toBe("");
    expect(exerciseKeyFromQuery("a".repeat(500)).length).toBe(200);
  });
});

describe("audit #20: workouts are ordered by start time, so PRs go to the earlier session", () => {
  async function seeded() {
    const owner = await createBareOwner("a");
    // Imported in this order, so creation order (a-late, then z-early, then untimed) is the opposite of the clock.
    for (const [id, start] of [["a-late", "18:00"], ["z-early", "09:00"], ["m-untimed", null]] as const) {
      await importOk(owner, {
        schema_version: "1.0",
        workouts: [{ id, date: "2026-10-05", name: id, ...(start ? { start_time: start } : {}), sets: [{ id: `${id}-s`, exercise: "Bench Press", set_number: 1, reps: 5, weight_kg: 100 }] }],
      });
    }
    return owner;
  }

  it("listing and day views are chronological; untimed workouts come last", async () => {
    const owner = await seeded();
    const list = await listWorkoutsWithSets(owner, { from: "2026-10-05", to: "2026-10-05" });
    expect(list.map((w) => w.id)).toEqual(["z-early", "a-late", "m-untimed"]);
  });

  it("an equal lift is a PR for the earlier session only", async () => {
    const owner = await seeded();
    const history = buildExerciseHistory(await getSetRows(owner, "bench press")); // newest first
    expect(history.map((h) => [h.workout_id, h.new_pr])).toEqual([
      ["m-untimed", false],
      ["a-late", false],
      ["z-early", true],
    ]);
  });

  it("a heavier lift later in the day is the PR for that session", async () => {
    const owner = await seeded();
    await importOk(owner, { schema_version: "1.0", exercise_sets: [{ id: "a-late-s", reps: 5, weight_kg: 110 }] });
    const history = buildExerciseHistory(await getSetRows(owner, "bench press"));
    expect(history.find((h) => h.workout_id === "a-late")!.new_pr).toBe(true);
    expect(history.find((h) => h.workout_id === "z-early")!.new_pr).toBe(true);
  });
});

describe("audit: planner and preview stay consistent for an unchanged import", () => {
  it("previewing the same payload twice gives the same token (nothing random leaks into it)", async () => {
    const owner = await createBareOwner("a");
    const payload = { schema_version: "1.0", date: "2026-11-02", daily_activity: [{ steps: 1 }, { weight_kg: 80 }], food_entries: [{ name: "x" }] };
    const a = await previewImport(owner, payload);
    const b = await previewImport(owner, payload);
    expect(a.ok && b.ok && a.preview_token === b.preview_token).toBe(true);
  });
});
