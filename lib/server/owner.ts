import "server-only";
import { prisma } from "@/lib/server/db";
import { hashPassword } from "@/lib/server/auth/password";
import { revokeAllRefreshTokens } from "@/lib/server/auth/session";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function findOwnerByEmail(email: string) {
  return prisma.owner.findUnique({ where: { email: normalizeEmail(email) } });
}

/**
 * Creates an owner (already verified) or changes an existing owner's password.
 * Used by the set-password script and tests; sign-up goes through
 * /api/auth/register and email verification instead. Every refresh token of
 * the owner is revoked.
 */
export async function setOwnerPassword(email: string, password: string) {
  const normalized = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const owner = await prisma.owner.upsert({
    where: { email: normalized },
    create: { email: normalized, passwordHash, passwordChangedAt: now, emailVerifiedAt: now, profile: { create: {} } },
    update: { passwordHash, passwordChangedAt: now, emailVerifiedAt: now },
  });
  await prisma.profile.upsert({ where: { ownerId: owner.id }, create: { ownerId: owner.id }, update: {} });
  const revoked = await revokeAllRefreshTokens(owner.id);
  return { ownerId: owner.id, revokedSessions: revoked };
}
