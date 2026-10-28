import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { formatBytes } from "@/lib/shared/limits";
import {
  sessionCookieName,
  sessionCookieOptions,
  validateSessionToken,
  type ValidSession,
} from "@/lib/server/auth/session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

const trustProxy = () => process.env.TRUST_PROXY === "true";

export function clientIpKey(req: NextRequest): string {
  if (trustProxy()) {
    // Only the LAST X-Forwarded-For entry was written by our trusted proxy;
    // earlier entries come from the client and can be forged.
    const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (ip) return `ip:${ip.slice(0, 64)}`;
  }
  // Without a trusted proxy the address cannot be known reliably; all clients
  // share one bucket, which still caps guessing at MAX_FAILURES_PER_IP.
  return "ip:unknown";
}

function expectedOrigin(req: NextRequest): string | null {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/+$/, "");
  // Forwarded headers are only believed behind a trusted proxy.
  const forwardedHost = trustProxy() ? req.headers.get("x-forwarded-host") : null;
  const forwardedProto = trustProxy() ? req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() : undefined;
  const host = forwardedHost ?? req.headers.get("host");
  if (!host) return null;
  const proto = forwardedProto ?? req.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/**
 * CSRF defence for state-changing requests, layered on SameSite=Lax cookies:
 * the Origin header must match this app's origin. Browsers always send Origin
 * on cross-origin POST/PUT/PATCH/DELETE, so a forged request cannot pass.
 * If Origin is absent, Sec-Fetch-Site must say "same-origin".
 */
export function isSameOriginRequest(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    const expected = expectedOrigin(req);
    return expected !== null && origin === expected;
  }
  return req.headers.get("sec-fetch-site") === "same-origin";
}

export function requireJsonContentType(req: NextRequest): boolean {
  return (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

/**
 * Reads a JSON body with a hard size cap, enforced while streaming so a huge
 * body (declared or chunked) is never held in memory: 413 as soon as the cap
 * is crossed, 400 only for a body that is genuinely not JSON.
 */
export async function readJsonBody(
  req: NextRequest,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
  const tooLarge = { ok: false as const, status: 413, error: `Request body is too large. The limit is ${formatBytes(maxBytes)}.` };
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return tooLarge;

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return tooLarge;
      }
      chunks.push(value);
    }
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400, error: "Body is not valid JSON." };
  }
}

export type AuthedContext = { ownerId: string; session: ValidSession };

type Handler<C> = (req: NextRequest, auth: AuthedContext, ctx: C) => Promise<Response>;

/**
 * Wraps a Route Handler so it only runs for a valid session. The owner is
 * always resolved from the server-side session; nothing in the request can
 * choose which owner's data is touched.
 */
export function withOwner<C = unknown>(handler: Handler<C>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    if (!SAFE_METHODS.has(req.method) && !isSameOriginRequest(req)) {
      return jsonError(403, "Cross-origin request rejected.");
    }
    const token = req.cookies.get(sessionCookieName())?.value;
    const session = await validateSessionToken(token);
    if (!session) return jsonError(401, "Not authenticated.");

    const res = await handler(req, { ownerId: session.ownerId, session }, ctx);
    if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
    if (session.renewed && token && res instanceof NextResponse) {
      res.cookies.set(sessionCookieName(), token, sessionCookieOptions(session.expiresAt));
    }
    return res;
  };
}
