import { afterAll, afterEach, beforeEach, vi } from "vitest";
import { logs } from "./logs";
import { mailControl, sentMail } from "./mail";
import { testDatabaseUrl } from "./test-db-url";

// Never send real email from tests: capture it instead.
vi.mock("@/lib/server/auth/mailer", () => ({
  sendMail: async () => undefined,
  smtpConfigured: () => true,
  sendOtpEmail: async (to: string, code: string) => {
    if (mailControl.delayMs) await new Promise((r) => setTimeout(r, mailControl.delayMs));
    if (mailControl.failWith) throw Object.assign(new Error(mailControl.failWith.replace("{to}", to)), { code: "EENVELOPE" });
    sentMail.push({ kind: "otp", to, code });
    return { messageId: "<test-message-id@example.test>" };
  },
  sendAccountExistsEmail: async (to: string) => {
    sentMail.push({ kind: "exists", to });
    return { messageId: "<test-exists-id@example.test>" };
  },
}));

// Must run before anything imports lib/server/db.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.TRUST_PROXY = "true";
process.env.JWT_ACCESS_SECRET = "test-secret-test-secret-test-secret-0123456789";
process.env.LOG_LEVEL = "debug";

const { prisma } = await import("@/lib/server/db");
const { detachedBackground } = await import("@/lib/server/http");
const { setLogSink } = await import("@/lib/server/log");

// Log lines are captured per test instead of printed.
setLogSink((entry) => void logs.push(entry));

/** Lets background work (emails) finish before the next test empties the tables. */
export const flushBackground = () => Promise.all([...detachedBackground]);
afterEach(async () => {
  await flushBackground();
});

beforeEach(async () => {
  sentMail.length = 0;
  logs.length = 0;
  mailControl.delayMs = 0;
  mailControl.failWith = null;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE owners, refresh_tokens, email_otps, login_attempts, profiles, target_sets, food_entries, workout_sessions,
     exercise_sets, cardio_sessions, daily_activity, body_measurements, daily_notes RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
