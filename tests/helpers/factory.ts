import { NextRequest } from "next/server";
import { expect } from "vitest";
import { prisma } from "@/lib/server/db";
import { previewImport, commitImport, type ImportReport } from "@/lib/server/import";
import { setOwnerPassword } from "@/lib/server/owner";

export const ORIGIN = "http://localhost:3000";
export const PASSWORD = "correct horse battery staple";

/** Creates an owner with a password and default profile. */
export async function createOwner(slug = "primary", password = PASSWORD): Promise<string> {
  const { ownerId } = await setOwnerPassword(password, slug);
  return ownerId;
}

/** Creates an owner without going through Argon2 (fast, for data tests). */
export async function createBareOwner(slug: string): Promise<string> {
  const owner = await prisma.owner.create({ data: { slug, profile: { create: {} } } });
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

/** Extracts "name=value" from a Set-Cookie header for reuse as a Cookie header. */
export function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie");
  if (!raw) throw new Error("no Set-Cookie header");
  return raw.split(";")[0];
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
