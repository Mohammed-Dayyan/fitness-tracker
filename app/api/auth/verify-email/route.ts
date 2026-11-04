import { NextResponse, type NextRequest } from "next/server";
import { beginAttempt, clearAttempts, emailKey, MAX_CODE_CHECKS_PER_EMAIL, MAX_CODE_CHECKS_PER_IP } from "@/lib/server/auth/rate-limit";
import { checkOtp, isWellFormedCode } from "@/lib/server/auth/otp";
import { issueSession, setAuthCookies } from "@/lib/server/auth/session";
import { clientIpKey, isSameOriginRequest, jsonError, readJsonBody, requireJsonContentType } from "@/lib/server/http";
import { requestLogger } from "@/lib/server/log";
import { normalizeEmail } from "@/lib/server/owner";

const WRONG = "That code is incorrect or has expired. Check the email, or ask for a new code.";

/**
 * Confirms an email address with the 6-digit code and signs the person in. Every
 * kind of failure gives the same answer. A code survives 5 wrong guesses (counted
 * atomically, so parallel requests cannot cheat), and submissions are also
 * limited per client and per address.
 */
export async function POST(req: NextRequest) {
  const log = requestLogger(req);
  if (!isSameOriginRequest(req)) {
    log.warn("auth.otp.rejected", { reason: "cross_origin", origin: req.headers.get("origin") });
    return jsonError(403, "Cross-origin request rejected.");
  }
  if (!requireJsonContentType(req)) return jsonError(415, "Expected application/json.");

  const body = await readJsonBody(req, 1024);
  if (!body.ok) return jsonError(body.status, body.error);
  const { email: rawEmail, code } = (body.value ?? {}) as { email?: unknown; code?: unknown };
  if (typeof rawEmail !== "string" || !isWellFormedCode(code)) {
    log.debug("auth.otp.rejected", { reason: "malformed" });
    return jsonError(400, WRONG);
  }
  const email = normalizeEmail(rawEmail);

  const attempt = await beginAttempt([
    { key: `check-ip:${clientIpKey(req)}`, max: MAX_CODE_CHECKS_PER_IP },
    { key: `check:${emailKey(email)}`, max: MAX_CODE_CHECKS_PER_EMAIL },
  ]);
  if (attempt.limited) {
    log.warn("auth.otp.rate_limited", { email, retryAfter: attempt.retryAfter, limitedBy: attempt.limitedBy });
    return jsonError(429, "Too many attempts. Try again later.", { retryAfter: attempt.retryAfter });
  }

  const result = await checkOtp(email, code);
  if (!result.ok) {
    log.warn("auth.otp.rejected", { reason: result.reason, ownerId: result.ownerId, email, attemptsUsed: result.attemptsUsed });
    return jsonError(400, WRONG);
  }

  await clearAttempts(attempt.rowIds);
  const tokens = await issueSession(result.ownerId, req.headers.get("user-agent"));
  log.info("auth.otp.confirmed", { ownerId: result.ownerId, email });
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  setAuthCookies(res, tokens);
  return res;
}
