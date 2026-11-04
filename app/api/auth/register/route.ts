import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hashPassword, validateNewPassword } from "@/lib/server/auth/password";
import { beginAttempt, CODE_COOLDOWN_MS, codeSendBuckets } from "@/lib/server/auth/rate-limit";
import { sendAccountExistsEmail, sendOtpEmail } from "@/lib/server/auth/mailer";
import { issueOtp, OTP_TTL_MS } from "@/lib/server/auth/otp";
import { prisma } from "@/lib/server/db";
import { clientIpKey, inBackground, isSameOriginRequest, jsonError, readJsonBody, requireJsonContentType } from "@/lib/server/http";
import { findOwnerByEmail, normalizeEmail } from "@/lib/server/owner";

const emailSchema = z.email().max(254);

/**
 * Everything that depends on whether the address already has an account
 * happens here, after the response: the reply and its timing are the same for
 * a new address, an unconfirmed one and a confirmed one.
 */
async function registerInBackground(email: string, passwordHash: string): Promise<void> {
  const existing = await findOwnerByEmail(email);
  if (existing?.emailVerifiedAt) {
    await sendAccountExistsEmail(email); // never touches the existing account
    return;
  }
  let ownerId: string;
  if (existing) {
    // Signing up again before confirming replaces the password with the one
    // just typed, so whoever pre-registered this address cannot keep theirs.
    await prisma.owner.update({ where: { id: existing.id }, data: { passwordHash, passwordChangedAt: new Date() } });
    ownerId = existing.id;
  } else {
    try {
      ownerId = (await prisma.owner.create({ data: { email, passwordHash, profile: { create: {} } }, select: { id: true } })).id;
    } catch (e) {
      // Lost a race with a parallel sign-up for the same address; that one sends the code.
      if (typeof e === "object" && e && "code" in e && e.code === "P2002") return;
      throw e;
    }
  }
  await sendOtpEmail(email, await issueOtp(ownerId));
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) return jsonError(403, "Cross-origin request rejected.");
  if (!requireJsonContentType(req)) return jsonError(415, "Expected application/json.");

  const body = await readJsonBody(req, 4096);
  if (!body.ok) return jsonError(body.status, body.error);
  const { email: rawEmail, password } = (body.value ?? {}) as { email?: unknown; password?: unknown };
  if (typeof rawEmail !== "string" || typeof password !== "string") return jsonError(400, "Email and password are required.");

  const email = normalizeEmail(rawEmail);
  if (!emailSchema.safeParse(email).success) return jsonError(400, "Enter a valid email address.");
  const problem = validateNewPassword(password);
  if (problem) return jsonError(400, problem);

  // Keyed on the address, not on whether it exists, so a refusal reveals nothing.
  const gate = await beginAttempt(codeSendBuckets(clientIpKey(req), email));
  if (gate.limited) return jsonError(429, "Please wait before asking for another code.", { retryAfter: gate.retryAfter });

  // Hash even if the address is taken, so response time does not reveal it.
  const passwordHash = await hashPassword(password);
  inBackground(() => registerInBackground(email, passwordHash));

  return NextResponse.json(
    {
      ok: true,
      message: `We sent a 6-digit code to ${email}.`,
      retryAfter: CODE_COOLDOWN_MS / 1000,
      expiresIn: OTP_TTL_MS / 1000,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
