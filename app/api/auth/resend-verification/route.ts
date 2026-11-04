import { NextResponse, type NextRequest } from "next/server";
import { beginAttempt, CODE_COOLDOWN_MS, codeSendBuckets } from "@/lib/server/auth/rate-limit";
import { sendOtpEmail } from "@/lib/server/auth/mailer";
import { issueOtp, OTP_TTL_MS } from "@/lib/server/auth/otp";
import { clientIpKey, inBackground, isSameOriginRequest, jsonError, readJsonBody, requireJsonContentType } from "@/lib/server/http";
import { findOwnerByEmail, normalizeEmail } from "@/lib/server/owner";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) return jsonError(403, "Cross-origin request rejected.");
  if (!requireJsonContentType(req)) return jsonError(415, "Expected application/json.");

  const body = await readJsonBody(req, 4096);
  if (!body.ok) return jsonError(body.status, body.error);
  const rawEmail = (body.value as { email?: unknown } | null)?.email;
  if (typeof rawEmail !== "string") return jsonError(400, "Email is required.");
  const email = normalizeEmail(rawEmail);

  const gate = await beginAttempt(codeSendBuckets(clientIpKey(req), email));
  if (gate.limited) return jsonError(429, "Please wait before asking for another code.", { retryAfter: gate.retryAfter });

  inBackground(async () => {
    const owner = await findOwnerByEmail(email);
    if (owner && !owner.emailVerifiedAt) await sendOtpEmail(email, await issueOtp(owner.id));
  });
  // Same answer for unknown, confirmed and unconfirmed addresses.
  return NextResponse.json(
    { ok: true, message: `If ${email} is waiting for confirmation, a new code is on its way.`, retryAfter: CODE_COOLDOWN_MS / 1000, expiresIn: OTP_TTL_MS / 1000 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
