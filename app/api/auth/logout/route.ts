import { NextResponse, type NextRequest } from "next/server";
import { invalidateSessionToken, sessionCookieName } from "@/lib/server/auth/session";
import { isSameOriginRequest, jsonError } from "@/lib/server/http";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) return jsonError(403, "Cross-origin request rejected.");
  // Deleting the server-side record is what ends the session; clearing the
  // cookie is a courtesy to the browser.
  await invalidateSessionToken(req.cookies.get(sessionCookieName())?.value);
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(sessionCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
