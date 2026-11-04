import { NextResponse, type NextRequest } from "next/server";
import { refreshCookieName } from "@/lib/server/auth/cookies";
import { clearAuthCookies, revokeRefreshToken } from "@/lib/server/auth/session";
import { isSameOriginRequest, jsonError } from "@/lib/server/http";
import { requestLogger } from "@/lib/server/log";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) return jsonError(403, "Cross-origin request rejected.");
  // Deleting the server-side token family is what ends the sign-in; clearing
  // the cookies is a courtesy to the browser.
  const revoked = await revokeRefreshToken(req.cookies.get(refreshCookieName())?.value);
  requestLogger(req).info("auth.logout", revoked ? { ownerId: revoked.ownerId, tokensDeleted: revoked.tokensDeleted } : { signedIn: false });
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  clearAuthCookies(res);
  return res;
}
