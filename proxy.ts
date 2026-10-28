import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirect only. Real authorization happens on the server for every
// page (requireOwner) and API route (withOwner); this file never touches the
// database and never sets cookies, so it cannot extend the life of a cookie
// whose session is invalid or expired. (The browser cookie's expiry is renewed
// by /api/auth/session, which only responds for a valid session.)
//
// API routes are deliberately NOT matched below: when a proxy runs on a route
// Next.js buffers the request body in memory and truncates it at 10 MB, which
// would turn "too large" into a confusing "invalid JSON". The API enforces its
// own explicit size limits instead (lib/server/http.ts).

const COOKIE = process.env.NODE_ENV === "production" ? "__Host-ft_session" : "ft_session";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/login") return NextResponse.next();

  if (!request.cookies.get(COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
