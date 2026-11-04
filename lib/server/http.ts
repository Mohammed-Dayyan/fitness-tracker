import "server-only";
import { after, NextResponse, type NextRequest } from "next/server";
import { formatBytes } from "@/lib/shared/limits";
import { accessCookieName, refreshCookieName } from "@/lib/server/auth/cookies";
import { verifyAccessToken } from "@/lib/server/auth/jwt";
import { errorFields, log as rootLog, requestLogger, type Logger } from "@/lib/server/log";
import { clearAuthCookies, rotateRefreshToken, setAuthCookies, type IssuedTokens } from "@/lib/server/auth/session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (typeof extra?.retryAfter === "number") headers["Retry-After"] = String(extra.retryAfter);
  return NextResponse.json({ error, ...extra }, { status, headers });
}

/** Background tasks started outside a request (unit tests, scripts), so they can be awaited. */
export const detachedBackground = new Set<Promise<void>>();

/**
 * Runs work after the response has been sent, so a slow side effect (SMTP) or
 * account-dependent work cannot change how long the reply takes. Failures are
 * logged, never thrown. Outside a request (unit tests) it runs detached and is
 * tracked in `detachedBackground`.
 */
export function inBackground(work: () => Promise<void>, log: Logger = rootLog): void {
  const guarded = () => work().catch((e: unknown) => log.error("background.failed", errorFields(e, { stack: true })));
  try {
    after(guarded);
  } catch {
    const task = guarded().finally(() => detachedBackground.delete(task));
    detachedBackground.add(task);
  }
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

export type AuthedContext = { ownerId: string; session: { expiresAt: Date } };

type Handler<C> = (req: NextRequest, auth: AuthedContext, ctx: C) => Promise<Response>;

/**
 * Wraps a Route Handler so it only runs for a valid sign-in. The owner is
 * always resolved from the signed access token; nothing in the request can
 * choose which owner's data is touched. If the access token has expired but the
 * refresh cookie is good, the pair is rotated here and the new cookies ride on
 * the response, so a long-open tab keeps working.
 */
export function withOwner<C = unknown>(handler: Handler<C>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    if (!SAFE_METHODS.has(req.method) && !isSameOriginRequest(req)) {
      return jsonError(403, "Cross-origin request rejected.");
    }
    const log = requestLogger(req);
    let access = await verifyAccessToken(req.cookies.get(accessCookieName())?.value);
    let issued: IssuedTokens | null = null;
    if (!access) {
      const rotated = await rotateRefreshToken(req.cookies.get(refreshCookieName())?.value, req.headers.get("user-agent"), log, "api");
      if (!rotated) {
        log.debug("auth.session.rejected", { hadAccessCookie: req.cookies.has(accessCookieName()), hadRefreshCookie: req.cookies.has(refreshCookieName()) });
        const res = jsonError(401, "Not authenticated.");
        if (req.cookies.has(accessCookieName()) || req.cookies.has(refreshCookieName())) clearAuthCookies(res);
        return res;
      }
      issued = rotated;
      access = { ownerId: rotated.ownerId, expiresAt: rotated.accessExpiresAt };
    }

    let res = await handler(req, { ownerId: access.ownerId, session: { expiresAt: access.expiresAt } }, ctx);
    if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
    if (issued) {
      // The refresh token was just rotated, so the browser MUST receive the new
      // cookies or its old token would later look stolen. A handler may return a
      // plain Response (no cookie helper): rewrap it, keeping body and headers.
      if (!(res instanceof NextResponse)) {
        res = new NextResponse(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
      }
      setAuthCookies(res as NextResponse, issued);
    }
    return res;
  };
}
