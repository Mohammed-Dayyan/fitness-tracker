import "server-only";
// Owner-scoped reads. Every query here filters by ownerId; callers obtain the
// ownerId from the authenticated session (see lib/server/http.ts and
// lib/server/auth/current-owner.ts), never from request input.
import { prisma } from "@/lib/server/db";
import { dateToDb, dbToDate } from "@/lib/shared/dates";
import { rowToJson } from "@/lib/server/import/plan";
import { KINDS, PROFILE_FIELDS, type KindKey } from "@/lib/server/import/spec";

type JsonRecord = Record<string, unknown>;
export type DateRange = { from?: string; to?: string };

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export async function getProfileJson(ownerId: string): Promise<JsonRecord> {
  const row = await prisma.profile.findUnique({ where: { ownerId } });
  const out: JsonRecord = {};
  for (const [key, f] of Object.entries(PROFILE_FIELDS)) {
    const v = row ? (row as unknown as JsonRecord)[f.db] : key === "timezone" ? DEFAULT_TIMEZONE : null;
    out[key] = v instanceof Date ? dbToDate(v) : (v ?? null);
  }
  return out;
}

export async function getTimezone(ownerId: string): Promise<string> {
  const row = await prisma.profile.findUnique({ where: { ownerId }, select: { timezone: true } });
  return row?.timezone ?? DEFAULT_TIMEZONE;
}

function dateWhere(field: string, range: DateRange) {
  if (!range.from && !range.to) return {};
  return {
    [field]: {
      ...(range.from ? { gte: dateToDb(range.from) } : {}),
      ...(range.to ? { lte: dateToDb(range.to) } : {}),
    },
  };
}

type DatedKind = Exclude<KindKey, "exercise_sets" | "targets">;

/** Records of one dated kind, in JSON form, oldest first. */
export async function listRecords(ownerId: string, kind: DatedKind, range: DateRange = {}): Promise<JsonRecord[]> {
  const spec = KINDS[kind];
  const delegate = (prisma as unknown as Record<string, { findMany(a: object): Promise<JsonRecord[]> }>)[spec.model];
  const rows = await delegate.findMany({
    where: { ownerId, ...dateWhere("date", range) },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => rowToJson(spec, r));
}

/** Workouts with their sets nested under `sets`, oldest first. */
export async function listWorkoutsWithSets(ownerId: string, range: DateRange = {}): Promise<JsonRecord[]> {
  const rows = await prisma.workoutSession.findMany({
    where: { ownerId, ...dateWhere("date", range) },
    // Chronological: by day, then start time (workouts without one last), then a stable tie-break.
    orderBy: [{ date: "asc" }, { startTime: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
    include: { sets: { orderBy: [{ exerciseKey: "asc" }, { setNumber: "asc" }, { id: "asc" }] } },
  });
  return rows.map((w) => {
    const { sets, ...workout } = w;
    const json = rowToJson(KINDS.workouts, workout as unknown as JsonRecord);
    json.sets = sets.map((s) => {
      const set = rowToJson(KINDS.exercise_sets, s as unknown as JsonRecord);
      delete set.workout_id;
      return set;
    });
    return json;
  });
}

/** All target versions, oldest first. */
export async function listTargets(ownerId: string): Promise<JsonRecord[]> {
  const rows = await prisma.targetSet.findMany({ where: { ownerId }, orderBy: { effectiveFrom: "asc" } });
  return rows.map((r) => rowToJson(KINDS.targets, r as unknown as JsonRecord));
}

export { targetsInEffect } from "@/lib/shared/targets";
