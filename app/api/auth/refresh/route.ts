import { NextResponse, type NextRequest } from "next/server";
import { refreshCookieName } from "@/lib/server/auth/cookies";
import { clearAuthCookies, rotateRefreshToken, setAuthCookies } from "@/lib/server/auth/session";
import { requestLogger } from "@/lib/server/log";
import { safeNextPath } from "@/lib/shared/redirect";

/**
 * Landing point for proxy.ts when a page request arrives with an expired access
 * token: Server Components cannot set cookies, a Route Handler can. Rotates the
 * refresh token, then sends the browser back to the page it asked for (a safe,
 * same-site path only). On failure the cookies are cleared and the user goes to
 * the sign-in page. Nothing sensitive is returned, and the worst a forged link
 * can do is renew the visitor's own session.
 */
export async function GET(req: NextRequest) {
  const next = safeNextPath(req.nextUrl.searchParams.get("next"));
  const tokens = await rotateRefreshToken(req.cookies.get(refreshCookieName())?.value, req.headers.get("user-agent"), requestLogger(req), "page");
  if (!tokens) {
    const login = new URL("/login", req.url);
    if (next !== "/") login.searchParams.set("next", next);
    const res = NextResponse.redirect(login);
    clearAuthCookies(res);
    return res;
  }
  const res = NextResponse.redirect(new URL(next, req.url));
  res.headers.set("Cache-Control", "no-store");
  setAuthCookies(res, tokens);
  return res;
}
