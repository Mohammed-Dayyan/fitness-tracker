// Calendar dates are plain "YYYY-MM-DD" strings in the owner's timezone.
// In Postgres they are DATE columns, which Prisma maps to a JS Date at UTC
// midnight, so conversion is purely mechanical and never timezone-shifted.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isValidDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidMonthString(value: string): boolean {
  const m = MONTH_RE.exec(value);
  return !!m && isValidDateString(`${m[1]}-${m[2]}-01`);
}

export function dateToDb(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function dbToDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date "now" falls on in the given IANA timezone. */
export function todayInTimeZone(tz: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(value: string, days: number): string {
  const d = dateToDb(value);
  d.setUTCDate(d.getUTCDate() + days);
  return dbToDate(d);
}

export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const next = dateToDb(from);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(0);
  return { from, to: dbToDate(next) };
}

export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((dateToDb(to).getTime() - dateToDb(from).getTime()) / 86_400_000) + 1;
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** UTC offset of a timezone at an instant, in minutes (e.g. +330 for Asia/Kolkata). */
function offsetMinutes(tz: string, at: Date): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part ?? "");
  if (!m) return 0; // "GMT" alone means UTC
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/**
 * Milliseconds from `now` until the next local midnight in `tz`. Sent to the
 * browser as a duration (not a timestamp), so a wrong device clock cannot
 * shift when the page decides that "today" has changed.
 */
export function msUntilNextDay(tz: string, now: Date = new Date()): number {
  const tomorrow = addDays(todayInTimeZone(tz, now), 1);
  const utcMidnight = dateToDb(tomorrow).getTime();
  // Two passes handle a DST change between now and midnight.
  let instant = utcMidnight - offsetMinutes(tz, new Date(utcMidnight)) * 60_000;
  instant = utcMidnight - offsetMinutes(tz, new Date(instant)) * 60_000;
  return Math.max(1000, instant - now.getTime());
}
