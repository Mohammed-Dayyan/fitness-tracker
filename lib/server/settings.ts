import "server-only";
import type { z } from "zod";
import { prisma } from "@/lib/server/db";
import { applyImportDirect } from "@/lib/server/import";
import { KINDS, PROFILE_FIELDS, SCHEMA_VERSION, dateSchema, type FieldSpec } from "@/lib/server/import/spec";
import { getProfileJson, listTargets } from "@/lib/server/repo";
import { dateToDb, dbToDate } from "@/lib/shared/dates";

export const PROFILE_FORM_FIELDS = ["name", "sex", "birth_date", "height_cm", "activity_level", "goal", "timezone"] as const;
export const TARGET_FORM_FIELDS = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "steps", "goal_weight_kg"] as const;

export type FieldErrors = Record<string, string>;
export type SettingsResult = { ok: true; message: string } | { ok: false; error: string; fieldErrors: FieldErrors };

function friendly(issue: z.core.$ZodIssue): string {
  const i = issue as unknown as { code: string; minimum?: number | bigint; maximum?: number | bigint; message: string };
  if (i.code === "too_small") return typeof i.minimum === "number" ? `Must be at least ${i.minimum}` : "Too short";
  if (i.code === "too_big") return typeof i.maximum === "number" ? `Must be at most ${i.maximum}` : "Too long";
  if (i.code === "invalid_type") return "Enter a number";
  return i.message.charAt(0).toUpperCase() + i.message.slice(1);
}

/** Parses one raw form value with the importer's own field schema. */
function parseField(spec: FieldSpec, raw: unknown): { value: unknown } | { error: string } {
  const isNumber = (spec.schema as unknown as { _zod: { def: { type: string } } })._zod.def.type === "number";
  let value: unknown = typeof raw === "string" ? raw.trim() : raw;
  if (isNumber && typeof value === "string") {
    value = Number(value);
    if (!Number.isFinite(value)) return { error: "Enter a number" };
  }
  const r = spec.schema.safeParse(value);
  return r.success ? { value: r.data } : { error: friendly(r.error.issues[0]) };
}

const blank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

/**
 * Profile form. Blank fields are cleared (explicit null), except timezone,
 * which is required. Weight is deliberately NOT part of the profile: a weight
 * is a dated measurement (see saveWeighIn), so saving the profile never
 * creates, repeats or changes a weigh-in.
 */
export async function saveProfile(ownerId: string, body: Record<string, unknown>, today: string): Promise<SettingsResult> {
  const fieldErrors: FieldErrors = {};
  const profile: Record<string, unknown> = {};
  for (const key of PROFILE_FORM_FIELDS) {
    const raw = body[key];
    if (blank(raw)) {
      if (key === "timezone") fieldErrors[key] = "Choose a timezone";
      else profile[key] = null;
      continue;
    }
    const r = parseField(PROFILE_FIELDS[key], raw);
    if ("error" in r) fieldErrors[key] = r.error;
    else profile[key] = r.value;
  }
  // `today` is the owner's calendar day, so the check is right on both sides of midnight.
  if (typeof profile.birth_date === "string" && profile.birth_date > today) {
    fieldErrors.birth_date = "Birth date can't be in the future";
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };

  const res = await applyImportDirect(ownerId, { schema_version: SCHEMA_VERSION, profile });
  if (!res.ok) return { ok: false, error: `${res.error} ${res.errors.join(" ")}`.trim(), fieldErrors: {} };
  return { ok: true, message: "Profile saved." };
}

/**
 * Records one body-weight measurement for an explicit date. Only the weight
 * for that date changes (steps and notes on the day are kept). A weigh-in that
 * already exists for the date is replaced, and the message says so.
 */
export async function saveWeighIn(ownerId: string, body: Record<string, unknown>, today: string): Promise<SettingsResult> {
  const fieldErrors: FieldErrors = {};
  const date = dateSchema.safeParse(body.date);
  if (!date.success) fieldErrors.date = "Enter a valid date";
  else if (date.data > today) fieldErrors.date = "Date can't be in the future";
  let kg: number | undefined;
  if (blank(body.weight_kg)) fieldErrors.weight_kg = "Enter a weight";
  else {
    const r = parseField(KINDS.daily_activity.fields.weight_kg, body.weight_kg);
    if ("error" in r) fieldErrors.weight_kg = r.error;
    else kg = r.value as number;
  }
  if (Object.keys(fieldErrors).length || !date.success || kg === undefined) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }

  const previous = await prisma.dailyActivity.findFirst({ where: { ownerId, date: dateToDb(date.data) }, select: { weightKg: true } });
  const res = await applyImportDirect(ownerId, { schema_version: SCHEMA_VERSION, daily_activity: [{ date: date.data, weight_kg: kg }] });
  if (!res.ok) return { ok: false, error: `${res.error} ${res.errors.join(" ")}`.trim(), fieldErrors: {} };
  const replaced = previous?.weightKg != null && previous.weightKg !== kg ? ` It replaced ${previous.weightKg} kg.` : "";
  return { ok: true, message: `Weight ${kg} kg recorded for ${date.data}.${replaced}` };
}

/**
 * Records the step count for an explicit date (the Today quick log). Only steps
 * change: weight and notes on the day are kept. Whole numbers 0–200000; an
 * existing count for the date is replaced and the message says so.
 */
export async function saveSteps(ownerId: string, body: Record<string, unknown>, today: string): Promise<SettingsResult> {
  const fieldErrors: FieldErrors = {};
  const date = dateSchema.safeParse(body.date);
  if (!date.success) fieldErrors.date = "Enter a valid date";
  else if (date.data > today) fieldErrors.date = "Date can't be in the future";
  let steps: number | undefined;
  if (blank(body.steps)) fieldErrors.steps = "Enter your steps";
  else if (typeof body.steps === "string" && !/^\d+$/.test(body.steps.trim().replace(/[,\s]/g, ""))) fieldErrors.steps = "Enter a whole number";
  else {
    const raw = typeof body.steps === "string" ? body.steps.replace(/[,\s]/g, "") : body.steps;
    const r = parseField(KINDS.daily_activity.fields.steps, raw);
    if ("error" in r) fieldErrors.steps = r.error;
    else if (!Number.isInteger(r.value)) fieldErrors.steps = "Enter a whole number";
    else steps = r.value as number;
  }
  if (Object.keys(fieldErrors).length || !date.success || steps === undefined) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }

  const previous = await prisma.dailyActivity.findFirst({ where: { ownerId, date: dateToDb(date.data) }, select: { steps: true } });
  const res = await applyImportDirect(ownerId, { schema_version: SCHEMA_VERSION, daily_activity: [{ date: date.data, steps }] });
  if (!res.ok) return { ok: false, error: `${res.error} ${res.errors.join(" ")}`.trim(), fieldErrors: {} };
  const replaced = previous?.steps != null && previous.steps !== steps ? ` It replaced ${previous.steps}.` : "";
  return { ok: true, message: `${steps.toLocaleString("en-US")} steps recorded for ${date.data}.${replaced}` };
}

/**
 * The Today "Log today" card: steps, weight or both for one explicit date, in a
 * single write. A blank field is ignored (it never clears what is stored), so
 * saving steps leaves the weight alone and the reverse. Weight and steps not
 * named, and the day's notes, are kept. Existing values for the date are
 * replaced and the message says so.
 */
export async function saveDaily(ownerId: string, body: Record<string, unknown>, today: string): Promise<SettingsResult> {
  const fieldErrors: FieldErrors = {};
  const date = dateSchema.safeParse(body.date);
  if (!date.success) fieldErrors.date = "Enter a valid date";
  else if (date.data > today) fieldErrors.date = "Date can't be in the future";

  let steps: number | undefined;
  if (!blank(body.steps)) {
    const text = typeof body.steps === "string" ? body.steps.replace(/[,\s]/g, "") : body.steps;
    if (typeof text === "string" && !/^\d+$/.test(text)) fieldErrors.steps = "Enter a whole number";
    else {
      const r = parseField(KINDS.daily_activity.fields.steps, text);
      if ("error" in r) fieldErrors.steps = r.error;
      else if (!Number.isInteger(r.value)) fieldErrors.steps = "Enter a whole number";
      else steps = r.value as number;
    }
  }
  let kg: number | undefined;
  if (!blank(body.weight_kg)) {
    const r = parseField(KINDS.daily_activity.fields.weight_kg, body.weight_kg);
    if ("error" in r) fieldErrors.weight_kg = r.error;
    else kg = r.value as number;
  }
  if (blank(body.steps) && blank(body.weight_kg) && !fieldErrors.date) fieldErrors.steps = "Enter steps, weight or both";
  if (Object.keys(fieldErrors).length || !date.success) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }

  const previous = await prisma.dailyActivity.findFirst({ where: { ownerId, date: dateToDb(date.data) }, select: { steps: true, weightKg: true } });
  const record: Record<string, unknown> = { date: date.data };
  if (steps !== undefined) record.steps = steps;
  if (kg !== undefined) record.weight_kg = kg;
  const res = await applyImportDirect(ownerId, { schema_version: SCHEMA_VERSION, daily_activity: [record] });
  if (!res.ok) return { ok: false, error: `${res.error} ${res.errors.join(" ")}`.trim(), fieldErrors: {} };

  const saved = [steps !== undefined ? `${steps.toLocaleString("en-US")} steps` : null, kg !== undefined ? `${kg} kg` : null].filter(Boolean).join(" and ");
  const replaced = [
    steps !== undefined && previous?.steps != null && previous.steps !== steps ? `${previous.steps.toLocaleString("en-US")} steps` : null,
    kg !== undefined && previous?.weightKg != null && previous.weightKg !== kg ? `${previous.weightKg} kg` : null,
  ].filter(Boolean);
  return { ok: true, message: `${saved} recorded for ${date.data}.${replaced.length ? ` It replaced ${replaced.join(" and ")}.` : ""}` };
}

/**
 * Targets form: creates (or, for the same date, updates) the target version
 * effective from the chosen date. Blank fields are omitted, so a new version
 * copies them from the version in effect before it, exactly like an import.
 * Earlier versions are never modified.
 */
export async function saveTargets(ownerId: string, body: Record<string, unknown>): Promise<SettingsResult> {
  const fieldErrors: FieldErrors = {};
  const from = dateSchema.safeParse(body.effective_from);
  if (!from.success) fieldErrors.effective_from = "Enter a valid date";
  const record: Record<string, unknown> = {};
  for (const key of TARGET_FORM_FIELDS) {
    if (blank(body[key])) continue;
    const r = parseField(KINDS.targets.fields[key], body[key]);
    if ("error" in r) fieldErrors[key] = r.error;
    else record[key] = r.value;
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  if (Object.keys(record).length === 0) {
    return { ok: false, error: "Enter at least one target.", fieldErrors: {} };
  }
  record.effective_from = from.data;
  const res = await applyImportDirect(ownerId, { schema_version: SCHEMA_VERSION, targets: [record] });
  if (!res.ok) return { ok: false, error: `${res.error} ${res.errors.join(" ")}`.trim(), fieldErrors: {} };
  const outcome = res.records[0];
  const verb = outcome?.action === "create" ? "New target version saved" : outcome?.action === "update" ? "Target version updated" : "No changes";
  // e.g. "protein_g, steps carried forward from the target set effective 2026-10-01"
  const carried = /(?:^|: )([a-z_, ]+) carried forward from the target set effective (\S+)$/.exec(outcome?.warnings?.find((w) => w.includes("carried forward")) ?? "");
  const copied = carried
    ? ` ${carried[1].split(", ").map((k) => TARGET_LABELS[k] ?? k).join(", ").replace(/^./, (c) => c.toUpperCase())} copied from the version effective ${carried[2]}.`
    : "";
  return { ok: true, message: `${verb}, effective from ${from.data}.${copied}` };
}

const TARGET_LABELS: Record<string, string> = {
  calories: "calories",
  protein_g: "protein",
  carbs_g: "carbs",
  fat_g: "fat",
  fiber_g: "fiber",
  steps: "steps",
  goal_weight_kg: "goal weight",
};

export async function getSettingsData(ownerId: string) {
  const [profile, targets, lastWeigh] = await Promise.all([
    getProfileJson(ownerId),
    listTargets(ownerId),
    prisma.dailyActivity.findFirst({
      where: { ownerId, weightKg: { not: null } },
      orderBy: { date: "desc" },
      select: { date: true, weightKg: true },
    }),
  ]);
  return {
    profile,
    targets,
    latestWeight: lastWeigh ? { date: dbToDate(lastWeigh.date), kg: lastWeigh.weightKg! } : null,
  };
}
