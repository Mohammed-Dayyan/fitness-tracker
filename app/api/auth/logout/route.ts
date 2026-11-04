import { NextResponse, type NextRequest } from "next/server";
import { refreshCookieName } from "@/lib/server/auth/cookies";
import { clearAuthCookies, revokeRefreshToken } from "@/lib/server/auth/session";
import { isSameOriginRequest, jsonError } from "@/lib/server/http";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) return jsonError(403, "Cross-origin request rejected.");
  // Deleting the server-side token family is what ends the sign-in; clearing
  // the cookies is a courtesy to the browser.
  await revokeRefreshToken(req.cookies.get(refreshCookieName())?.value);
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  clearAuthCookies(res);
  return res;
}
