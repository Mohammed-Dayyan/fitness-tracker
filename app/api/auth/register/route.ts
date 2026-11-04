import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sendAccountExistsNotice, sendConfirmationCode } from "@/lib/server/auth/confirmation";
import { hashPassword, validateNewPassword } from "@/lib/server/auth/password";
import { beginAttempt, CODE_COOLDOWN_MS, codeSendBuckets } from "@/lib/server/auth/rate-limit";
import { OTP_TTL_MS } from "@/lib/server/auth/otp";
import { prisma } from "@/lib/server/db";
import { clientIpKey, inBackground, isSameOriginRequest, jsonError, readJsonBody, requireJsonContentType } from "@/lib/server/http";
import { type Logger, requestLogger } from "@/lib/server/log";
import { findOwnerByEmail, normalizeEmail } from "@/lib/server/owner";

const emailSchema = z.email().max(254);

/**
 * Everything that depends on whether the address already has an account
 * happens here, after the response: the reply and its timing are the same for
 * a new address, an unconfirmed one and a confirmed one. The log records which
 * of those it was; the person never learns it.
 */
async function registerInBackground(email: string, passwordHash: string, log: Logger): Promise<void> {
  const existing = await findOwnerByEmail(email);
  if (existing?.emailVerifiedAt) {
    log.info("auth.register.outcome", { outcome: "already_confirmed", ownerId: existing.id, email });
    await sendAccountExistsNotice(log, email); // never touches the existing account
    return;
  }
  let ownerId: string;
  if (existing) {
    // Signing up again before confirming replaces the password with the one
    // just typed, so whoever pre-registered this address cannot keep theirs.
    await prisma.owner.update({ where: { id: existing.id }, data: { passwordHash, passwordChangedAt: new Date() } });
    ownerId = existing.id;
    log.info("auth.register.outcome", { outcome: "password_replaced", ownerId, email });
  } else {
    try {
      ownerId = (await prisma.owner.create({ data: { email, passwordHash, profile: { create: {} } }, select: { id: true } })).id;
      log.info("auth.register.outcome", { outcome: "created", ownerId, email });
    } catch (e) {
      // Lost a race with a parallel sign-up for the same address; that one sends the code.
      if (typeof e === "object" && e && "code" in e && e.code === "P2002") {
        log.info("auth.register.outcome", { outcome: "race_lost", email });
        return;
      }
      throw e;
    }
  }
  await sendConfirmationCode(log, { id: ownerId, email });
}

export async function POST(req: NextRequest) {
  const log = requestLogger(req);
  if (!isSameOriginRequest(req)) {
    log.warn("auth.register.rejected", { reason: "cross_origin", origin: req.headers.get("origin") });
    return jsonError(403, "Cross-origin request rejected.");
  }
  if (!requireJsonContentType(req)) return jsonError(415, "Expected application/json.");

  const body = await readJsonBody(req, 4096);
  if (!body.ok) return jsonError(body.status, body.error);
  const { email: rawEmail, password } = (body.value ?? {}) as { email?: unknown; password?: unknown };
  if (typeof rawEmail !== "string" || typeof password !== "string") return jsonError(400, "Email and password are required.");

  const email = normalizeEmail(rawEmail);
  if (!emailSchema.safeParse(email).success) {
    log.debug("auth.register.rejected", { reason: "invalid_email" });
    return jsonError(400, "Enter a valid email address.");
  }
  const problem = validateNewPassword(password);
  if (problem) {
    log.debug("auth.register.rejected", { reason: "password_rules", email });
    return jsonError(400, problem);
  }

  // Keyed on the address, not on whether it exists, so a refusal reveals nothing.
  const gate = await beginAttempt(codeSendBuckets(clientIpKey(req), email));
  if (gate.limited) {
    log.warn("auth.register.rate_limited", { email, retryAfter: gate.retryAfter, limitedBy: gate.limitedBy });
    return jsonError(429, "Please wait before asking for another code.", { retryAfter: gate.retryAfter });
  }

  // Hash even if the address is taken, so response time does not reveal it.
  const passwordHash = await hashPassword(password);
  log.info("auth.register.accepted", { email });
  inBackground(() => registerInBackground(email, passwordHash, log), log);

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
