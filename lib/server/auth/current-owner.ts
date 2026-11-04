import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accessCookieName } from "@/lib/server/auth/cookies";
import { verifyAccessToken } from "@/lib/server/auth/jwt";
import { safeNextPath } from "@/lib/shared/redirect";

/**
 * For the sign-in pages: if the browser already holds a valid access token, go
 * to the app (or the safe `next` destination) instead of showing the form. An
 * invalid, forged or expired token falls through to the form.
 * Must be called inside a <Suspense> boundary (it reads cookies).
 */
export async function redirectIfSignedIn(next?: string | null): Promise<void> {
  const token = (await cookies()).get(accessCookieName())?.value;
  if (await verifyAccessToken(token)) redirect(safeNextPath(next));
}

/**
 * Data Access Layer entry point for Server Components: verifies the signed
 * access token on every call and redirects to /login if it is not valid. A
 * merely expired token never gets here: proxy.ts sends the browser through
 * /api/auth/refresh first (Server Components cannot set cookies).
 * Must be called inside a <Suspense> boundary (it reads cookies).
 */
export async function requireOwner(): Promise<{ ownerId: string }> {
  const token = (await cookies()).get(accessCookieName())?.value;
  const access = await verifyAccessToken(token);
  if (!access) redirect("/login");
  return { ownerId: access.ownerId };
}
