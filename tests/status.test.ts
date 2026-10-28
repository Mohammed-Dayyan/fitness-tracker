import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STATUS } from "@/components/dashboard";
import { StatusStrip } from "@/components/status-strip";
import { NUTRIENTS, type DailySummary, type Nutrient } from "@/lib/server/summary";
import { dailyVerdict, RULES, type VerdictStatus } from "@/lib/server/verdict";
import { TARGET_RULES } from "@/lib/shared/targets-policy";

const TODAY = "2026-10-28";
const PAST = "2026-10-20";

const TARGET: Record<Nutrient | "steps", number> = { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, fiber_g: 30, steps: 8000 };

/** A synthetic day: every measure is "ok" unless overridden; no database involved. */
function day(opts: { date?: string; overrides?: Partial<Record<Nutrient | "steps", number | null>>; missing?: Nutrient[]; food?: boolean; steps?: number | null; targets?: boolean } = {}): DailySummary {
  const food = opts.food ?? true;
  const totals = Object.fromEntries(NUTRIENTS.map((k) => [k, k in (opts.overrides ?? {}) ? (opts.overrides![k] ?? 0) : TARGET[k]])) as Record<Nutrient, number>;
  const missing = Object.fromEntries(NUTRIENTS.map((k) => [k, opts.missing?.includes(k) ? 1 : 0])) as Record<Nutrient, number>;
  const incomplete = NUTRIENTS.some((k) => missing[k] > 0) ? 1 : 0;
  const steps = "steps" in (opts.overrides ?? {}) ? (opts.overrides!.steps ?? null) : (opts.steps === undefined ? TARGET.steps : opts.steps);
  return {
    date: opts.date ?? PAST,
    food: {
      entries: food ? 2 : 0,
      totals,
      missing,
      incomplete_entries: incomplete,
      estimated_entries: 0,
      nutrient_complete: Object.fromEntries(NUTRIENTS.map((k) => [k, food && missing[k] === 0])) as Record<Nutrient, boolean>,
      complete: food && incomplete === 0,
    },
    targets: opts.targets === false ? null : { effective_from: "2026-01-01", ...TARGET },
    workouts: { count: 0, sets: 0, duration_min: 0, estimated_calories: null },
    cardio: { count: 0, duration_min: 0, distance_km: 0, estimated_calories: null },
    estimated_exercise_calories: null,
    steps,
    weight_kg: null,
    measurements: 0,
    has_note: false,
    has_data: true,
  };
}

const verdict = (d: DailySummary) => dailyVerdict(d, TODAY);
const LABEL: Record<Nutrient, string> = { calories: "Calories", protein_g: "Protein", carbs_g: "Carbs", fat_g: "Fat", fiber_g: "Fiber" };

describe("day status describes the whole day, never one nutrient", () => {
  it("calories AND protein both low: Under target, naming both (the old 'Low protein' would have misled)", () => {
    const v = verdict(day({ overrides: { calories: 1500, protein_g: 90 } }));
    expect(v.status).toBe("under");
    expect(v.headline).toBe("Calories and protein are under target.");
    expect(v.off).toEqual({ under: ["calories", "protein_g"], over: [] });
  });

  it("three measures low: all are listed", () => {
    expect(verdict(day({ overrides: { calories: 1500, protein_g: 90, fiber_g: 5 } })).headline).toBe("Calories, protein and fiber are under target.");
  });

  it("some under and some over: Mixed, in one sentence", () => {
    const v = verdict(day({ overrides: { calories: 1500, fat_g: 100 } }));
    expect(v.status).toBe("mixed");
    expect(v.headline).toBe("Calories are under target; fat is over target.");
    expect(v.off).toEqual({ under: ["calories"], over: ["fat_g"] });
  });

  it("only over: Over target", () => {
    const v = verdict(day({ overrides: { calories: 2600 } }));
    expect(v.status).toBe("over");
    expect(v.headline).toBe("Calories are over target.");
  });

  it("a low steps count on an otherwise perfect day is Under target, and says steps", () => {
    const v = verdict(day({ overrides: { steps: 4000 } }));
    expect(v.status).toBe("under");
    expect(v.headline).toBe("Steps are under target.");
  });

  it("steps not recorded is a next step, never 'under'", () => {
    const v = verdict(day({ overrides: { steps: null } }));
    expect(v.status).toBe("on_target");
    expect(v.actions).toContain("Log steps if available");
  });

  it("today: a shortfall is 'still to go' (In progress), not Under; an excess today is Over", () => {
    const short = dailyVerdict(day({ date: TODAY, overrides: { calories: 800, protein_g: 40 } }), TODAY);
    expect(short.status).toBe("in_progress");
    expect(short.off).toEqual({ under: [], over: [] });
    expect(short.checks.find((c) => c.key === "calories")!.status).toBe("remaining");
    const over = dailyVerdict(day({ date: TODAY, overrides: { calories: 2600 } }), TODAY);
    expect(over.status).toBe("over");
  });

  it("unknown values never count as under: they only add an 'incomplete' note", () => {
    const v = verdict(day({ overrides: { fiber_g: 5 }, missing: ["fiber_g"] }));
    expect(v.status).toBe("incomplete");
    expect(v.off.under).toEqual([]);
    const withMiss = verdict(day({ overrides: { calories: 1500, fiber_g: 5 }, missing: ["fiber_g"] }));
    expect(withMiss.status).toBe("under");
    expect(withMiss.headline).toBe("Calories are under target. Fiber total is incomplete.");
  });

  it("a finished day without food is Incomplete even if steps were low; no targets means In progress", () => {
    expect(verdict(day({ food: false, overrides: { steps: 100 } })).status).toBe("incomplete");
    expect(verdict(day({ targets: false })).status).toBe("in_progress");
  });

  it("future and empty days have their own statuses", () => {
    expect(dailyVerdict(day({ date: "2026-11-01" }), TODAY).status).toBe("future");
    expect(dailyVerdict({ ...day(), has_data: false }, TODAY).status).toBe("no_data");
  });
});

describe("status over every combination of ok / under / over for the five nutrients (243 days)", () => {
  const values = {
    ok: (k: Nutrient) => TARGET[k],
    low: (k: Nutrient) => Math.floor(TARGET[k] * (TARGET_RULES[k].low - 0.15)), // clearly under the lower bound
    high: (k: Nutrient) => Math.ceil(TARGET[k] * ((TARGET_RULES[k].high ?? 1.1) + 0.25)), // clearly over (only where an upper bound exists)
  };
  const states = ["ok", "low", "high"] as const;
  // Protein and fiber have no upper bound, so "high" is not "over" for them: treat as ok.
  const effective = (k: Nutrient, s: (typeof states)[number]) => (s === "high" && TARGET_RULES[k].high == null ? "ok" : s);

  it("direction, headline and off-lists always match what is actually off", () => {
    let checked = 0;
    for (let i = 0; i < 3 ** 5; i++) {
      const combo = NUTRIENTS.map((_, bit) => states[Math.floor(i / 3 ** bit) % 3]);
      const overrides = Object.fromEntries(NUTRIENTS.map((k, bit) => [k, values[combo[bit]](k)])) as Partial<Record<Nutrient, number>>;
      const v = verdict(day({ overrides }));
      const under = NUTRIENTS.filter((k, bit) => effective(k, combo[bit]) === "low");
      const over = NUTRIENTS.filter((k, bit) => effective(k, combo[bit]) === "high");
      const label = JSON.stringify(combo);

      const expected: VerdictStatus = under.length && over.length ? "mixed" : under.length ? "under" : over.length ? "over" : "on_target";
      expect(v.status, label).toBe(expected);
      expect([...v.off.under].sort(), label).toEqual([...under].sort());
      expect([...v.off.over].sort(), label).toEqual([...over].sort());
      // The headline names every measure that is off and none that is fine.
      if (expected !== "on_target") {
        for (const k of NUTRIENTS) {
          const named = new RegExp(`\\b${LABEL[k]}\\b`, "i").test(v.headline);
          expect(named, `${label}: ${k} in "${v.headline}"`).toBe(under.includes(k) || over.includes(k));
        }
      }
      checked++;
    }
    expect(checked).toBe(243);
  });
});

describe("status strip and status labels", () => {
  it("every status has a label, an icon and a tone", () => {
    const all: VerdictStatus[] = ["no_data", "future", "in_progress", "incomplete", "on_target", "under", "over", "mixed"];
    expect(Object.keys(STATUS).sort()).toEqual([...all].sort());
    expect(STATUS.under.label).toBe("Under target");
    expect(STATUS.mixed.label).toBe("Mixed");
    for (const s of all) expect(STATUS[s].label.length).toBeGreaterThan(0);
  });

  it("one marker per measure, each with a symbol and a spoken label (never colour alone)", () => {
    const v = verdict(day({ overrides: { calories: 1500, fat_g: 100, fiber_g: 5, steps: null }, missing: ["fiber_g"] }));
    const html = renderToStaticMarkup(StatusStrip({ checks: v.checks }));
    expect((html.match(/<li /g) ?? []).length).toBe(RULES.length);
    for (const spoken of ["Calories: under target", "Protein: on target", "Carbs: on target", "Fat: over target", "Fiber: incomplete data", "Steps: nothing logged"]) {
      expect(html, spoken).toContain(spoken);
    }
    for (const symbol of ["Cal ↓", "Pro ✓", "Fat ↑", "Fib ?", "Steps –"]) expect(html, symbol).toContain(symbol);
  });

  it("shows a dash, not a verdict, for measures without a target", () => {
    const v = verdict(day({ targets: false }));
    const html = renderToStaticMarkup(StatusStrip({ checks: v.checks }));
    expect(html).toContain("Calories: no target set");
    expect(html).not.toContain("under target");
  });

  it("renders nothing without checks (future days)", () => {
    expect(renderToStaticMarkup(StatusStrip({ checks: [] }))).toBe("");
  });
});
