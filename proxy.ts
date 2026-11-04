import { NextResponse, type NextRequest } from "next/server";
import { accessCookieName, refreshCookieName } from "@/lib/server/auth/cookies";
import { verifyAccessToken } from "@/lib/server/auth/jwt";

// Optimistic gate only. Real authorization happens on the server for every page
// (requireOwner) and API route (withOwner). This file never touches the
// database: it checks the signed access token's signature and expiry.
//
// An expired access token with a refresh cookie is sent to /api/auth/refresh,
// the one place that rotates the pair and sets new cookies, then returns here.
//
// API routes are deliberately NOT matched below: when a proxy runs on a route
// Next.js buffers the request body in memory and truncates it at 10 MB, which
// would turn "too large" into a confusing "invalid JSON". The API enforces its
// own explicit size limits instead (lib/server/http.ts).

const PUBLIC_PATHS = new Set(["/login", "/register"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (await verifyAccessToken(request.cookies.get(accessCookieName())?.value)) return NextResponse.next();

  const url = request.nextUrl.clone();
  const next = pathname === "/" ? "" : pathname + search;
  if (request.cookies.get(refreshCookieName())?.value) {
    url.pathname = "/api/auth/refresh";
    url.search = next ? `?next=${encodeURIComponent(next)}` : "";
  } else {
    url.pathname = "/login";
    url.search = next ? `?next=${encodeURIComponent(next)}` : "";
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
