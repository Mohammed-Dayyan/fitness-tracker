import { describe, expect, it } from "vitest";
import { proxy, config as proxyConfig } from "@/proxy";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as session } from "@/app/api/auth/session/route";
import { prisma } from "@/lib/server/db";
import {
  beginLoginAttempt,
  LOGIN_WINDOW_MS,
  MAX_FAILURES_GLOBAL,
  MAX_FAILURES_PER_IP,
  purgeStaleAuthRows,
} from "@/lib/server/auth/rate-limit";
import { CLEANUP_BATCH, createSession } from "@/lib/server/auth/session";
import { cookieFrom, createOwner, ctx, PASSWORD, request } from "./helpers/factory";

const loginReq = (password: string, ip: string) => request("/api/auth/login", { body: { password }, headers: { "x-forwarded-for": ip } });
const ago = (ms: number) => new Date(Date.now() - ms);
const attempts = () => prisma.loginAttempt.count();

describe("audit #13: bounded cleanup and rate-limit storage", () => {
  it("attempts over the limit are refused but not stored: the table cannot grow under sustained hammering", async () => {
    let limited = 0;
    for (let i = 0; i < 200; i++) if ((await beginLoginAttempt("ip:1.1.1.1")).limited) limited++;
    expect(limited).toBe(200 - MAX_FAILURES_PER_IP);
    expect(await attempts()).toBe(MAX_FAILURES_PER_IP);
  });

  it("the global cap is enforced and stored rows stay bounded across many clients", async () => {
    let limited = 0;
    for (let i = 0; i < 80; i++) if ((await beginLoginAttempt(`ip:10.0.0.${i}`)).limited) limited++;
    expect(limited).toBe(80 - MAX_FAILURES_GLOBAL);
    expect(await attempts()).toBe(MAX_FAILURES_GLOBAL);
  });

  it("hammering does not extend the lockout: it ends one window after the failures that caused it", async () => {
    for (let i = 0; i < 30; i++) await beginLoginAttempt("ip:2.2.2.2");
    expect((await beginLoginAttempt("ip:2.2.2.2")).limited).toBe(true);
    // Age the stored failures past the window.
    await prisma.loginAttempt.updateMany({ data: { createdAt: ago(LOGIN_WINDOW_MS + 1000) } });
    expect((await beginLoginAttempt("ip:2.2.2.2")).limited).toBe(false);
  });

  it("parallel guesses still cannot slip past the limit", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => beginLoginAttempt("ip:3.3.3.3")));
    expect(results.filter((r) => !r.limited).length).toBeLessThanOrEqual(MAX_FAILURES_PER_IP);
    expect(await attempts()).toBeLessThanOrEqual(MAX_FAILURES_PER_IP + 25); // never unbounded; settles at the cap below
    await beginLoginAttempt("ip:3.3.3.3");
    expect(await attempts()).toBeLessThanOrEqual(MAX_FAILURES_PER_IP + 1);
  });

  it("stale login attempts are purged by failed attempts alone, a bounded batch at a time", async () => {
    const stale = Array.from({ length: CLEANUP_BATCH * 2 }, () => ({ ipKey: "ip:old", success: false, createdAt: ago(2 * LOGIN_WINDOW_MS) }));
    await prisma.loginAttempt.createMany({ data: stale });
    await beginLoginAttempt("ip:4.4.4.4"); // one failed attempt, no successful login anywhere
    expect(await attempts()).toBe(CLEANUP_BATCH + 1); // exactly one batch removed (plus the new row)
    await beginLoginAttempt("ip:4.4.4.4");
    expect(await attempts()).toBe(2); // backlog gone: only the two fresh rows remain
  });

  it("expired sessions are purged by a failed login attempt; live ones are kept", async () => {
    const ownerId = await createOwner();
    for (let i = 0; i < 4; i++) await createSession(ownerId);
    const all = await prisma.session.findMany({ orderBy: { createdAt: "asc" } });
    // Expire all but the first.
    await prisma.session.updateMany({ where: { id: { in: all.slice(1).map((s) => s.id) } }, data: { expiresAt: ago(1000) } });
    const res = await login(loginReq("wrong password", "198.51.100.50"));
    expect(res.status).toBe(401);
    const left = await prisma.session.findMany();
    expect(left.map((s) => s.id)).toEqual([all[0].id]);
  });

  it("purgeStaleAuthRows reports what it removed and never exceeds the batch size", async () => {
    await prisma.loginAttempt.createMany({ data: Array.from({ length: CLEANUP_BATCH + 10 }, () => ({ ipKey: "ip:x", success: true, createdAt: ago(3 * LOGIN_WINDOW_MS) })) });
    expect(await purgeStaleAuthRows()).toEqual({ attempts: CLEANUP_BATCH, sessions: 0 });
    expect(await purgeStaleAuthRows()).toEqual({ attempts: 10, sessions: 0 });
  });

  it("lockout still holds for the right password, and a normal login still works afterwards", async () => {
    await createOwner();
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) expect((await login(loginReq("nope nope nope", "198.51.100.60"))).status).toBe(401);
    expect((await login(loginReq(PASSWORD, "198.51.100.60"))).status).toBe(429);
    await prisma.loginAttempt.updateMany({ data: { createdAt: ago(LOGIN_WINDOW_MS + 1000) } });
    expect((await login(loginReq(PASSWORD, "198.51.100.60"))).status).toBe(200);
  });
});

describe("audit #24: invalid or expired session cookies are never refreshed", () => {
  it("the proxy never sets a cookie, whatever the cookie contains", () => {
    for (const cookie of ["ft_session=forged-token", "ft_session=" + "x".repeat(60)]) {
      const res = proxy(request("/history", { cookie }));
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.status).toBe(200);
    }
    const none = proxy(request("/history"));
    expect(none.status).toBe(307);
    expect(none.headers.get("location")).toContain("/login?next=%2Fhistory");
  });

  it("API routes are not matched by the proxy (no body buffering or truncation)", () => {
    const matcher = proxyConfig.matcher[0];
    expect(matcher).toContain("(?!api/");
  });

  it("the keep-alive endpoint extends the cookie only for a live session", async () => {
    const ownerId = await createOwner();
    const { token } = await createSession(ownerId);
    const ok = await session(request("/api/auth/session", { cookie: `ft_session=${token}` }), ctx);
    expect(ok.status).toBe(200);
    const header = ok.headers.get("set-cookie")!;
    expect(header).toMatch(/^ft_session=/);
    const expires = new Date(/Expires=([^;]+)/i.exec(header)![1]).getTime();
    expect(expires).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(cookieFrom(ok).split("=")[1]).toBe(token);

    // Forged, unknown and expired tokens: 401 and no Set-Cookie at all.
    await prisma.session.updateMany({ data: { expiresAt: ago(1000) } });
    for (const t of ["forged", token]) {
      const res = await session(request("/api/auth/session", { cookie: `ft_session=${t}` }), ctx);
      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect((await session(request("/api/auth/session"), ctx)).headers.get("set-cookie")).toBeNull();
  });
});
