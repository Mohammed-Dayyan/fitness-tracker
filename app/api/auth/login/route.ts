import { NextResponse, type NextRequest } from "next/server";
import { verifyPassword } from "@/lib/server/auth/password";
import { beginLoginAttempt, markLoginSuccess } from "@/lib/server/auth/rate-limit";
import { createSession, sessionCookieName, sessionCookieOptions } from "@/lib/server/auth/session";
import { clientIpKey, isSameOriginRequest, jsonError, readJsonBody, requireJsonContentType } from "@/lib/server/http";
import { getPrimaryOwner } from "@/lib/server/owner";

const GENERIC_FAILURE = "Invalid password.";

export async function POST(req: NextRequest) {
  // Login CSRF: refuse cross-origin submissions.
  if (!isSameOriginRequest(req)) return jsonError(403, "Cross-origin request rejected.");
  if (!requireJsonContentType(req)) return jsonError(415, "Expected application/json.");

  const body = await readJsonBody(req, 4096);
  if (!body.ok) return jsonError(body.status, body.error);
  const password = (body.value as { password?: unknown } | null)?.password;
  if (typeof password !== "string") return jsonError(400, "Password is required.");

  const ipKey = clientIpKey(req);
  const { limited } = await beginLoginAttempt(ipKey);
  if (limited) return jsonError(429, "Too many login attempts. Try again in 15 minutes.");

  const owner = await getPrimaryOwner();
  // verifyPassword spends the same effort when no owner/password exists.
  const valid = await verifyPassword(owner?.passwordHash ?? null, password);
  if (!valid || !owner) return jsonError(401, GENERIC_FAILURE);

  await markLoginSuccess(ipKey);
  const { token, expiresAt } = await createSession(owner.id, req.headers.get("user-agent"));
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(sessionCookieName(), token, sessionCookieOptions(expiresAt));
  return res;
}
