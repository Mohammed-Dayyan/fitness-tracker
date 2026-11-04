/**
 * npm run set-password -- user@example.com
 *
 * Admin tool: creates an account (already email-verified) or changes an
 * existing account's password. The password is read from a hidden terminal
 * prompt (or a single line on stdin when piped), stored only as an Argon2id
 * hash, and every refresh token of the account is revoked.
 */
import "dotenv/config";
import { validateNewPassword } from "@/lib/server/auth/password";
import { prisma } from "@/lib/server/db";
import { setOwnerPassword } from "@/lib/server/owner";
import { PromptCancelled, readHidden } from "./prompt";

async function readPiped(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.split(/\r?\n/)[0] ?? "";
}

async function main() {
  const email = process.argv[2];
  if (!email || !email.includes("@")) throw new Error("Usage: npm run set-password -- <email>");
  let password: string;
  if (process.stdin.isTTY) {
    password = await readHidden("New password: ");
    const problem = validateNewPassword(password);
    if (problem) throw new Error(problem);
    const confirm = await readHidden("Confirm password: ");
    if (confirm !== password) throw new Error("Passwords do not match.");
  } else {
    password = await readPiped();
    const problem = validateNewPassword(password);
    if (problem) throw new Error(problem);
  }

  const { revokedSessions } = await setOwnerPassword(email, password);
  console.log(`Password saved (Argon2id). ${revokedSessions} existing sign-in(s) revoked.`);
}

main()
  .catch((e: unknown) => {
    if (e instanceof PromptCancelled) {
      console.error("Cancelled. The password was not changed.");
      process.exitCode = 130; // conventional exit status for Ctrl+C
      return;
    }
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
