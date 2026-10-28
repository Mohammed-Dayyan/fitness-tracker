import "server-only";
import { prisma } from "@/lib/server/db";
import { hashPassword } from "@/lib/server/auth/password";
import { invalidateAllSessions } from "@/lib/server/auth/session";

/** The single configured owner of this installation. */
export const PRIMARY_OWNER_SLUG = "primary";

export function getPrimaryOwner() {
  return prisma.owner.findUnique({ where: { slug: PRIMARY_OWNER_SLUG } });
}

/**
 * Sets (or changes) an owner's password. Creates the owner and default profile
 * on first run. Every existing session is revoked.
 */
export async function setOwnerPassword(password: string, slug = PRIMARY_OWNER_SLUG) {
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const owner = await prisma.owner.upsert({
    where: { slug },
    create: { slug, passwordHash, passwordChangedAt: now, profile: { create: {} } },
    update: { passwordHash, passwordChangedAt: now },
  });
  await prisma.profile.upsert({ where: { ownerId: owner.id }, create: { ownerId: owner.id }, update: {} });
  const revoked = await invalidateAllSessions(owner.id);
  return { ownerId: owner.id, revokedSessions: revoked };
}
