import { NextRequest } from "next/server";
import { expect } from "vitest";
import { prisma } from "@/lib/server/db";
import { previewImport, commitImport, type ImportReport } from "@/lib/server/import";
import { detachedBackground } from "@/lib/server/http";
import { setOwnerPassword } from "@/lib/server/owner";

export const ORIGIN = "http://localhost:3000";
export const PASSWORD = "correct horse battery staple";
/** Email of the default test owner (createOwner() with no argument). */
export const EMAIL = "primary@example.test";
/** JSON body for /api/auth/login as the default test owner. */
export const loginBody = (password = PASSWORD, email = EMAIL) => ({ email, password });

/** Creates an owner with a password and default profile. */
export async function createOwner(slug = "primary", password = PASSWORD): Promise<string> {
  const { ownerId } = await setOwnerPassword(`${slug}@example.test`, password);
  return ownerId;
}

/** Creates an owner without going through Argon2 (fast, for data tests). */
export async function createBareOwner(slug: string): Promise<string> {
  const owner = await prisma.owner.create({ data: { email: `${slug}@example.test`, passwordHash: "x", emailVerifiedAt: new Date(), profile: { create: {} } } });
  return owner.id;
}

type ReqInit = {
  method?: string;
  body?: unknown;
  cookie?: string;
  origin?: string | null;
  headers?: Record<string, string>;
};

export function request(path: string, init: ReqInit = {}): NextRequest {
  const headers = new Headers({ host: "localhost:3000", ...init.headers });
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(new URL(path, ORIGIN), {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

/** Builds a Cookie header from every non-empty cookie a response sets (access and refresh). */
export function cookieFrom(res: Response): string {
  const cookies = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="));
  if (!cookies.length) throw new Error("no Set-Cookie header");
  return cookies.join("; ");
}

/** Value of one named cookie from a Set-Cookie response. */
export function cookieValue(res: Response, name: string): string | undefined {
  const hit = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return hit?.split(";")[0].slice(name.length + 1) || undefined;
}

/** Preview then commit, asserting both succeed. */
export async function importOk(ownerId: string, payload: unknown): Promise<ImportReport> {
  const preview = await previewImport(ownerId, payload);
  if (!preview.ok) throw new Error(`preview failed: ${preview.errors.join("; ")}`);
  const result = await commitImport(ownerId, payload, preview.preview_token);
  if (!result.ok) throw new Error(`commit failed: ${result.error}`);
  expect(result.counts).toEqual(preview.counts);
  return result;
}

export const ctx = { params: Promise.resolve({}) };

/** Waits for background work (confirmation emails) started by the route handlers. */
export const flushBackground = () => Promise.all([...detachedBackground]);
