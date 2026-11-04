import { NextResponse } from "next/server";
import { withOwner } from "@/lib/server/http";

/**
 * Session keep-alive. Only a valid sign-in reaches this handler (withOwner
 * answers 401 otherwise, and rotates an expired access token through the
 * refresh cookie), so the browser's cookies are only ever renewed for a live
 * session.
 */
export const GET = withOwner(async (_req, { session }) => {
  return NextResponse.json({ authenticated: true, expires_at: session.expiresAt.toISOString() });
});
