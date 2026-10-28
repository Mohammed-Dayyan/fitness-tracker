import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookieName, validateSessionToken } from "@/lib/server/auth/session";
import { safeNextPath } from "@/lib/shared/redirect";

/**
 * For the sign-in page: if the browser already holds a valid session, go to the
 * app (or the safe `next` destination) instead of showing the form. An invalid,
 * forged or expired cookie is not a session and falls through to the form.
 * Must be called inside a <Suspense> boundary (it reads cookies).
 */
export async function redirectIfSignedIn(next?: string | null): Promise<void> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (await validateSessionToken(token)) redirect(safeNextPath(next));
}

/**
 * Data Access Layer entry point for Server Components: validates the session
 * against the database on every call and redirects to /login if it is not
 * valid. Must be called inside a <Suspense> boundary (it reads cookies).
 */
export async function requireOwner(): Promise<{ ownerId: string }> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const session = await validateSessionToken(token);
  if (!session) redirect("/login");
  return { ownerId: session.ownerId };
}
