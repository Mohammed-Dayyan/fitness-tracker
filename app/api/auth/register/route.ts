import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sendAccountExistsNotice, sendConfirmationCode } from "@/lib/server/auth/confirmation";
import { hashPassword, validateNewPassword } from "@/lib/server/auth/password";
import { beginAttempt, CODE_COOLDOWN_MS, codeSendBuckets } from "@/lib/server/auth/rate-limit";
import { hasLiveOtp, OTP_TTL_MS } from "@/lib/server/auth/otp";
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
async function registerInBackground(email: string, passwordHash: string, log: Logger, codeJustSent: boolean): Promise<void> {
  const existing = await findOwnerByEmail(email);
  if (existing?.emailVerifiedAt) {
    log.info("auth.register.outcome", { outcome: "already_confirmed", ownerId: existing.id, email });
    // Never touches the existing account. Not repeated within the minute after a notice or code.
    if (!codeJustSent) await sendAccountExistsNotice(log, email);
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
  // A code went out within the last minute and is still valid: do not replace it (the
  // person is about to type it); the password above has been updated either way.
  if (codeJustSent && (await hasLiveOtp(ownerId))) {
    log.info("auth.register.code_reused", { ownerId, email });
    return;
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
  const buckets = codeSendBuckets(clientIpKey(req), email);
  const gate = await beginAttempt(buckets);
  let codeJustSent = false;
  if (gate.limited) {
    // Only the 60-second gap fired: a code for this address went out moments ago (for example
    // from a sign-in attempt). That is not an error for the person: show the code screen for it.
    // The request still counts against the per-client cap, so this cannot be used to hammer.
    if (gate.limitedBy.length === 1 && gate.limitedBy[0] === "code-gap") {
      const clientGate = await beginAttempt([buckets[0]]);
      if (!clientGate.limited) {
        codeJustSent = true;
      } else {
        log.warn("auth.register.rate_limited", { email, retryAfter: clientGate.retryAfter, limitedBy: clientGate.limitedBy });
        return jsonError(429, "Too many sign-up attempts from this device. Try again later.", { retryAfter: clientGate.retryAfter });
      }
    } else {
      log.warn("auth.register.rate_limited", { email, retryAfter: gate.retryAfter, limitedBy: gate.limitedBy });
      return jsonError(429, "You have asked for too many codes for this address. Try again later.", { retryAfter: gate.retryAfter });
    }
  }

  // Hash even if the address is taken, so response time does not reveal it.
  const passwordHash = await hashPassword(password);
  log.info("auth.register.accepted", { email, codeJustSent });
  inBackground(() => registerInBackground(email, passwordHash, log, codeJustSent), log);

  // The earlier code is at most a minute old: gate.retryAfter is what is left of that minute.
  const sinceSent = codeJustSent ? CODE_COOLDOWN_MS / 1000 - gate.retryAfter : 0;
  return NextResponse.json(
    {
      ok: true,
      message: codeJustSent
        ? "A code was sent a moment ago. Enter it below, or wait to request a new one."
        : `We sent a 6-digit code to ${email}.`,
      retryAfter: codeJustSent ? gate.retryAfter : CODE_COOLDOWN_MS / 1000,
      expiresIn: OTP_TTL_MS / 1000 - sinceSent,
      codeAlreadySent: codeJustSent,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
