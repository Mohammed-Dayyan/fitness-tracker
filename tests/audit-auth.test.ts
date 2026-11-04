import { describe, expect, it } from "vitest";
import { proxy, config as proxyConfig } from "@/proxy";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as session } from "@/app/api/auth/session/route";
import { prisma } from "@/lib/server/db";
import {
  beginLoginAttempt,
  LOGIN_WINDOW_MS,
  MAX_FAILURES_PER_EMAIL,
  MAX_FAILURES_PER_IP,
  purgeStaleAuthRows,
} from "@/lib/server/auth/rate-limit";
import { CLEANUP_BATCH, issueSession } from "@/lib/server/auth/session";
import { createOwner, ctx, loginBody, PASSWORD, request } from "./helpers/factory";

const loginReq = (password: string, ip: string, email?: string) =>
  request("/api/auth/login", { body: loginBody(password, email), headers: { "x-forwarded-for": ip } });
const ago = (ms: number) => new Date(Date.now() - ms);
const attempts = () => prisma.loginAttempt.count();
const attemptsFor = (key: string) => prisma.loginAttempt.count({ where: { ipKey: key } });
let n = 0;
/** A fresh address per call, so only the per-client limit is in play. */
const fresh = () => `fresh${n++}@example.test`;

describe("audit #13: bounded cleanup and rate-limit storage", () => {
  it("attempts over the limit are refused but not stored: the table cannot grow under sustained hammering", async () => {
    let limited = 0;
    for (let i = 0; i < 100; i++) if ((await beginLoginAttempt("ip:1.1.1.1", fresh())).limited) limited++;
    expect(limited).toBe(100 - MAX_FAILURES_PER_IP);
    expect(await attemptsFor("ip:1.1.1.1")).toBe(MAX_FAILURES_PER_IP);
  });

  it("the per-account cap holds across many clients and stored rows stay bounded", async () => {
    let limited = 0;
    for (let i = 0; i < 40; i++) if ((await beginLoginAttempt(`ip:10.0.0.${i}`, "victim@example.test")).limited) limited++;
    expect(limited).toBe(40 - MAX_FAILURES_PER_EMAIL);
    expect(await attemptsFor("email:victim@example.test")).toBe(MAX_FAILURES_PER_EMAIL);
  });

  it("hammering does not extend the lockout: it ends one window after the failures that caused it", async () => {
    for (let i = 0; i < 30; i++) await beginLoginAttempt("ip:2.2.2.2", fresh());
    expect((await beginLoginAttempt("ip:2.2.2.2", fresh())).limited).toBe(true);
    // Age the stored failures past the window.
    await prisma.loginAttempt.updateMany({ data: { createdAt: ago(LOGIN_WINDOW_MS + 1000) } });
    expect((await beginLoginAttempt("ip:2.2.2.2", fresh())).limited).toBe(false);
  });

  it("parallel guesses still cannot slip past the limit", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => beginLoginAttempt("ip:3.3.3.3", fresh())));
    expect(results.filter((r) => !r.limited).length).toBeLessThanOrEqual(MAX_FAILURES_PER_IP);
    await beginLoginAttempt("ip:3.3.3.3", fresh());
    expect(await attemptsFor("ip:3.3.3.3")).toBeLessThanOrEqual(MAX_FAILURES_PER_IP + 1);
  });

  it("stale login attempts are purged by failed attempts alone, a bounded batch at a time", async () => {
    const stale = Array.from({ length: CLEANUP_BATCH * 2 }, () => ({ ipKey: "ip:old", success: false, createdAt: ago(2 * LOGIN_WINDOW_MS) }));
    await prisma.loginAttempt.createMany({ data: stale });
    await beginLoginAttempt("ip:4.4.4.4", fresh()); // one failed attempt, no successful login anywhere
    expect(await attempts()).toBe(CLEANUP_BATCH + 2); // exactly one batch removed (plus the two new rows)
    await beginLoginAttempt("ip:4.4.4.4", fresh());
    expect(await attempts()).toBe(4); // backlog gone: only the fresh rows remain
  });

  it("expired refresh tokens are purged by a failed login attempt; live ones are kept", async () => {
    const ownerId = await createOwner();
    for (let i = 0; i < 4; i++) await issueSession(ownerId);
    const all = await prisma.refreshToken.findMany({ orderBy: { createdAt: "asc" } });
    // Expire all but the first.
    await prisma.refreshToken.updateMany({ where: { id: { in: all.slice(1).map((s) => s.id) } }, data: { expiresAt: ago(1000) } });
    const res = await login(loginReq("wrong password", "198.51.100.50"));
    expect(res.status).toBe(401);
    const left = await prisma.refreshToken.findMany();
    expect(left.map((s) => s.id)).toEqual([all[0].id]);
  });

  it("purgeStaleAuthRows reports what it removed and never exceeds the batch size", async () => {
    await prisma.loginAttempt.createMany({ data: Array.from({ length: CLEANUP_BATCH + 10 }, () => ({ ipKey: "ip:x", success: true, createdAt: ago(3 * LOGIN_WINDOW_MS) })) });
    expect(await purgeStaleAuthRows()).toEqual({ attempts: CLEANUP_BATCH, sessions: 0 });
    expect(await purgeStaleAuthRows()).toEqual({ attempts: 10, sessions: 0 });
  });

  it("lockout still holds for the right password, and a normal login still works afterwards", async () => {
    await createOwner();
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) expect((await login(loginReq("nope nope nope", "198.51.100.60", fresh()))).status).toBe(401);
    expect((await login(loginReq(PASSWORD, "198.51.100.60"))).status).toBe(429);
    await prisma.loginAttempt.updateMany({ data: { createdAt: ago(LOGIN_WINDOW_MS + 1000) } });
    expect((await login(loginReq(PASSWORD, "198.51.100.60"))).status).toBe(200);
  });

  it("a successful sign-in does not reset the client's budget for guessing other accounts", async () => {
    await createOwner();
    for (let i = 0; i < MAX_FAILURES_PER_IP - 1; i++) await login(loginReq("nope nope nope", "198.51.100.61", fresh()));
    expect((await login(loginReq(PASSWORD, "198.51.100.61"))).status).toBe(200);
    expect(await attemptsFor("ip:198.51.100.61")).toBe(MAX_FAILURES_PER_IP - 1);
  });
});

describe("audit #24: invalid or expired tokens are never refreshed by the proxy", () => {
  it("the proxy never sets a cookie, whatever the cookies contain", async () => {
    const forged = await proxy(request("/history", { cookie: "ft_access=forged-token" }));
    expect(forged.headers.get("set-cookie")).toBeNull();
    expect(forged.status).toBe(307);
    expect(forged.headers.get("location")).toContain("/login?next=%2Fhistory");

    const none = await proxy(request("/history"));
    expect(none.status).toBe(307);
    expect(none.headers.get("location")).toContain("/login?next=%2Fhistory");
  });

  it("a valid access token passes; an expired one with a refresh cookie goes through /api/auth/refresh", async () => {
    const ownerId = await createOwner();
    const { accessToken, refreshToken } = await issueSession(ownerId);
    const ok = await proxy(request("/history", { cookie: `ft_access=${accessToken}` }));
    expect(ok.status).toBe(200);

    const expired = await proxy(request("/history?x=1", { cookie: `ft_access=expired; ft_refresh=${refreshToken}` }));
    expect(expired.status).toBe(307);
    expect(expired.headers.get("location")).toContain("/api/auth/refresh?next=%2Fhistory%3Fx%3D1");
    expect(expired.headers.get("set-cookie")).toBeNull();
  });

  it("the sign-in and sign-up pages are reachable without a session", async () => {
    for (const path of ["/login", "/register"]) expect((await proxy(request(path))).status).toBe(200);
  });

  it("API routes are not matched by the proxy (no body buffering or truncation)", () => {
    const matcher = proxyConfig.matcher[0];
    expect(matcher).toContain("(?!api/");
  });

  it("the keep-alive endpoint answers only for a live sign-in and never renews forged or expired ones", async () => {
    const ownerId = await createOwner();
    const { accessToken, refreshToken } = await issueSession(ownerId);
    const ok = await session(request("/api/auth/session", { cookie: `ft_access=${accessToken}` }), ctx);
    expect(ok.status).toBe(200);

    // Forged, unknown and expired refresh tokens: 401 and no cookie is ever set with a value.
    await prisma.refreshToken.updateMany({ data: { expiresAt: ago(1000) } });
    for (const t of ["forged", refreshToken!]) {
      const res = await session(request("/api/auth/session", { cookie: `ft_refresh=${t}` }), ctx);
      expect(res.status).toBe(401);
      expect(res.headers.getSetCookie().every((c) => /^[^=]+=;/.test(c))).toBe(true);
    }
    expect((await session(request("/api/auth/session"), ctx)).headers.getSetCookie()).toHaveLength(0);
  });
});
