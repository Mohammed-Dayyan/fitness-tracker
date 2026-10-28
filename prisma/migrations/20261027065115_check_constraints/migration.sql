-- Database-level guards that back up the Zod validation in the importer.

ALTER TABLE "food_entries"
  ADD CONSTRAINT "food_entries_nutrition_nonneg" CHECK (
    ("calories" IS NULL OR "calories" >= 0) AND
    ("proteinG" IS NULL OR "proteinG" >= 0) AND
    ("carbsG"   IS NULL OR "carbsG"   >= 0) AND
    ("fatG"     IS NULL OR "fatG"     >= 0) AND
    ("fiberG"   IS NULL OR "fiberG"   >= 0) AND
    ("quantity" IS NULL OR "quantity" >= 0)
  ),
  ADD CONSTRAINT "food_entries_weight_basis" CHECK ("weightBasis" IS NULL OR "weightBasis" IN ('raw', 'cooked')),
  ADD CONSTRAINT "food_entries_name_nonempty" CHECK (length(btrim("name")) > 0);

ALTER TABLE "target_sets"
  ADD CONSTRAINT "target_sets_nonneg" CHECK (
    ("calories"     IS NULL OR "calories"     >= 0) AND
    ("proteinG"     IS NULL OR "proteinG"     >= 0) AND
    ("carbsG"       IS NULL OR "carbsG"       >= 0) AND
    ("fatG"         IS NULL OR "fatG"         >= 0) AND
    ("fiberG"       IS NULL OR "fiberG"       >= 0) AND
    ("steps"        IS NULL OR "steps"        >= 0) AND
    ("goalWeightKg" IS NULL OR "goalWeightKg" >  0)
  );

ALTER TABLE "workout_sessions"
  ADD CONSTRAINT "workout_sessions_nonneg" CHECK (
    ("durationMin"       IS NULL OR "durationMin"       >= 0) AND
    ("estimatedCalories" IS NULL OR "estimatedCalories" >= 0)
  );

ALTER TABLE "exercise_sets"
  ADD CONSTRAINT "exercise_sets_valid" CHECK (
    "setNumber" >= 1 AND
    ("reps"      IS NULL OR "reps"      >= 0) AND
    ("weightKg"  IS NULL OR "weightKg"  >= 0) AND
    ("rpe"       IS NULL OR ("rpe" >= 0 AND "rpe" <= 10)) AND
    ("durationS" IS NULL OR "durationS" >= 0) AND
    length(btrim("exerciseKey")) > 0
  );

ALTER TABLE "cardio_sessions"
  ADD CONSTRAINT "cardio_sessions_nonneg" CHECK (
    ("durationMin"       IS NULL OR "durationMin"       >= 0) AND
    ("distanceKm"        IS NULL OR "distanceKm"        >= 0) AND
    ("avgHeartRate"      IS NULL OR "avgHeartRate"      >  0) AND
    ("estimatedCalories" IS NULL OR "estimatedCalories" >= 0)
  );

ALTER TABLE "daily_activity"
  ADD CONSTRAINT "daily_activity_nonneg" CHECK (
    ("steps"    IS NULL OR "steps"    >= 0) AND
    ("weightKg" IS NULL OR "weightKg" >  0)
  );

ALTER TABLE "body_measurements"
  ADD CONSTRAINT "body_measurements_nonneg" CHECK (
    ("waistCm"    IS NULL OR "waistCm"    > 0) AND
    ("chestCm"    IS NULL OR "chestCm"    > 0) AND
    ("hipsCm"     IS NULL OR "hipsCm"     > 0) AND
    ("neckCm"     IS NULL OR "neckCm"     > 0) AND
    ("armCm"      IS NULL OR "armCm"      > 0) AND
    ("thighCm"    IS NULL OR "thighCm"    > 0) AND
    ("bodyFatPct" IS NULL OR ("bodyFatPct" >= 0 AND "bodyFatPct" <= 100))
  );

ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_height" CHECK ("heightCm" IS NULL OR "heightCm" > 0);
