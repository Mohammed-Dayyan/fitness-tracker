import { addDays, daysBetweenInclusive, isValidDateString } from "./dates";

export const MAX_TREND_DAYS = 366;

export type TrendRange = {
  key: string;
  from: string;
  to: string;
  /** The request was invalid; a default range is shown instead. */
  error: string | null;
  /** The request was adjusted (e.g. future dates cut off); the range shown is what was used. */
  notice: string | null;
};

/**
 * ?range=7|30|90|mtd|custom[&from=&to=]. Ranges never extend past today:
 * future days have no records and would inflate day counts and denominators.
 */
export function resolveTrendRange(sp: Record<string, string | string[] | undefined>, today: string): TrendRange {
  const range = typeof sp.range === "string" ? sp.range : "30";
  const from = typeof sp.from === "string" ? sp.from : "";
  const to = typeof sp.to === "string" ? sp.to : "";
  const fallback = (error: string): TrendRange => ({ key: "30", from: addDays(today, -29), to: today, error, notice: null });

  if (range === "custom") {
    const invalid = `Custom range must be valid dates, start before end, and at most ${MAX_TREND_DAYS} days. Showing the last 30 days.`;
    if (!(isValidDateString(from) && isValidDateString(to) && from <= to)) return fallback(invalid);
    if (from > today) return fallback("The start date is in the future, so there is nothing to show yet. Showing the last 30 days.");
    // Cut the end at today first: the length limit applies to the days actually shown.
    const end = to > today ? today : to;
    if (daysBetweenInclusive(from, end) > MAX_TREND_DAYS) return fallback(invalid);
    return {
      key: "custom",
      from,
      to: end,
      error: null,
      notice: end !== to ? `Future dates are not included: the range ends today (${today}).` : null,
    };
  }
  if (range === "mtd") return { key: "mtd", from: `${today.slice(0, 7)}-01`, to: today, error: null, notice: null };
  const days = range === "7" ? 7 : range === "90" ? 90 : 30;
  return { key: String(days), from: addDays(today, -(days - 1)), to: today, error: null, notice: null };
}
