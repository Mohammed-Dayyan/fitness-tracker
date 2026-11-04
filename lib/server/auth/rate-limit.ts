import "server-only";
import { prisma } from "@/lib/server/db";
import { log } from "@/lib/server/log";
import { CLEANUP_BATCH, purgeExpiredSessions } from "@/lib/server/auth/session";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Failed sign-ins allowed per client IP inside the window. */
export const MAX_FAILURES_PER_IP = 20;
/**
 * Failed sign-ins allowed per email address inside the window. This caps
 * password guessing against one account; the trade-off is that someone who
 * knows the address can lock that account out for up to 15 minutes.
 */
export const MAX_FAILURES_PER_EMAIL = 5;
/** Sign-up requests allowed per client IP inside the window. */
export const MAX_REGISTRATIONS_PER_IP = 10;
/** Confirmation codes sent per address inside the window. */
export const MAX_CODES_PER_EMAIL = 3;
/** Minimum gap between two codes for one address. */
export const CODE_COOLDOWN_MS = 60 * 1000;
/** Code submissions allowed per client IP / per address inside the window. */
export const MAX_CODE_CHECKS_PER_IP = 20;
export const MAX_CODE_CHECKS_PER_EMAIL = 10;

export const emailKey = (email: string) => `email:${email.slice(0, 254)}`;

/**
 * Buckets for "send this address a confirmation code": 60 s between codes, 3
 * per 15 minutes, plus a per-client cap on requests. They are keyed on the
 * address, not on whether it has an account, so a refusal reveals nothing.
 */
export const codeSendBuckets = (ipKey: string, email: string) => [
  { key: `code-ip:${ipKey}`, max: MAX_REGISTRATIONS_PER_IP },
  { key: `code-gap:${emailKey(email)}`, max: 1, windowMs: CODE_COOLDOWN_MS },
  { key: `code-send:${emailKey(email)}`, max: MAX_CODES_PER_EMAIL },
];

/**
 * Records one attempt against each bucket *before* the work is done, then
 * counts. Because the row exists before counting, parallel requests cannot all
 * slip under the limit: the request that counts last sees every other
 * request's row, so at most `max` get through.
 *
 * An attempt over the limit is refused and its rows removed again, so hammering
 * an endpoint cannot grow the table (at most `max` rows per bucket are ever
 * stored) and cannot keep extending the lockout: it ends LOGIN_WINDOW_MS after
 * the attempts that caused it.
 *
 * Stale rows (attempts older than the window, expired tokens) are purged here
 * on every attempt, in bounded batches, so cleanup does not depend on anyone
 * successfully signing in.
 */
export async function beginAttempt(
  buckets: { key: string; max: number; windowMs?: number }[],
): Promise<{ limited: boolean; retryAfter: number; rowIds: bigint[]; limitedBy: string[] }> {
  const now = new Date();
  await purgeStaleAuthRows(now);
  const rows = await Promise.all(
    buckets.map((b) => prisma.loginAttempt.create({ data: { ipKey: b.key, success: false }, select: { id: true } })),
  );
  const sinceFor = (b: { windowMs?: number }) => new Date(now.getTime() - (b.windowMs ?? LOGIN_WINDOW_MS));
  const counts = await Promise.all(
    buckets.map((b) => prisma.loginAttempt.count({ where: { ipKey: b.key, success: false, createdAt: { gt: sinceFor(b) } } })),
  );
  const rowIds = rows.map((r) => r.id);
  const over = buckets.filter((_, i) => counts[i] > buckets[i].max);
  if (!over.length) return { limited: false, retryAfter: 0, rowIds, limitedBy: [] };

  // The lockout of a bucket ends when its oldest counted attempt leaves the
  // window (our own, newest row is removed below and never counts). The wait
  // shown is the longest over every bucket that refused this attempt.
  const waits = await Promise.all(
    over.map(async (b) => {
      const oldest = await prisma.loginAttempt.findFirst({
        where: { ipKey: b.key, success: false, createdAt: { gt: sinceFor(b) } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      return oldest ? oldest.createdAt.getTime() + (b.windowMs ?? LOGIN_WINDOW_MS) - now.getTime() : 0;
    }),
  );
  await prisma.loginAttempt.deleteMany({ where: { id: { in: rowIds } } });
  // Which limits refused it, by kind only (the keys contain the address).
  const limitedBy = over.map((b) => b.key.split(":")[0]);
  return { limited: true, retryAfter: Math.max(1, Math.ceil(Math.max(...waits) / 1000)), rowIds, limitedBy };
}

export function beginLoginAttempt(ipKey: string, email: string) {
  return beginAttempt([
    { key: ipKey, max: MAX_FAILURES_PER_IP },
    { key: emailKey(email), max: MAX_FAILURES_PER_EMAIL },
  ]);
}

/** Removes the provisional rows of an attempt that turned out fine. */
export async function clearAttempts(rowIds: bigint[]): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { id: { in: rowIds } } });
}

/**
 * A successful sign-in removes its own provisional rows and the account's
 * earlier failures. Failures from the client IP are kept, so signing in to your
 * own account does not reset the budget for guessing someone else's.
 */
export async function markLoginSuccess(rowIds: bigint[], email: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { OR: [{ id: { in: rowIds } }, { ipKey: emailKey(email), success: false }] } });
}

/** Removes up to CLEANUP_BATCH login attempts older than the window, and up to CLEANUP_BATCH expired tokens. */
export async function purgeStaleAuthRows(now = new Date()): Promise<{ attempts: number; sessions: number }> {
  const old = await prisma.loginAttempt.findMany({
    where: { createdAt: { lt: new Date(now.getTime() - LOGIN_WINDOW_MS) } },
    select: { id: true },
    take: CLEANUP_BATCH,
  });
  const attempts = old.length ? (await prisma.loginAttempt.deleteMany({ where: { id: { in: old.map((a) => a.id) } } })).count : 0;
  const sessions = await purgeExpiredSessions(now);
  if (attempts || sessions) log.info("auth.cleanup", { attempts, refreshTokens: sessions });
  return { attempts, sessions };
}
