import { NextResponse, type NextRequest } from "next/server";
import { sendConfirmationCode } from "@/lib/server/auth/confirmation";
import { verifyPassword } from "@/lib/server/auth/password";
import { beginAttempt, beginLoginAttempt, CODE_COOLDOWN_MS, codeSendBuckets, markLoginSuccess } from "@/lib/server/auth/rate-limit";
import { issueSession, setAuthCookies } from "@/lib/server/auth/session";
import { clientIpKey, inBackground, isSameOriginRequest, jsonError, readJsonBody, requireJsonContentType } from "@/lib/server/http";
import { requestLogger } from "@/lib/server/log";
import { findOwnerByEmail, normalizeEmail } from "@/lib/server/owner";

const GENERIC_FAILURE = "Invalid email or password.";

export async function POST(req: NextRequest) {
  const log = requestLogger(req);
  // Login CSRF: refuse cross-origin submissions.
  if (!isSameOriginRequest(req)) {
    log.warn("auth.login.rejected", { reason: "cross_origin", origin: req.headers.get("origin") });
    return jsonError(403, "Cross-origin request rejected.");
  }
  if (!requireJsonContentType(req)) return jsonError(415, "Expected application/json.");

  const body = await readJsonBody(req, 4096);
  if (!body.ok) return jsonError(body.status, body.error);
  const { email: rawEmail, password } = (body.value ?? {}) as { email?: unknown; password?: unknown };
  if (typeof rawEmail !== "string" || typeof password !== "string") return jsonError(400, "Email and password are required.");
  const email = normalizeEmail(rawEmail);

  const attempt = await beginLoginAttempt(clientIpKey(req), email);
  if (attempt.limited) {
    log.warn("auth.login.rate_limited", { email, retryAfter: attempt.retryAfter, limitedBy: attempt.limitedBy });
    const minutes = Math.ceil(attempt.retryAfter / 60);
    return jsonError(429, `Too many login attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, { retryAfter: attempt.retryAfter });
  }

  const owner = await findOwnerByEmail(email);
  // verifyPassword spends the same effort when the account does not exist.
  const valid = await verifyPassword(owner?.passwordHash ?? null, password);
  if (!valid || !owner) {
    // The reply is the same for both; only the log says which it was.
    log.warn("auth.login.failed", { reason: owner ? "bad_password" : "unknown_email", ownerId: owner?.id, email });
    return jsonError(401, GENERIC_FAILURE);
  }
  // Only someone who knows the password learns the account is unconfirmed. They
  // get a fresh code (within the usual send limits) and the code screen.
  if (!owner.emailVerifiedAt) {
    const gate = await beginAttempt(codeSendBuckets(clientIpKey(req), email));
    log.info("auth.login.unconfirmed", { ownerId: owner.id, email, codeSent: !gate.limited, retryAfter: gate.retryAfter, limitedBy: gate.limitedBy });
    if (!gate.limited) inBackground(async () => void (await sendConfirmationCode(log, { id: owner.id, email })), log);
    return jsonError(
      403,
      gate.limited
        ? "Confirm your email address first. Enter the code we already sent, or wait to request a new one."
        : "Confirm your email address first. We sent a 6-digit code to your inbox.",
      { code: "email_not_verified", retryAfter: gate.limited ? gate.retryAfter : CODE_COOLDOWN_MS / 1000 },
    );
  }

  await markLoginSuccess(attempt.rowIds, email);
  const tokens = await issueSession(owner.id, req.headers.get("user-agent"));
  log.info("auth.login.ok", { ownerId: owner.id, email });
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  setAuthCookies(res, tokens);
  return res;
}
