import { NextResponse, type NextRequest } from "next/server";
import { verifyPassword } from "@/lib/server/auth/password";
import { beginAttempt, beginLoginAttempt, CODE_COOLDOWN_MS, codeSendBuckets, markLoginSuccess } from "@/lib/server/auth/rate-limit";
import { sendOtpEmail } from "@/lib/server/auth/mailer";
import { issueOtp } from "@/lib/server/auth/otp";
import { issueSession, setAuthCookies } from "@/lib/server/auth/session";
import { clientIpKey, inBackground, isSameOriginRequest, jsonError, readJsonBody, requireJsonContentType } from "@/lib/server/http";
import { findOwnerByEmail, normalizeEmail } from "@/lib/server/owner";

const GENERIC_FAILURE = "Invalid email or password.";

export async function POST(req: NextRequest) {
  // Login CSRF: refuse cross-origin submissions.
  if (!isSameOriginRequest(req)) return jsonError(403, "Cross-origin request rejected.");
  if (!requireJsonContentType(req)) return jsonError(415, "Expected application/json.");

  const body = await readJsonBody(req, 4096);
  if (!body.ok) return jsonError(body.status, body.error);
  const { email: rawEmail, password } = (body.value ?? {}) as { email?: unknown; password?: unknown };
  if (typeof rawEmail !== "string" || typeof password !== "string") return jsonError(400, "Email and password are required.");
  const email = normalizeEmail(rawEmail);

  const attempt = await beginLoginAttempt(clientIpKey(req), email);
  if (attempt.limited) {
    const minutes = Math.ceil(attempt.retryAfter / 60);
    return jsonError(429, `Too many login attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, { retryAfter: attempt.retryAfter });
  }

  const owner = await findOwnerByEmail(email);
  // verifyPassword spends the same effort when the account does not exist.
  const valid = await verifyPassword(owner?.passwordHash ?? null, password);
  if (!valid || !owner) return jsonError(401, GENERIC_FAILURE);
  // Only someone who knows the password learns the account is unconfirmed. They
  // get a fresh code (within the usual send limits) and the code screen.
  if (!owner.emailVerifiedAt) {
    const gate = await beginAttempt(codeSendBuckets(clientIpKey(req), email));
    if (!gate.limited) inBackground(async () => sendOtpEmail(email, await issueOtp(owner.id)));
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
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  setAuthCookies(res, tokens);
  return res;
}
