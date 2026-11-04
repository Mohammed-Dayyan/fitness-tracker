import { describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as session } from "@/app/api/auth/session/route";
import { prisma } from "@/lib/server/db";
import { hashPassword, verifyPassword } from "@/lib/server/auth/password";
import { MAX_FAILURES_PER_EMAIL, MAX_FAILURES_PER_IP } from "@/lib/server/auth/rate-limit";
import { hashToken } from "@/lib/server/auth/session";
import { setOwnerPassword } from "@/lib/server/owner";
import { cookieFrom, cookieValue, createOwner, ctx, EMAIL, flushBackground, loginBody, PASSWORD, request } from "./helpers/factory";
import { sentMail } from "./helpers/mail";

const loginReq = (password: string, ip = "203.0.113.1", email = EMAIL) =>
  request("/api/auth/login", { body: loginBody(password, email), headers: { "x-forwarded-for": ip } });

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
    const owner = await prisma.owner.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(owner.passwordHash).toMatch(/^\$argon2id\$/);
  });
});

describe("login", () => {
  it("sets HttpOnly SameSite=Lax access and refresh cookies and stores only the refresh token hash", async () => {
    await createOwner();
    const res = await login(loginReq(PASSWORD));
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const c of cookies) {
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/SameSite=lax/i);
      expect(c).toMatch(/Path=\//);
      expect(c).toMatch(/Expires=/);
    }

    const access = cookieValue(res, "ft_access")!;
    expect(access.split(".")).toHaveLength(3); // a JWT
    const refresh = cookieValue(res, "ft_refresh")!;
    expect(refresh.length).toBeGreaterThanOrEqual(43); // 32 random bytes, base64url
    const rows = await prisma.refreshToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(refresh));
    expect(JSON.stringify(rows)).not.toContain(refresh);
  });

  it("returns the same generic error for a wrong password and for an unknown email", async () => {
    await createOwner();
    const unknown = await login(loginReq("anything at all", "203.0.113.1", "nobody@example.test"));
    const wrong = await login(loginReq("not the password"));
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it("is case-insensitive about the email address", async () => {
    await createOwner();
    expect((await login(loginReq(PASSWORD, "203.0.113.1", "  Primary@Example.TEST "))).status).toBe(200);
  });

  it("rate-limits repeated failures per client, even for the right password", async () => {
    await createOwner();
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) {
      // A different address each time, so only the per-client limit is in play.
      expect((await login(loginReq("wrong password", "198.51.100.7", `u${i}@example.test`))).status).toBe(401);
    }
    expect((await login(loginReq(PASSWORD, "198.51.100.7"))).status).toBe(429);
    // A different client is unaffected.
    expect((await login(loginReq(PASSWORD, "198.51.100.8"))).status).toBe(200);
  });

  it("rate-limits repeated failures per account, from any client", async () => {
    await createOwner();
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) {
      expect((await login(loginReq("wrong password", `198.51.100.${i + 1}`))).status).toBe(401);
    }
    expect((await login(loginReq(PASSWORD, "198.51.100.99"))).status).toBe(429);
    // Other accounts are unaffected by the lockout.
    await createOwner("other");
    expect((await login(loginReq(PASSWORD, "198.51.100.99", "other@example.test"))).status).toBe(200);
  });

  it("forged X-Forwarded-For prefixes cannot dodge the per-client limit", async () => {
    await createOwner();
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) {
      expect((await login(loginReq("wrong password", `10.0.0.${i}, 198.51.100.20`, `u${i}@example.test`))).status).toBe(401);
    }
    expect((await login(loginReq(PASSWORD, "10.9.9.9, 198.51.100.20"))).status).toBe(429);
  });

  it("parallel guesses cannot all slip under the limit", async () => {
    await createOwner();
    const results = await Promise.all(Array.from({ length: 12 }, () => login(loginReq("wrong password", "198.51.100.9"))));
    expect(results.filter((r) => r.status === 401).length).toBeLessThanOrEqual(MAX_FAILURES_PER_EMAIL);
  });

  it("rejects cross-origin login attempts (login CSRF)", async () => {
    await createOwner();
    const res = await login(request("/api/auth/login", { body: loginBody(), origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("refuses an unverified account, but only to someone who knows the password", async () => {
    await createOwner();
    await prisma.owner.updateMany({ data: { emailVerifiedAt: null } });
    const wrong = await login(loginReq("not the password"));
    expect(wrong.status).toBe(401);
    const right = await login(loginReq(PASSWORD));
    expect(right.status).toBe(403);
    expect((await right.json()).code).toBe("email_not_verified");
    expect(right.headers.getSetCookie()).toHaveLength(0);
    expect(await prisma.refreshToken.count()).toBe(0);
    await flushBackground();
    expect(sentMail).toEqual([{ kind: "otp", to: EMAIL, code: expect.stringMatching(/^\d{6}$/) }]); // the wrong password sent nothing
  });
});

describe("sessions", () => {
  it("accepts the access token cookie and does not touch the database for it", async () => {
    await createOwner();
    const cookie = cookieFrom(await login(loginReq(PASSWORD)));
    const before = await prisma.refreshToken.count();
    const res = await session(request("/api/auth/session", { cookie }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toHaveLength(0); // nothing to renew yet
    expect(await prisma.refreshToken.count()).toBe(before);
  });

  it("logout deletes the token family on the server", async () => {
    await createOwner();
    const cookie = cookieFrom(await login(loginReq(PASSWORD)));
    const out = await logout(request("/api/auth/logout", { method: "POST", cookie }));
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().every((c) => /Max-Age=0/.test(c))).toBe(true);
    expect(await prisma.refreshToken.count()).toBe(0);
    // Replaying the refresh token alone no longer works.
    const refreshOnly = cookie.split("; ").find((c) => c.startsWith("ft_refresh="))!;
    expect((await session(request("/api/auth/session", { cookie: refreshOnly }), ctx)).status).toBe(401);
  });

  it("changing the password revokes every refresh token", async () => {
    await createOwner();
    const c1 = cookieFrom(await login(loginReq(PASSWORD)));
    const c2 = cookieFrom(await login(loginReq(PASSWORD, "203.0.113.2")));
    const { revokedSessions } = await setOwnerPassword(EMAIL, "a brand new long password");
    expect(revokedSessions).toBe(2);
    for (const cookie of [c1, c2]) {
      const refreshOnly = cookie.split("; ").find((c) => c.startsWith("ft_refresh="))!;
      expect((await session(request("/api/auth/session", { cookie: refreshOnly }), ctx)).status).toBe(401);
    }
    expect((await login(loginReq(PASSWORD))).status).toBe(401);
    expect((await login(loginReq("a brand new long password"))).status).toBe(200);
  });
});
