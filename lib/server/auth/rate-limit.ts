import "server-only";
import { prisma } from "@/lib/server/db";
import { CLEANUP_BATCH, purgeExpiredSessions } from "@/lib/server/auth/session";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Failed attempts allowed per client IP inside the window. */
export const MAX_FAILURES_PER_IP = 5;
/**
 * Failed attempts allowed across all clients inside the window. There is only
 * one account, so this caps distributed guessing. The trade-off is that an
 * attacker can lock the owner out for up to 15 minutes; see the README.
 */
export const MAX_FAILURES_GLOBAL = 50;

/**
 * Records the attempt as a failure *before* the password is checked, then
 * counts. Because the row exists before counting, parallel requests cannot
 * all slip under the limit: the allowed request that counts last sees every
 * other allowed request's row, so at most MAX_FAILURES_PER_IP get through.
 *
 * An attempt that is over the limit is refused and its row removed again, so
 * hammering the endpoint cannot grow the table (at most the limit per client
 * and MAX_FAILURES_GLOBAL overall are ever stored) and cannot keep extending
 * the lockout: it ends LOGIN_WINDOW_MS after the failures that caused it.
 *
 * Stale rows (login attempts older than the window, expired sessions) are
 * purged here on every attempt, in bounded batches, so cleanup does not depend
 * on anyone successfully signing in.
 */
export async function beginLoginAttempt(ipKey: string): Promise<{ limited: boolean }> {
  const now = new Date();
  await purgeStaleAuthRows(now);
  const row = await prisma.loginAttempt.create({ data: { ipKey, success: false }, select: { id: true } });
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const [ipFailures, globalFailures] = await Promise.all([
    prisma.loginAttempt.count({ where: { ipKey, success: false, createdAt: { gt: since } } }),
    prisma.loginAttempt.count({ where: { success: false, createdAt: { gt: since } } }),
  ]);
  const limited = ipFailures > MAX_FAILURES_PER_IP || globalFailures > MAX_FAILURES_GLOBAL;
  if (limited) await prisma.loginAttempt.deleteMany({ where: { id: row.id } });
  return { limited };
}

/** A successful login clears this client's failures, including the provisional one. */
export async function markLoginSuccess(ipKey: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { ipKey, success: false } });
  await prisma.loginAttempt.create({ data: { ipKey, success: true } });
}

/** Removes up to CLEANUP_BATCH login attempts older than the window, and up to CLEANUP_BATCH expired sessions. */
export async function purgeStaleAuthRows(now = new Date()): Promise<{ attempts: number; sessions: number }> {
  const old = await prisma.loginAttempt.findMany({
    where: { createdAt: { lt: new Date(now.getTime() - LOGIN_WINDOW_MS) } },
    select: { id: true },
    take: CLEANUP_BATCH,
  });
  const attempts = old.length ? (await prisma.loginAttempt.deleteMany({ where: { id: { in: old.map((a) => a.id) } } })).count : 0;
  return { attempts, sessions: await purgeExpiredSessions(now) };
}
