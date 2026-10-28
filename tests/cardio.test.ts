import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoHint, RM_HINT } from "@/components/info-hint";
import { buildCardioStats, cardioSessionsFor, fmtPace, paceMinPerKm, type CardioRow } from "@/lib/server/cardio";

let n = 0;
const row = (o: Partial<CardioRow>): CardioRow => ({
  id: `c${++n}`, date: "2026-10-01", activity: "Running", start_time: null, duration_min: null, distance_km: null,
  avg_heart_rate: null, estimated_calories: null, notes: null, created: n, ...o,
});

describe("cardio grouping", () => {
  it("groups by normalised name, keeps the latest display name, and totals only what exists", () => {
    const stats = buildCardioStats([
      row({ activity: "running", date: "2026-10-01", distance_km: 5, duration_min: 30 }),
      row({ activity: "Running ", date: "2026-10-08", distance_km: 10, duration_min: 55 }),
      row({ activity: "RUNNING", date: "2026-10-10", duration_min: 20 }), // no distance
      row({ activity: "Cycling", date: "2026-10-05", distance_km: 20 }),
    ]);
    expect(stats.map((s) => s.key)).toEqual(["running", "cycling"]);
    const run = stats[0];
    expect(run).toMatchObject({ name: "RUNNING", sessions: 3, last_date: "2026-10-10", total_km: 15, total_min: 105, longest_km: 10, longest_min: 55 });
    expect(run.best_pace_min_per_km).toBeCloseTo(5.5); // 55/10 beats 30/5=6
    expect(stats[1]).toMatchObject({ total_min: 0, longest_min: null, best_pace_min_per_km: null });
  });

  it("never computes a pace from missing, zero or negative values", () => {
    expect(paceMinPerKm(30, null)).toBeNull();
    expect(paceMinPerKm(null, 5)).toBeNull();
    expect(paceMinPerKm(0, 5)).toBeNull();
    expect(paceMinPerKm(30, 0)).toBeNull();
    expect(paceMinPerKm(30, 5)).toBe(6);
    expect(fmtPace(null)).toBe("–");
    expect(fmtPace(5.5)).toBe("5:30 /km");
    expect(fmtPace(5.999)).toBe("6:00 /km");
  });

  it("lists one activity's sessions newest first, matched by key", () => {
    const rows = [row({ activity: "Running", date: "2026-10-01" }), row({ activity: "run", date: "2026-10-02" }), row({ activity: "running", date: "2026-10-09" })];
    expect(cardioSessionsFor(rows, "running").map((r) => r.date)).toEqual(["2026-10-09", "2026-10-01"]);
  });
});

describe("InfoHint", () => {
  it("is a closed, labelled button until tapped", () => {
    const html = renderToStaticMarkup(createElement(InfoHint, { label: "Est. 1RM" } as ComponentProps<typeof InfoHint>, RM_HINT));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="What is Est. 1RM?"');
    expect(html).not.toContain("one-rep max");
  });
});
