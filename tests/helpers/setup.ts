import { afterAll, beforeEach } from "vitest";
import { testDatabaseUrl } from "./test-db-url";

// Must run before anything imports lib/server/db.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.TRUST_PROXY = "true";

const { prisma } = await import("@/lib/server/db");

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE owners, sessions, login_attempts, profiles, target_sets, food_entries, workout_sessions,
     exercise_sets, cardio_sessions, daily_activity, body_measurements, daily_notes RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
