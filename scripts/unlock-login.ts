/**
 * npm run unlock-login
 *
 * Lockout recovery: clears recorded failed login attempts so the owner can
 * sign in immediately instead of waiting out the 15-minute window. Requires
 * database access (i.e. the same trust level as set-password); it does not
 * change the password or touch sessions.
 */
import "dotenv/config";
import { prisma } from "@/lib/server/db";

async function main() {
  const { count } = await prisma.loginAttempt.deleteMany({ where: { success: false } });
  console.log(`Cleared ${count} failed login attempt(s). Login is unlocked.`);
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
