import { NextResponse, type NextRequest } from "next/server";
import { sendConfirmationCode } from "@/lib/server/auth/confirmation";
import { beginAttempt, CODE_COOLDOWN_MS, codeSendBuckets } from "@/lib/server/auth/rate-limit";
import { OTP_TTL_MS } from "@/lib/server/auth/otp";
import { clientIpKey, inBackground, isSameOriginRequest, jsonError, readJsonBody, requireJsonContentType } from "@/lib/server/http";
import { requestLogger } from "@/lib/server/log";
import { findOwnerByEmail, normalizeEmail } from "@/lib/server/owner";

export async function POST(req: NextRequest) {
  const log = requestLogger(req);
  if (!isSameOriginRequest(req)) {
    log.warn("auth.resend.rejected", { reason: "cross_origin", origin: req.headers.get("origin") });
    return jsonError(403, "Cross-origin request rejected.");
  }
  if (!requireJsonContentType(req)) return jsonError(415, "Expected application/json.");

  const body = await readJsonBody(req, 4096);
  if (!body.ok) return jsonError(body.status, body.error);
  const rawEmail = (body.value as { email?: unknown } | null)?.email;
  if (typeof rawEmail !== "string") return jsonError(400, "Email is required.");
  const email = normalizeEmail(rawEmail);

  const gate = await beginAttempt(codeSendBuckets(clientIpKey(req), email));
  if (gate.limited) {
    log.warn("auth.resend.rate_limited", { email, retryAfter: gate.retryAfter, limitedBy: gate.limitedBy });
    return jsonError(429, "Please wait before asking for another code.", { retryAfter: gate.retryAfter });
  }

  log.info("auth.resend.accepted", { email });
  inBackground(async () => {
    const owner = await findOwnerByEmail(email);
    if (!owner) {
      log.info("auth.resend.outcome", { outcome: "unknown_email", email });
    } else if (owner.emailVerifiedAt) {
      log.info("auth.resend.outcome", { outcome: "already_confirmed", ownerId: owner.id, email });
    } else {
      log.info("auth.resend.outcome", { outcome: "sending", ownerId: owner.id, email });
      await sendConfirmationCode(log, { id: owner.id, email });
    }
  }, log);
  // Same answer for unknown, confirmed and unconfirmed addresses.
  return NextResponse.json(
    { ok: true, message: `If ${email} is waiting for confirmation, a new code is on its way.`, retryAfter: CODE_COOLDOWN_MS / 1000, expiresIn: OTP_TTL_MS / 1000 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
