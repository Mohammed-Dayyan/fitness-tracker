import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as resend } from "@/app/api/auth/resend-verification/route";
import { POST as verify } from "@/app/api/auth/verify-email/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as refreshRoute } from "@/app/api/auth/refresh/route";
import { GET as session } from "@/app/api/auth/session/route";
import { GET as exportRoute } from "@/app/api/export/route";
import { GET as contextRoute } from "@/app/api/export/context/route";
import { prisma } from "@/lib/server/db";
import { signAccessToken, verifyAccessToken } from "@/lib/server/auth/jwt";
import { hashOtp, OTP_MAX_ATTEMPTS } from "@/lib/server/auth/otp";
import { beginAttempt, CODE_COOLDOWN_MS, LOGIN_WINDOW_MS } from "@/lib/server/auth/rate-limit";
import { ROTATION_GRACE_MS, UNCONFIRMED_ACCOUNT_TTL_MS, issueSession, rotateRefreshToken } from "@/lib/server/auth/session";
import { cookieFrom, cookieValue, createBareOwner, createOwner, ctx, flushBackground, PASSWORD, request } from "./helpers/factory";
import { lastCode, mailControl, sentMail } from "./helpers/mail";

let n = 0;
/** Each call comes from its own client IP, so only per-address limits are in play. */
const ip = () => ({ "x-forwarded-for": `203.0.113.${(n++ % 250) + 1}` });
const post = (path: string, body: unknown) => request(path, { body, headers: ip() });
const signUp = async (email: string, password = PASSWORD) => {
  const res = await register(post("/api/auth/register", { email, password }));
  await flushBackground();
  return res;
};
const confirm = async (email: string, code: string) => {
  const res = await verify(post("/api/auth/verify-email", { email, code }));
  await flushBackground();
  return res;
};
const signIn = (email: string, password = PASSWORD) => login(post("/api/auth/login", { email, password }));
/** Skips the 60-second gap (and the 15-minute count) between codes for an address. */
const resetCodeLimits = () => prisma.loginAttempt.deleteMany({ where: { ipKey: { startsWith: "code-" } } });

describe("sign-up and email confirmation by code", () => {
  it("creates an unconfirmed account and emails a 6-digit code, stored only as a keyed hash", async () => {
    const res = await signUp("New.User@Example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, retryAfter: 60, expiresIn: 600 });
    const owner = await prisma.owner.findUniqueOrThrow({ where: { email: "new.user@example.com" } });
    expect(owner.emailVerifiedAt).toBeNull();
    expect(owner.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await prisma.profile.count({ where: { ownerId: owner.id } })).toBe(1);

    expect(sentMail).toHaveLength(1);
    const code = lastCode("new.user@example.com");
    expect(code).toMatch(/^\d{6}$/);
    const stored = await prisma.emailOtp.findFirstOrThrow();
    expect(stored.codeHash).toBe(hashOtp(owner.id, code));
    expect(stored.codeHash).not.toContain(code);
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  });

  it("the reply does not wait for the email", async () => {
    mailControl.delayMs = 400;
    const started = Date.now();
    const res = await register(post("/api/auth/register", { email: "slow@example.com", password: PASSWORD }));
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(400);
    expect(sentMail).toHaveLength(0); // still being sent
    await flushBackground();
    expect(sentMail).toHaveLength(1);
  });

  it("the right code confirms the address, signs the person in, and works once", async () => {
    await signUp("a@example.com");
    const code = lastCode("a@example.com");
    expect((await signIn("a@example.com")).status).toBe(403); // not confirmed yet
    const res = await confirm("a@example.com", code);
    expect(res.status).toBe(200);
    expect(cookieValue(res, "ft_access")).toBeTruthy();
    expect(cookieValue(res, "ft_refresh")).toBeTruthy();
    expect((await prisma.owner.findUniqueOrThrow({ where: { email: "a@example.com" } })).emailVerifiedAt).not.toBeNull();
    expect(await prisma.emailOtp.count()).toBe(0);
    expect((await confirm("a@example.com", code)).status).toBe(400); // single use
    expect((await signIn("a@example.com")).status).toBe(200);
    // The cookies from confirming are a working sign-in.
    expect((await session(request("/api/auth/session", { cookie: cookieFrom(res) }), ctx)).status).toBe(200);
  });

  it("a wrong code is refused with the same answer as every other failure", async () => {
    await signUp("b@example.com");
    const right = lastCode("b@example.com");
    const wrong = right === "000000" ? "111111" : "000000";
    const bodies = [
      await (await confirm("b@example.com", wrong)).json(),
      await (await confirm("nobody@example.com", "123456")).json(),
      await (await verify(post("/api/auth/verify-email", { email: "b@example.com", code: "12ab" }))).json(),
    ];
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect((await confirm("b@example.com", right)).status).toBe(200);
  });

  it(`burns the code after ${OTP_MAX_ATTEMPTS} wrong guesses, even for the right code afterwards`, async () => {
    await signUp("c@example.com");
    const right = lastCode("c@example.com");
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) expect((await confirm("c@example.com", wrong)).status).toBe(400);
    expect((await confirm("c@example.com", right)).status).toBe(400);
    expect((await prisma.owner.findUniqueOrThrow({ where: { email: "c@example.com" } })).emailVerifiedAt).toBeNull();
  });

  it("parallel guesses cannot exceed the attempt limit", async () => {
    await signUp("d@example.com");
    const right = lastCode("d@example.com");
    // Fifteen different wrong codes, all at once, then the right one.
    const wrongs = Array.from({ length: 15 }, (_, i) => String(100000 + i)).filter((c) => c !== right);
    await Promise.all(wrongs.map((code) => confirm("d@example.com", code)));
    // Skip the submission limit to prove the code itself is burned, not just throttled.
    await prisma.loginAttempt.deleteMany({ where: { ipKey: { startsWith: "check" } } });
    expect((await confirm("d@example.com", right)).status).toBe(400);
  });

  it("an expired code is refused", async () => {
    await signUp("e@example.com");
    const code = lastCode("e@example.com");
    await prisma.emailOtp.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await confirm("e@example.com", code)).status).toBe(400);
  });

  it("a code only works for the address it was sent to", async () => {
    await signUp("f@example.com");
    await signUp("g@example.com");
    expect((await confirm("g@example.com", lastCode("f@example.com"))).status).toBe(400);
    expect((await confirm("f@example.com", lastCode("f@example.com"))).status).toBe(200);
  });

  it("limits code submissions per address and says how long to wait", async () => {
    await signUp("h@example.com");
    const results: Response[] = [];
    for (let i = 0; i < 12; i++) results.push(await confirm("h@example.com", "000001"));
    const limited = results.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    const body = await limited[0].json();
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.retryAfter).toBeLessThanOrEqual(LOGIN_WINDOW_MS / 1000);
    expect(limited[0].headers.get("retry-after")).toBe(String(body.retryAfter));
  });

  it("logging in before confirming sends a fresh code and says so", async () => {
    await signUp("i@example.com");
    const first = lastCode("i@example.com");
    await resetCodeLimits();
    const wrong = await signIn("i@example.com", "not the password");
    expect(wrong.status).toBe(401);
    const right = await signIn("i@example.com");
    await flushBackground();
    expect(right.status).toBe(403);
    const body = await right.json();
    expect(body).toMatchObject({ code: "email_not_verified", retryAfter: 60 });
    expect(right.headers.getSetCookie()).toHaveLength(0);
    const second = lastCode("i@example.com");
    expect(sentMail.filter((m) => m.kind === "otp")).toHaveLength(2); // sign-up + login; the wrong password sent nothing
    if (second !== first) expect((await confirm("i@example.com", first)).status).toBe(400); // replaced
    expect((await confirm("i@example.com", second)).status).toBe(200);
  });

  it("signing up again before confirming replaces the password (pre-registration cannot keep one)", async () => {
    await signUp("victim@example.com", "attacker chosen password");
    await resetCodeLimits();
    await signUp("victim@example.com", "the victims own password");
    expect(sentMail.filter((m) => m.kind === "otp")).toHaveLength(2);
    expect((await confirm("victim@example.com", lastCode("victim@example.com"))).status).toBe(200);
    expect((await signIn("victim@example.com", "attacker chosen password")).status).toBe(401);
    expect((await signIn("victim@example.com", "the victims own password")).status).toBe(200);
  });

  it("signing up with a confirmed address changes nothing and emails the owner instead", async () => {
    await createOwner("taken");
    const fresh = await signUp("fresh@example.com");
    const taken = await signUp("taken@example.test", "some other password");
    expect(taken.status).toBe(200);
    const shape = async (r: Response) => {
      const { message, ...rest } = await r.json();
      expect(message).toContain("6-digit code");
      return rest;
    };
    expect(await shape(taken)).toEqual(await shape(fresh));
    expect(sentMail.filter((m) => m.to === "taken@example.test")).toEqual([{ kind: "exists", to: "taken@example.test" }]);
    expect(await prisma.emailOtp.count()).toBe(1); // only fresh@
    expect((await signIn("taken@example.test", PASSWORD)).status).toBe(200); // old password still works
    expect((await signIn("taken@example.test", "some other password")).status).toBe(401);
  });

  it("enforces the 60-second gap and the 3-per-15-minutes cap, with the time left", async () => {
    expect((await signUp("spam@example.com")).status).toBe(200);
    const soon = await signUp("spam@example.com");
    expect(soon.status).toBe(429);
    const wait = (await soon.json()).retryAfter;
    expect(wait).toBeGreaterThan(50);
    expect(wait).toBeLessThanOrEqual(CODE_COOLDOWN_MS / 1000);
    expect(sentMail).toHaveLength(1);

    // Two more allowed (skipping the gap), then the 15-minute cap bites.
    for (let i = 0; i < 2; i++) {
      await prisma.loginAttempt.deleteMany({ where: { ipKey: { startsWith: "code-gap:" } } });
      expect((await signUp("spam@example.com")).status).toBe(200);
    }
    await prisma.loginAttempt.deleteMany({ where: { ipKey: { startsWith: "code-gap:" } } });
    const capped = await signUp("spam@example.com");
    expect(capped.status).toBe(429);
    const longWait = (await capped.json()).retryAfter;
    expect(longWait).toBeGreaterThan(60);
    expect(longWait).toBeLessThanOrEqual(LOGIN_WINDOW_MS / 1000);
    expect(sentMail.filter((m) => m.kind === "otp")).toHaveLength(3);
  });

  it("the wait ends exactly when the oldest counted attempt leaves the window", async () => {
    const buckets = [{ key: "test:bucket", max: 1, windowMs: 60_000 }];
    expect((await beginAttempt(buckets)).limited).toBe(false);
    await prisma.loginAttempt.updateMany({ where: { ipKey: "test:bucket" }, data: { createdAt: new Date(Date.now() - 45_000) } });
    const refused = await beginAttempt(buckets);
    expect(refused.limited).toBe(true);
    expect(refused.retryAfter).toBeGreaterThanOrEqual(14);
    expect(refused.retryAfter).toBeLessThanOrEqual(16);
    await prisma.loginAttempt.updateMany({ where: { ipKey: "test:bucket" }, data: { createdAt: new Date(Date.now() - 61_000) } });
    expect((await beginAttempt(buckets)).limited).toBe(false);
  });

  it("enforces the password rules on the server", async () => {
    for (const password of ["short", "1234567", "", "x".repeat(129)]) {
      const res = await register(post("/api/auth/register", { email: "rules@example.com", password }));
      expect(res.status, password).toBe(400);
    }
    expect((await register(post("/api/auth/register", { email: "bad-email", password: PASSWORD }))).status).toBe(400);
    expect(await prisma.owner.count()).toBe(0);
    // Only the length matters: 8 is fine, and so is a simple password.
    expect((await signUp("rules@example.com", "aaaaaaaa")).status).toBe(200);
    expect((await signUp("rules2@example.com", "x".repeat(128))).status).toBe(200);
  });

  it("resend answers the same for unknown, confirmed and unconfirmed addresses, and replaces the code", async () => {
    await signUp("j@example.com");
    const before = lastCode("j@example.com");
    await createOwner("verified");
    await resetCodeLimits();
    const ask = async (email: string) => {
      const res = await resend(post("/api/auth/resend-verification", { email }));
      await flushBackground();
      const { message, ...rest } = await res.json();
      return { status: res.status, rest, message };
    };
    const [a, b, c] = [await ask("j@example.com"), await ask("verified@example.test"), await ask("ghost@example.com")];
    expect(a.status).toBe(200);
    expect(b).toMatchObject({ status: 200, rest: a.rest });
    expect(c).toMatchObject({ status: 200, rest: a.rest });
    expect(sentMail.filter((m) => m.to === "verified@example.test" || m.to === "ghost@example.com")).toEqual([]);
    const after = lastCode("j@example.com");
    expect(sentMail.filter((m) => m.to === "j@example.com")).toHaveLength(2);
    if (after !== before) expect((await confirm("j@example.com", before)).status).toBe(400);
    expect((await confirm("j@example.com", after)).status).toBe(200);
  });

  it("removes accounts that stay unconfirmed for a day, and nothing else", async () => {
    await signUp("old@example.com");
    await signUp("new@example.com");
    await createOwner("kept");
    const day = UNCONFIRMED_ACCOUNT_TTL_MS;
    await prisma.owner.updateMany({ where: { email: { in: ["old@example.com", "kept@example.test"] } }, data: { createdAt: new Date(Date.now() - day - 1000) } });
    await beginAttempt([{ key: "test:purge", max: 5 }]); // any auth attempt triggers the cleanup
    const emails = (await prisma.owner.findMany({ select: { email: true }, orderBy: { email: "asc" } })).map((o) => o.email);
    expect(emails).toEqual(["kept@example.test", "new@example.com"]);
    expect(await prisma.profile.count()).toBe(2); // the removed account's profile and code went with it
    expect(await prisma.emailOtp.count()).toBe(1);
  });
});

describe("access token (JWT)", () => {
  it("verifies its own tokens and carries the owner id", async () => {
    const { token } = await signAccessToken("owner-1");
    expect((await verifyAccessToken(token))?.ownerId).toBe("owner-1");
  });

  it("rejects tampered, expired, unsigned and wrongly-signed tokens", async () => {
    const { token } = await signAccessToken("owner-1");
    const [h, p, s] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: "owner-2" })).toString("base64url");
    expect(await verifyAccessToken(`${h}.${forgedPayload}.${s}`)).toBeNull();

    const expired = await signAccessToken("owner-1", Date.now() - 16 * 60_000);
    expect(await verifyAccessToken(expired.token)).toBeNull();

    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${p}.`;
    expect(await verifyAccessToken(none)).toBeNull();

    const other = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("owner-1").setIssuer("fitness-tracker")
      .setAudience("fitness-tracker:access").setExpirationTime("15m").sign(new TextEncoder().encode("a-different-secret-a-different-secret!!"));
    expect(await verifyAccessToken(other)).toBeNull();
    expect(await verifyAccessToken("garbage")).toBeNull();
    expect(await verifyAccessToken(undefined)).toBeNull();
  });
});

describe("refresh token rotation", () => {
  it("exchanges a refresh token for a new pair and marks the old one rotated", async () => {
    const ownerId = await createOwner();
    const first = await issueSession(ownerId);
    const next = await rotateRefreshToken(first.refreshToken);
    expect(next?.ownerId).toBe(ownerId);
    expect(next?.refreshToken).toBeTruthy();
    expect(next?.refreshToken).not.toBe(first.refreshToken);
    const rows = await prisma.refreshToken.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].rotatedAt).not.toBeNull();
    expect(rows[1].rotatedAt).toBeNull();
    expect(rows[0].familyId).toBe(rows[1].familyId);
  });

  it("a parallel request inside the grace window gets only a new access token", async () => {
    const ownerId = await createOwner();
    const first = await issueSession(ownerId);
    await rotateRefreshToken(first.refreshToken);
    const again = await rotateRefreshToken(first.refreshToken);
    expect(again?.ownerId).toBe(ownerId);
    expect(again?.refreshToken).toBeUndefined();
    expect(await prisma.refreshToken.count()).toBe(2); // no extra token minted
  });

  it("reusing a rotated token after the grace window deletes the whole family (theft)", async () => {
    const ownerId = await createOwner();
    const first = await issueSession(ownerId);
    const second = await rotateRefreshToken(first.refreshToken);
    await prisma.refreshToken.updateMany({ where: { rotatedAt: { not: null } }, data: { rotatedAt: new Date(Date.now() - ROTATION_GRACE_MS - 1000) } });
    expect(await rotateRefreshToken(first.refreshToken)).toBeNull();
    expect(await prisma.refreshToken.count()).toBe(0);
    // The legitimate holder's newest token died with the family.
    expect(await rotateRefreshToken(second!.refreshToken)).toBeNull();
  });

  it("other sign-ins of the same owner survive the theft of one family", async () => {
    const ownerId = await createOwner();
    const laptop = await issueSession(ownerId);
    const phone = await issueSession(ownerId);
    await rotateRefreshToken(laptop.refreshToken);
    await prisma.refreshToken.updateMany({ where: { rotatedAt: { not: null } }, data: { rotatedAt: new Date(Date.now() - ROTATION_GRACE_MS - 1000) } });
    expect(await rotateRefreshToken(laptop.refreshToken)).toBeNull();
    expect(await rotateRefreshToken(phone.refreshToken)).not.toBeNull();
  });

  it("concurrent rotations of one token mint exactly one successor", async () => {
    const ownerId = await createOwner();
    const first = await issueSession(ownerId);
    const results = await Promise.all(Array.from({ length: 5 }, () => rotateRefreshToken(first.refreshToken)));
    expect(results.every((r) => r !== null)).toBe(true);
    expect(results.filter((r) => r?.refreshToken).length).toBe(1);
    expect(await prisma.refreshToken.count()).toBe(2);
  });

  it("expired and unverified-owner tokens are refused", async () => {
    const ownerId = await createOwner();
    const t = await issueSession(ownerId);
    await prisma.owner.update({ where: { id: ownerId }, data: { emailVerifiedAt: null } });
    expect(await rotateRefreshToken(t.refreshToken)).toBeNull();
    await prisma.owner.update({ where: { id: ownerId }, data: { emailVerifiedAt: new Date() } });
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await rotateRefreshToken(t.refreshToken)).toBeNull();
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it("an API call with an expired access token and a good refresh cookie succeeds and sets new cookies", async () => {
    const ownerId = await createOwner();
    const { refreshToken } = await issueSession(ownerId);
    const expired = (await signAccessToken(ownerId, Date.now() - 20 * 60_000)).token;
    const res = await session(request("/api/auth/session", { cookie: `ft_access=${expired}; ft_refresh=${refreshToken}` }), ctx);
    expect(res.status).toBe(200);
    expect(cookieValue(res, "ft_access")).toBeTruthy();
    expect(cookieValue(res, "ft_refresh")).not.toBe(refreshToken);
    // And the new access cookie really works on its own.
    const next = await exportRoute(request("/api/export?scope=all", { cookie: `ft_access=${cookieValue(res, "ft_access")}` }), ctx);
    expect(next.status).toBe(200);
  });

  it("rotated cookies reach the browser even when the handler returns a plain Response", async () => {
    const ownerId = await createOwner();
    const { refreshToken } = await issueSession(ownerId);
    const expired = (await signAccessToken(ownerId, Date.now() - 20 * 60_000)).token;
    // /api/export/context returns `new Response(...)`, not a NextResponse.
    const res = await contextRoute(request("/api/export/context", { cookie: `ft_access=${expired}; ft_refresh=${refreshToken}` }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect((await res.text()).length).toBeGreaterThan(0);
    const newRefresh = cookieValue(res, "ft_refresh");
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(refreshToken);
    expect(cookieValue(res, "ft_access")).toBeTruthy();
    // And the family survives: the cookie the browser now holds still rotates.
    expect(await rotateRefreshToken(newRefresh)).not.toBeNull();
  });

  it("GET /api/auth/refresh rotates and redirects only to same-site paths", async () => {
    const ownerId = await createOwner();
    const { refreshToken } = await issueSession(ownerId);
    const ok = await refreshRoute(request("/api/auth/refresh?next=%2Fhistory", { cookie: `ft_refresh=${refreshToken}` }));
    expect(ok.status).toBe(307);
    expect(new URL(ok.headers.get("location")!).pathname).toBe("/history");
    expect(cookieValue(ok, "ft_access")).toBeTruthy();

    const evil = await refreshRoute(request("/api/auth/refresh?next=%2F%2Fevil.example", { cookie: cookieFrom(ok) }));
    expect(new URL(evil.headers.get("location")!).host).toBe("localhost:3000");

    const bad = await refreshRoute(request("/api/auth/refresh?next=%2Fhistory", { cookie: "ft_refresh=forged" }));
    expect(new URL(bad.headers.get("location")!).pathname).toBe("/login");
    expect(cookieValue(bad, "ft_access")).toBeUndefined();
  });
});

describe("accounts are isolated", () => {
  it("each account's token only ever reaches its own data", async () => {
    const a = await createBareOwner("a");
    const b = await createBareOwner("b");
    await prisma.foodEntry.create({ data: { ownerId: a, id: "fa", date: new Date("2026-10-27"), name: "A food" } });
    await prisma.foodEntry.create({ data: { ownerId: b, id: "fb", date: new Date("2026-10-27"), name: "B food" } });
    const asA = await exportRoute(request("/api/export?scope=all", { cookie: `ft_access=${(await signAccessToken(a)).token}` }), ctx);
    const asB = await exportRoute(request("/api/export?scope=all", { cookie: `ft_access=${(await signAccessToken(b)).token}` }), ctx);
    expect((await asA.json()).food_entries.map((f: { name: string }) => f.name)).toEqual(["A food"]);
    expect((await asB.json()).food_entries.map((f: { name: string }) => f.name)).toEqual(["B food"]);
  });

  it("two accounts can sign in at the same time", async () => {
    await createOwner("one");
    await createOwner("two");
    for (const slug of ["one", "two"]) {
      const res = await login(request("/api/auth/login", { body: { email: `${slug}@example.test`, password: PASSWORD }, headers: ip() }));
      expect(res.status).toBe(200);
    }
    expect(await prisma.refreshToken.count()).toBe(2);
  });
});
