import { NextResponse } from "next/server";
import { daysBetweenInclusive, isValidDateString, isValidMonthString, todayInTimeZone } from "@/lib/shared/dates";
import { exportData, exportFilename, type ExportScope } from "@/lib/server/export";
import { jsonError, withOwner } from "@/lib/server/http";
import { getTimezone } from "@/lib/server/repo";

function parseScope(params: URLSearchParams): ExportScope | string {
  const scope = params.get("scope") ?? "all";
  if (scope === "all") return { scope };
  if (scope === "day") {
    const date = params.get("date") ?? "";
    return isValidDateString(date) ? { scope, date } : "scope=day needs date=YYYY-MM-DD";
  }
  if (scope === "month") {
    const month = params.get("month") ?? "";
    return isValidMonthString(month) ? { scope, month } : "scope=month needs month=YYYY-MM";
  }
  if (scope === "range") {
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    if (!isValidDateString(from) || !isValidDateString(to)) return "scope=range needs from and to as YYYY-MM-DD";
    if (from > to) return "from must not be after to";
    if (daysBetweenInclusive(from, to) > 3700) return "range is limited to about 10 years";
    return { scope, from, to };
  }
  return "scope must be all, day, month or range";
}

/**
 * GET /api/export?scope=all|day|month|range[&date=|&month=|&from=&to=][&download=1]
 * Returns the records in import format (schema 1.0).
 */
export const GET = withOwner(async (req, { ownerId }) => {
  const scope = parseScope(req.nextUrl.searchParams);
  if (typeof scope === "string") return jsonError(400, scope);

  const data = await exportData(ownerId, scope);
  const res = NextResponse.json(data);
  if (req.nextUrl.searchParams.get("download") === "1") {
    const today = todayInTimeZone(await getTimezone(ownerId));
    res.headers.set("Content-Disposition", `attachment; filename="${exportFilename(scope, today)}"`);
  }
  return res;
});
