import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { accessCookieName, cookieOptions, expiredCookieOptions, refreshCookieName } from "@/lib/server/auth/cookies";
import { signAccessToken } from "@/lib/server/auth/jwt";

const DAY_MS = 86_400_000;
/**
 * A refresh token that was exchanged this recently may be presented again by a
 * parallel request from the same browser (two tabs, a page load plus a
 * keep-alive ping). That is not theft: it gets a fresh access token only.
 * Presenting it later than this deletes the whole token family.
 */
export const ROTATION_GRACE_MS = 10_000;

export function refreshTtlMs(): number {
  const days = Number(process.env.SESSION_TTL_DAYS ?? 30);
  return (Number.isFinite(days) && days > 0 ? days : 30) * DAY_MS;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type IssuedTokens = {
  accessToken: string;
  accessExpiresAt: Date;
  /** Absent when the caller must keep using the refresh cookie it already holds (rotation grace). */
  refreshToken?: string;
  refreshExpiresAt?: Date;
};

async function mintRefreshToken(
  db: Pick<typeof prisma, "refreshToken">,
  ownerId: string,
  familyId: string,
  userAgent?: string | null,
) {
  // 256 bits from the CSPRNG; only its hash is persisted.
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = new Date(now + refreshTtlMs());
  await db.refreshToken.create({
    data: {
      ownerId,
      familyId,
      createdAt: new Date(now),
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 300) ?? null,
    },
  });
  return { token, expiresAt };
}

/** Starts a new sign-in: a fresh token family with one refresh token and an access token. */
export async function issueSession(ownerId: string, userAgent?: string | null): Promise<IssuedTokens> {
  const refresh = await mintRefreshToken(prisma, ownerId, randomUUID(), userAgent);
  const access = await signAccessToken(ownerId);
  return {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}

/**
 * Exchanges a refresh token for a new access token and a new refresh token
 * (rotation). Returns null when the token is unknown, expired, belongs to an
 * unverified owner, or was reused outside the grace window (which also deletes
 * the whole family: someone else may hold a copy).
 */
export async function rotateRefreshToken(
  token: string | undefined | null,
  userAgent?: string | null,
): Promise<(IssuedTokens & { ownerId: string }) | null> {
  if (!token || token.length > 200) return null;
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { owner: { select: { emailVerifiedAt: true } } },
  });
  if (!row) return null;

  const now = Date.now();
  if (row.expiresAt.getTime() <= now) {
    await prisma.refreshToken.deleteMany({ where: { id: row.id } });
    return null;
  }
  if (!row.owner.emailVerifiedAt) return null;

  const accessOnly = async () => {
    const access = await signAccessToken(row.ownerId);
    return { ownerId: row.ownerId, accessToken: access.token, accessExpiresAt: access.expiresAt };
  };

  if (row.rotatedAt) {
    if (now - row.rotatedAt.getTime() <= ROTATION_GRACE_MS) return accessOnly();
    await prisma.refreshToken.deleteMany({ where: { familyId: row.familyId } });
    return null;
  }

  // Compare-and-set: of two parallel requests only one wins the rotation.
  const next = await prisma.$transaction(async (tx) => {
    const { count } = await tx.refreshToken.updateMany({
      where: { id: row.id, rotatedAt: null },
      data: { rotatedAt: new Date(now) },
    });
    return count === 1 ? mintRefreshToken(tx, row.ownerId, row.familyId, userAgent ?? row.userAgent) : null;
  });
  if (!next) return accessOnly();

  const access = await signAccessToken(row.ownerId);
  return {
    ownerId: row.ownerId,
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    refreshToken: next.token,
    refreshExpiresAt: next.expiresAt,
  };
}

export function setAuthCookies(res: NextResponse, tokens: IssuedTokens): void {
  res.cookies.set(accessCookieName(), tokens.accessToken, cookieOptions(tokens.accessExpiresAt));
  if (tokens.refreshToken && tokens.refreshExpiresAt) {
    res.cookies.set(refreshCookieName(), tokens.refreshToken, cookieOptions(tokens.refreshExpiresAt));
  }
}

export function clearAuthCookies(res: NextResponse): void {
  res.cookies.set(accessCookieName(), "", expiredCookieOptions());
  res.cookies.set(refreshCookieName(), "", expiredCookieOptions());
}

/** Sign out: deletes the whole token family the refresh token belongs to. */
export async function revokeRefreshToken(token: string | undefined | null): Promise<void> {
  if (!token) return;
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) }, select: { familyId: true } });
  if (row) await prisma.refreshToken.deleteMany({ where: { familyId: row.familyId } });
}

/** Sign out everywhere. Access tokens already issued expire within 15 minutes. */
export async function revokeAllRefreshTokens(ownerId: string): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({ where: { ownerId } });
  return count;
}

/** Rows removed per cleanup call: keeps any single request cheap, however big the backlog. */
export const CLEANUP_BATCH = 500;

/** Accounts that never entered their confirmation code are removed after this long. */
export const UNCONFIRMED_ACCOUNT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes up to CLEANUP_BATCH expired refresh tokens and returns how many. Also
 * removes expired confirmation codes and, in a bounded batch, accounts that
 * stayed unconfirmed for UNCONFIRMED_ACCOUNT_TTL_MS (their profile and codes go
 * with them), so open sign-up cannot pile up abandoned rows.
 */
export async function purgeExpiredSessions(now = new Date()): Promise<number> {
  const expired = await prisma.refreshToken.findMany({ where: { expiresAt: { lte: now } }, select: { id: true }, take: CLEANUP_BATCH });
  const removed = expired.length
    ? (await prisma.refreshToken.deleteMany({ where: { id: { in: expired.map((s) => s.id) } } })).count
    : 0;
  const staleCodes = await prisma.emailOtp.findMany({ where: { expiresAt: { lte: now } }, select: { id: true }, take: CLEANUP_BATCH });
  if (staleCodes.length) await prisma.emailOtp.deleteMany({ where: { id: { in: staleCodes.map((c) => c.id) } } });
  const abandoned = await prisma.owner.findMany({
    where: { emailVerifiedAt: null, createdAt: { lt: new Date(now.getTime() - UNCONFIRMED_ACCOUNT_TTL_MS) } },
    select: { id: true },
    take: CLEANUP_BATCH,
  });
  if (abandoned.length) await prisma.owner.deleteMany({ where: { id: { in: abandoned.map((o) => o.id) } } });
  return removed;
}
