import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/server/db";

const DAY_MS = 86_400_000;
// Sliding renewal is written at most this often to avoid a write per request.
const RENEW_INTERVAL_MS = 60 * 60 * 1000;

export function sessionTtlMs(): number {
  const days = Number(process.env.SESSION_TTL_DAYS ?? 30);
  return (Number.isFinite(days) && days > 0 ? days : 30) * DAY_MS;
}

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * In production the cookie uses the __Host- prefix, which browsers only
 * accept with Secure, Path=/ and no Domain: it cannot be set by subdomains.
 */
export function sessionCookieName(): string {
  return isProduction() ? "__Host-ft_session" : "ft_session";
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type ValidSession = {
  sessionId: string;
  ownerId: string;
  expiresAt: Date;
  renewed: boolean;
};

export async function createSession(ownerId: string, userAgent?: string | null) {
  // 256 bits from the CSPRNG; only its hash is persisted.
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionTtlMs());
  await prisma.session.create({
    data: {
      ownerId,
      // App clock, matching passwordChangedAt, so the comparison is skew-free.
      createdAt: now,
      lastSeenAt: now,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 300) ?? null,
    },
  });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string | undefined | null): Promise<ValidSession | null> {
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { owner: { select: { passwordChangedAt: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  const stalePassword =
    session.owner.passwordChangedAt != null && session.createdAt < session.owner.passwordChangedAt;
  if (session.expiresAt.getTime() <= now || stalePassword) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (now - session.lastSeenAt.getTime() > RENEW_INTERVAL_MS) {
    const expiresAt = new Date(now + sessionTtlMs());
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(now), expiresAt },
    });
    return { sessionId: session.id, ownerId: session.ownerId, expiresAt, renewed: true };
  }
  return { sessionId: session.id, ownerId: session.ownerId, expiresAt: session.expiresAt, renewed: false };
}

export async function invalidateSessionToken(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function invalidateAllSessions(ownerId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { ownerId } });
  return count;
}

/** Rows removed per cleanup call: keeps any single request cheap, however big the backlog. */
export const CLEANUP_BATCH = 500;

/** Deletes up to CLEANUP_BATCH expired sessions. Returns how many were removed. */
export async function purgeExpiredSessions(now = new Date()): Promise<number> {
  const expired = await prisma.session.findMany({ where: { expiresAt: { lte: now } }, select: { id: true }, take: CLEANUP_BATCH });
  if (!expired.length) return 0;
  const { count } = await prisma.session.deleteMany({ where: { id: { in: expired.map((s) => s.id) } } });
  return count;
}
