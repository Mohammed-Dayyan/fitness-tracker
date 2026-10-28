import { describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as session } from "@/app/api/auth/session/route";
import { prisma } from "@/lib/server/db";
import { hashPassword, verifyPassword } from "@/lib/server/auth/password";
import { MAX_FAILURES_PER_IP } from "@/lib/server/auth/rate-limit";
import { createSession, hashToken, validateSessionToken } from "@/lib/server/auth/session";
import { setOwnerPassword } from "@/lib/server/owner";
import { cookieFrom, createOwner, ctx, PASSWORD, request } from "./helpers/factory";

const loginReq = (password: string, ip = "203.0.113.1") =>
  request("/api/auth/login", { body: { password }, headers: { "x-forwarded-for": ip } });

describe("password hashing", () => {
  it("stores Argon2id hashes, never plaintext", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, "wrong password!!")).toBe(false);
    expect(await verifyPassword(null, PASSWORD)).toBe(false);
  });

  it("set-password stores only a hash", async () => {
    await createOwner();
    const owner = await prisma.owner.findUniqueOrThrow({ where: { slug: "primary" } });
    expect(owner.passwordHash).toMatch(/^\$argon2id\$/);
  });
});

describe("login", () => {
  it("sets an HttpOnly, SameSite=Lax session cookie and stores only the token hash", async () => {
    await createOwner();
    const res = await login(loginReq(PASSWORD));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^ft_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Expires=/);

    const token = cookieFrom(res).split("=")[1];
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 random bytes, base64url
    const rows = await prisma.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("returns the same generic error for a wrong password and for no configured owner", async () => {
    const noOwner = await login(loginReq("anything at all"));
    await createOwner();
    const wrong = await login(loginReq("not the password"));
    expect(noOwner.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await noOwner.json()).toEqual(await wrong.json());
  });

  it("rate-limits repeated failures per client, even for the right password", async () => {
    await createOwner();
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) {
      expect((await login(loginReq("wrong password", "198.51.100.7"))).status).toBe(401);
    }
    expect((await login(loginReq(PASSWORD, "198.51.100.7"))).status).toBe(429);
    // A different client is unaffected.
    expect((await login(loginReq(PASSWORD, "198.51.100.8"))).status).toBe(200);
  });

  it("forged X-Forwarded-For prefixes cannot dodge the per-client limit", async () => {
    await createOwner();
    // Each attempt claims a different client IP, but the proxy-appended last entry is the same.
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) {
      expect((await login(loginReq("wrong password", `10.0.0.${i}, 198.51.100.20`))).status).toBe(401);
    }
    expect((await login(loginReq(PASSWORD, "10.9.9.9, 198.51.100.20"))).status).toBe(429);
  });

  it("parallel guesses cannot all slip under the limit", async () => {
    await createOwner();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => login(loginReq("wrong password", "198.51.100.9"))),
    );
    const allowed = results.filter((r) => r.status === 401).length;
    expect(allowed).toBeLessThanOrEqual(MAX_FAILURES_PER_IP);
  });

  it("rejects cross-origin login attempts (login CSRF)", async () => {
    await createOwner();
    const res = await login(
      request("/api/auth/login", { body: { password: PASSWORD }, origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("sessions", () => {
  it("validates on each request and renews (sliding) after an hour of use", async () => {
    const ownerId = await createOwner();
    const { token } = await createSession(ownerId);
    const old = new Date(Date.now() - 2 * 3600_000);
    await prisma.session.updateMany({ data: { lastSeenAt: old, expiresAt: new Date(Date.now() + 86_400_000) } });

    const res = await session(request("/api/auth/session", { cookie: `ft_session=${token}` }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^ft_session=/);
    const row = await prisma.session.findFirstOrThrow();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it("rejects expired sessions and deletes them", async () => {
    const ownerId = await createOwner();
    const { token } = await createSession(ownerId);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(token)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it("rejects unknown and malformed tokens", async () => {
    expect(await validateSessionToken("nope")).toBeNull();
    expect(await validateSessionToken("x".repeat(500))).toBeNull();
    expect(await validateSessionToken(undefined)).toBeNull();
  });

  it("logout deletes the session on the server", async () => {
    await createOwner();
    const cookie = cookieFrom(await login(loginReq(PASSWORD)));
    const out = await logout(request("/api/auth/logout", { method: "POST", cookie }));
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(await prisma.session.count()).toBe(0);
    // Replaying the old cookie no longer works.
    expect((await session(request("/api/auth/session", { cookie }), ctx)).status).toBe(401);
  });

  it("changing the password invalidates every session", async () => {
    await createOwner();
    const c1 = cookieFrom(await login(loginReq(PASSWORD)));
    const c2 = cookieFrom(await login(loginReq(PASSWORD, "203.0.113.2")));
    const { revokedSessions } = await setOwnerPassword("a brand new long password");
    expect(revokedSessions).toBe(2);
    for (const cookie of [c1, c2]) {
      expect((await session(request("/api/auth/session", { cookie }), ctx)).status).toBe(401);
    }
    expect((await login(loginReq(PASSWORD))).status).toBe(401);
    expect((await login(loginReq("a brand new long password"))).status).toBe(200);
  });
});
