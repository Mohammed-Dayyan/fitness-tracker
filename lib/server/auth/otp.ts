import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/server/db";

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
/** Wrong guesses a code survives; the next one needs a fresh code. */
export const OTP_MAX_ATTEMPTS = 5;

function secret(): string {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s || s.length < 32) throw new Error("JWT_ACCESS_SECRET must be set to a random string of at least 32 characters.");
  return s;
}

/**
 * Keyed hash: a leaked database alone cannot be used to recover a 6-digit code
 * (a plain hash of one million possibilities would fall in milliseconds).
 * Bound to the owner, so a hash cannot be moved to another account.
 */
export function hashOtp(ownerId: string, code: string): string {
  return createHmac("sha256", secret()).update(`otp:${ownerId}:${code}`).digest("hex");
}

export const isWellFormedCode = (code: unknown): code is string => typeof code === "string" && /^\d{6}$/.test(code);

/** Creates a code for the owner, replacing any earlier one. Returns the plain code to email. */
export async function issueOtp(ownerId: string): Promise<string> {
  const code = randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
  const now = Date.now();
  const data = { codeHash: hashOtp(ownerId, code), createdAt: new Date(now), expiresAt: new Date(now + OTP_TTL_MS), attempts: 0 };
  await prisma.emailOtp.upsert({ where: { ownerId }, create: { ownerId, ...data }, update: data });
  return code;
}

export type OtpResult =
  | { ok: true; ownerId: string }
  | {
      ok: false;
      /** Internal only (logs). The caller must show the same message for every reason. */
      reason: "unknown_email" | "no_code" | "already_confirmed" | "expired" | "burned" | "wrong";
      ownerId?: string;
      attemptsUsed?: number;
    };

/**
 * Checks a code for an address and, if right, marks the address confirmed.
 * Every kind of failure is reported with a reason for the logs, but the caller
 * must answer all of them identically.
 *
 * Each guess is counted *before* it is compared, atomically, so parallel
 * requests cannot get more than OTP_MAX_ATTEMPTS guesses per code.
 */
export async function checkOtp(email: string, code: string): Promise<OtpResult> {
  const owner = await prisma.owner.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true, emailOtp: true },
  });
  const otp = owner?.emailOtp;
  // Same work for an unknown address, so timing does not give it away.
  const expected = hashOtp(owner?.id ?? "none", code);
  if (!owner) return { ok: false, reason: "unknown_email" };
  if (owner.emailVerifiedAt) return { ok: false, reason: "already_confirmed", ownerId: owner.id };
  if (!otp) return { ok: false, reason: "no_code", ownerId: owner.id };

  const now = new Date();
  if (otp.expiresAt <= now) {
    await prisma.emailOtp.deleteMany({ where: { id: otp.id } });
    return { ok: false, reason: "expired", ownerId: owner.id };
  }
  const { count } = await prisma.emailOtp.updateMany({
    where: { id: otp.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (count !== 1) {
    await prisma.emailOtp.deleteMany({ where: { id: otp.id } }); // out of attempts: burned
    return { ok: false, reason: "burned", ownerId: owner.id, attemptsUsed: OTP_MAX_ATTEMPTS };
  }
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(otp.codeHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "wrong", ownerId: owner.id, attemptsUsed: otp.attempts + 1 };
  }

  const confirmed = await prisma.$transaction(async (tx) => {
    // Single use: only one of two parallel correct submissions wins.
    const { count: used } = await tx.emailOtp.deleteMany({ where: { id: otp.id } });
    if (used !== 1) return false;
    await tx.owner.update({ where: { id: owner.id }, data: { emailVerifiedAt: now } });
    return true;
  });
  return confirmed ? { ok: true, ownerId: owner.id } : { ok: false, reason: "no_code", ownerId: owner.id };
}
