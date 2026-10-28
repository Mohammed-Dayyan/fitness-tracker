-- CreateTable
CREATE TABLE "owners" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "passwordHash" TEXT,
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" BIGSERIAL NOT NULL,
    "ipKey" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "ownerId" UUID NOT NULL,
    "name" TEXT,
    "sex" TEXT,
    "birthDate" DATE,
    "heightCm" DOUBLE PRECISION,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "activityLevel" TEXT,
    "goal" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("ownerId")
);

-- CreateTable
CREATE TABLE "target_sets" (
    "ownerId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "calories" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "carbsG" DOUBLE PRECISION,
    "fatG" DOUBLE PRECISION,
    "fiberG" DOUBLE PRECISION,
    "steps" INTEGER,
    "goalWeightKg" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "target_sets_pkey" PRIMARY KEY ("ownerId","id")
);

-- CreateTable
CREATE TABLE "food_entries" (
    "ownerId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "meal" TEXT,
    "time" TEXT,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "weightBasis" TEXT,
    "calories" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "carbsG" DOUBLE PRECISION,
    "fatG" DOUBLE PRECISION,
    "fiberG" DOUBLE PRECISION,
    "source" TEXT,
    "estimated" BOOLEAN,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_entries_pkey" PRIMARY KEY ("ownerId","id")
);

-- CreateTable
CREATE TABLE "workout_sessions" (
    "ownerId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT,
    "startTime" TEXT,
    "durationMin" DOUBLE PRECISION,
    "estimatedCalories" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("ownerId","id")
);

-- CreateTable
CREATE TABLE "exercise_sets" (
    "ownerId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "exerciseName" TEXT NOT NULL,
    "exerciseKey" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "reps" INTEGER,
    "weightKg" DOUBLE PRECISION,
    "rpe" DOUBLE PRECISION,
    "durationS" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercise_sets_pkey" PRIMARY KEY ("ownerId","id")
);

-- CreateTable
CREATE TABLE "cardio_sessions" (
    "ownerId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "activity" TEXT NOT NULL,
    "startTime" TEXT,
    "durationMin" DOUBLE PRECISION,
    "distanceKm" DOUBLE PRECISION,
    "avgHeartRate" INTEGER,
    "estimatedCalories" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cardio_sessions_pkey" PRIMARY KEY ("ownerId","id")
);

-- CreateTable
CREATE TABLE "daily_activity" (
    "ownerId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "steps" INTEGER,
    "weightKg" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_activity_pkey" PRIMARY KEY ("ownerId","id")
);

-- CreateTable
CREATE TABLE "body_measurements" (
    "ownerId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "waistCm" DOUBLE PRECISION,
    "chestCm" DOUBLE PRECISION,
    "hipsCm" DOUBLE PRECISION,
    "neckCm" DOUBLE PRECISION,
    "armCm" DOUBLE PRECISION,
    "thighCm" DOUBLE PRECISION,
    "bodyFatPct" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "body_measurements_pkey" PRIMARY KEY ("ownerId","id")
);

-- CreateTable
CREATE TABLE "daily_notes" (
    "ownerId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_notes_pkey" PRIMARY KEY ("ownerId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "owners_slug_key" ON "owners"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_ownerId_idx" ON "sessions"("ownerId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "login_attempts_ipKey_createdAt_idx" ON "login_attempts"("ipKey", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_createdAt_idx" ON "login_attempts"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "target_sets_ownerId_effectiveFrom_key" ON "target_sets"("ownerId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "food_entries_ownerId_date_idx" ON "food_entries"("ownerId", "date");

-- CreateIndex
CREATE INDEX "workout_sessions_ownerId_date_idx" ON "workout_sessions"("ownerId", "date");

-- CreateIndex
CREATE INDEX "exercise_sets_ownerId_workoutId_idx" ON "exercise_sets"("ownerId", "workoutId");

-- CreateIndex
CREATE INDEX "exercise_sets_ownerId_exerciseKey_idx" ON "exercise_sets"("ownerId", "exerciseKey");

-- CreateIndex
CREATE INDEX "cardio_sessions_ownerId_date_idx" ON "cardio_sessions"("ownerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_activity_ownerId_date_key" ON "daily_activity"("ownerId", "date");

-- CreateIndex
CREATE INDEX "body_measurements_ownerId_date_idx" ON "body_measurements"("ownerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_notes_ownerId_date_key" ON "daily_notes"("ownerId", "date");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_sets" ADD CONSTRAINT "target_sets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_entries" ADD CONSTRAINT "food_entries_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_ownerId_workoutId_fkey" FOREIGN KEY ("ownerId", "workoutId") REFERENCES "workout_sessions"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardio_sessions" ADD CONSTRAINT "cardio_sessions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_activity" ADD CONSTRAINT "daily_activity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_notes" ADD CONSTRAINT "daily_notes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
