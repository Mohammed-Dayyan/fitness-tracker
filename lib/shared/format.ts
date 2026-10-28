import { dateToDb } from "./dates";

// Calendar dates are formatted in UTC because they are stored as UTC midnight;
// this never shifts the day regardless of the viewer's timezone.

export function fmtNumber(v: number | null | undefined, digits = 0): string {
  if (v == null) return "–";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtDateLong(date: string): string {
  return dateToDb(date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function fmtDateMedium(date: string): string {
  return dateToDb(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function fmtDateShort(date: string): string {
  return dateToDb(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function fmtMonth(month: string): string {
  return dateToDb(`${month}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function fmtWeekdayLetter(date: string): string {
  return dateToDb(date).toLocaleDateString("en-GB", { weekday: "narrow", timeZone: "UTC" });
}

export function addMonths(month: string, delta: number): string {
  const d = dateToDb(`${month}-01`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}
