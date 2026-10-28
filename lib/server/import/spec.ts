import { z } from "zod";
import { isValidDateString, isValidTimeZone } from "@/lib/shared/dates";

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = "1.0";

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export const idSchema = z
  .string()
  .regex(
    ID_PATTERN,
    "must be 1-100 characters of letters, digits, '.', '_', ':' or '-', starting with a letter or digit",
  );

export const dateSchema = z
  .string()
  .refine(isValidDateString, "must be a real calendar date formatted YYYY-MM-DD");

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be a 24-hour time formatted HH:MM");
const text = (max: number) => z.string().trim().min(1, "must not be empty").max(max);
const num = (min: number, max: number) => z.number().min(min).max(max);
const int = (min: number, max: number) => z.number().int().min(min).max(max);

// ---------------------------------------------------------------------------
// Record kinds
// ---------------------------------------------------------------------------

export type FieldSpec = {
  /** Prisma field name. */
  db: string;
  schema: z.ZodType;
  /** Explicit null is accepted and clears the stored value. */
  nullable: boolean;
  /** Must be present (and non-null) when the record is created. */
  required?: boolean;
  /** Stored as a Postgres DATE. */
  isDate?: boolean;
};

export const KIND_ORDER = [
  "targets",
  "food_entries",
  "workouts",
  "exercise_sets",
  "cardio_sessions",
  "daily_activity",
  "body_measurements",
  "daily_notes",
] as const;

export type KindKey = (typeof KIND_ORDER)[number];

export type ModelName =
  | "targetSet"
  | "foodEntry"
  | "workoutSession"
  | "exerciseSet"
  | "cardioSession"
  | "dailyActivity"
  | "bodyMeasurement"
  | "dailyNote";

export type KindSpec = {
  key: KindKey;
  model: ModelName;
  label: string;
  /** The record's calendar date field, if it has one. */
  date?: { json: "date" | "effective_from"; db: "date" | "effectiveFrom" };
  /**
   * At most one record per date (enforced by a unique index). Records of these
   * kinds supplied without an ID are matched to the existing record on their
   * date instead of creating a second one.
   */
  singletonPerDate: boolean;
  fields: Record<string, FieldSpec>;
};

const nullableNum = (db: string, min: number, max: number): FieldSpec => ({ db, schema: num(min, max), nullable: true });
const nullableInt = (db: string, min: number, max: number): FieldSpec => ({ db, schema: int(min, max), nullable: true });
const nullableText = (db: string, max: number): FieldSpec => ({ db, schema: text(max), nullable: true });
const notes: FieldSpec = nullableText("notes", 2000);

export const KINDS: Record<KindKey, KindSpec> = {
  targets: {
    key: "targets",
    model: "targetSet",
    label: "target set",
    date: { json: "effective_from", db: "effectiveFrom" },
    singletonPerDate: true,
    fields: {
      calories: nullableNum("calories", 0, 20000),
      protein_g: nullableNum("proteinG", 0, 2000),
      carbs_g: nullableNum("carbsG", 0, 2000),
      fat_g: nullableNum("fatG", 0, 2000),
      fiber_g: nullableNum("fiberG", 0, 2000),
      steps: nullableInt("steps", 0, 200000),
      goal_weight_kg: nullableNum("goalWeightKg", 20, 500),
      notes,
    },
  },
  food_entries: {
    key: "food_entries",
    model: "foodEntry",
    label: "food entry",
    date: { json: "date", db: "date" },
    singletonPerDate: false,
    fields: {
      name: { db: "name", schema: text(200), nullable: false, required: true },
      meal: nullableText("meal", 100),
      time: { db: "time", schema: timeSchema, nullable: true },
      quantity: nullableNum("quantity", 0, 100000),
      unit: nullableText("unit", 30),
      weight_basis: { db: "weightBasis", schema: z.enum(["raw", "cooked"]), nullable: true },
      calories: nullableNum("calories", 0, 20000),
      protein_g: nullableNum("proteinG", 0, 2000),
      carbs_g: nullableNum("carbsG", 0, 2000),
      fat_g: nullableNum("fatG", 0, 2000),
      fiber_g: nullableNum("fiberG", 0, 2000),
      source: nullableText("source", 100),
      estimated: { db: "estimated", schema: z.boolean(), nullable: true },
      notes,
    },
  },
  workouts: {
    key: "workouts",
    model: "workoutSession",
    label: "workout",
    date: { json: "date", db: "date" },
    singletonPerDate: false,
    fields: {
      name: nullableText("name", 200),
      start_time: { db: "startTime", schema: timeSchema, nullable: true },
      duration_min: nullableNum("durationMin", 0, 1440),
      estimated_calories: nullableNum("estimatedCalories", 0, 10000),
      notes,
    },
  },
  exercise_sets: {
    key: "exercise_sets",
    model: "exerciseSet",
    label: "exercise set",
    singletonPerDate: false,
    fields: {
      workout_id: { db: "workoutId", schema: idSchema, nullable: false, required: true },
      exercise: { db: "exerciseName", schema: text(200), nullable: false, required: true },
      set_number: { db: "setNumber", schema: int(1, 1000), nullable: false, required: true },
      reps: nullableInt("reps", 0, 10000),
      weight_kg: nullableNum("weightKg", 0, 1000),
      rpe: nullableNum("rpe", 0, 10),
      duration_s: nullableInt("durationS", 0, 86400),
      notes,
    },
  },
  cardio_sessions: {
    key: "cardio_sessions",
    model: "cardioSession",
    label: "cardio session",
    date: { json: "date", db: "date" },
    singletonPerDate: false,
    fields: {
      activity: { db: "activity", schema: text(100), nullable: false, required: true },
      start_time: { db: "startTime", schema: timeSchema, nullable: true },
      duration_min: nullableNum("durationMin", 0, 1440),
      distance_km: nullableNum("distanceKm", 0, 1000),
      avg_heart_rate: nullableInt("avgHeartRate", 20, 250),
      estimated_calories: nullableNum("estimatedCalories", 0, 10000),
      notes,
    },
  },
  daily_activity: {
    key: "daily_activity",
    model: "dailyActivity",
    label: "daily activity record",
    date: { json: "date", db: "date" },
    singletonPerDate: true,
    fields: {
      steps: nullableInt("steps", 0, 200000),
      weight_kg: nullableNum("weightKg", 20, 500),
      notes,
    },
  },
  body_measurements: {
    key: "body_measurements",
    model: "bodyMeasurement",
    label: "body measurement",
    date: { json: "date", db: "date" },
    singletonPerDate: false,
    fields: {
      waist_cm: nullableNum("waistCm", 1, 300),
      chest_cm: nullableNum("chestCm", 1, 300),
      hips_cm: nullableNum("hipsCm", 1, 300),
      neck_cm: nullableNum("neckCm", 1, 300),
      arm_cm: nullableNum("armCm", 1, 300),
      thigh_cm: nullableNum("thighCm", 1, 300),
      body_fat_pct: nullableNum("bodyFatPct", 0, 100),
      notes,
    },
  },
  daily_notes: {
    key: "daily_notes",
    model: "dailyNote",
    label: "daily note",
    date: { json: "date", db: "date" },
    singletonPerDate: true,
    fields: {
      text: { db: "text", schema: text(10000), nullable: false, required: true },
    },
  },
};

export const PROFILE_FIELDS: Record<string, FieldSpec> = {
  name: nullableText("name", 100),
  sex: nullableText("sex", 30),
  birth_date: { db: "birthDate", schema: dateSchema, nullable: true, isDate: true },
  height_cm: nullableNum("heightCm", 50, 300),
  timezone: {
    db: "timezone",
    schema: z.string().refine(isValidTimeZone, "must be an IANA timezone such as Asia/Kolkata"),
    nullable: false,
  },
  activity_level: nullableText("activityLevel", 100),
  goal: nullableText("goal", 500),
  notes,
};

// ---------------------------------------------------------------------------
// Schemas built from the specs
// ---------------------------------------------------------------------------

function fieldShape(fields: Record<string, FieldSpec>, skip: string[] = []) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, f] of Object.entries(fields)) {
    if (skip.includes(key)) continue;
    shape[key] = (f.nullable ? f.schema.nullable() : f.schema).optional();
  }
  return shape;
}

/**
 * Strict per-record schema: every field optional at this stage (presence
 * rules depend on whether the record already exists), unknown keys rejected.
 */
export function recordSchema(kind: KindKey, opts: { nestedSet?: boolean } = {}) {
  const spec = KINDS[kind];
  const shape: Record<string, z.ZodType> = { id: idSchema.optional() };
  if (spec.date) shape[spec.date.json] = dateSchema.optional();
  Object.assign(shape, fieldShape(spec.fields, opts.nestedSet ? ["workout_id"] : []));
  if (kind === "workouts") shape.sets = z.array(z.unknown()).max(1000).optional();
  // Not stored: explicit permission to move an existing set to another workout.
  if (kind === "exercise_sets") shape.allow_move = z.boolean().optional();
  return z.strictObject(shape);
}

export const profileSchema = z.strictObject(fieldShape(PROFILE_FIELDS));

/** A collection may be supplied as an array or, for convenience, a single object. */
const collection = z.preprocess(
  (v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? [v] : v),
  z.array(z.unknown()),
);

const deleteShape: Record<string, z.ZodType> = {};
for (const k of KIND_ORDER) deleteShape[k] = z.array(z.unknown()).optional();

export const envelopeSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION, { error: `must be "${SCHEMA_VERSION}"` }),
  date: dateSchema.optional(),
  profile: z.unknown().optional(),
  ...Object.fromEntries(KIND_ORDER.map((k) => [k, collection.optional()])),
  delete: z.strictObject(deleteShape).optional(),
  // Informational blocks that are accepted but never stored. Totals are always
  // recomputed from entries; `export_meta` lets exports be re-imported as-is.
  summary: z.unknown().optional(),
  export_meta: z.unknown().optional(),
});

export type Envelope = {
  schema_version: string;
  date?: string;
  profile?: unknown;
  delete?: Partial<Record<KindKey, unknown[]>>;
  summary?: unknown;
  export_meta?: unknown;
} & Partial<Record<KindKey, unknown[]>>;

export const MAX_RECORDS_PER_IMPORT = 20000;
export { MAX_IMPORT_BYTES } from "@/lib/shared/limits";
