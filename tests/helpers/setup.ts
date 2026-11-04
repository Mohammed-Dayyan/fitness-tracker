import { afterAll, afterEach, beforeEach, vi } from "vitest";
import { mailControl, sentMail } from "./mail";
import { testDatabaseUrl } from "./test-db-url";

// Never send real email from tests: capture it instead.
vi.mock("@/lib/server/auth/mailer", () => ({
  sendMail: async () => undefined,
  sendOtpEmail: async (to: string, code: string) => {
    if (mailControl.delayMs) await new Promise((r) => setTimeout(r, mailControl.delayMs));
    sentMail.push({ kind: "otp", to, code });
  },
  sendAccountExistsEmail: async (to: string) => {
    sentMail.push({ kind: "exists", to });
  },
}));

// Must run before anything imports lib/server/db.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.TRUST_PROXY = "true";
process.env.JWT_ACCESS_SECRET = "test-secret-test-secret-test-secret-0123456789";

const { prisma } = await import("@/lib/server/db");
const { detachedBackground } = await import("@/lib/server/http");

/** Lets background work (emails) finish before the next test empties the tables. */
export const flushBackground = () => Promise.all([...detachedBackground]);
afterEach(async () => {
  await flushBackground();
});

beforeEach(async () => {
  sentMail.length = 0;
  mailControl.delayMs = 0;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE owners, refresh_tokens, email_otps, login_attempts, profiles, target_sets, food_entries, workout_sessions,
     exercise_sets, cardio_sessions, daily_activity, body_measurements, daily_notes RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
