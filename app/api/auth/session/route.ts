import { NextResponse } from "next/server";
import { sessionCookieName, sessionCookieOptions } from "@/lib/server/auth/session";
import { withOwner } from "@/lib/server/http";

/**
 * Session keep-alive. Only a valid session reaches this handler (withOwner
 * answers 401 otherwise), so the browser cookie's expiry is only ever extended
 * for a live session, in step with the sliding expiry stored in the database.
 */
export const GET = withOwner(async (req, { session }) => {
  const res = NextResponse.json({ authenticated: true, expires_at: session.expiresAt.toISOString() });
  const token = req.cookies.get(sessionCookieName())?.value;
  if (token) res.cookies.set(sessionCookieName(), token, sessionCookieOptions(session.expiresAt));
  return res;
});
