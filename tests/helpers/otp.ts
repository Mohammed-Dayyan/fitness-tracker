import { hashOtp } from "@/lib/server/auth/otp";
import { prisma } from "@/lib/server/db";

/**
 * The 6-digit code currently stored for an address. Codes are kept only as a keyed
 * hash, so this finds the one that matches (a million HMACs, about a second).
 * Waits for the background email task to have created the code.
 */
export async function readOtp(email: string, timeoutMs = 8000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const owner = await prisma.owner.findUnique({ where: { email }, include: { emailOtp: true } });
    if (owner?.emailOtp) {
      for (let i = 0; i < 1_000_000; i++) {
        const code = String(i).padStart(6, "0");
        if (hashOtp(owner.id, code) === owner.emailOtp.codeHash) return code;
      }
      throw new Error("no code matches the stored hash");
    }
    if (Date.now() > deadline) throw new Error(`no code was issued for ${email}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
