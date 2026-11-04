import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as resend } from "@/app/api/auth/resend-verification/route";
import { POST as verify } from "@/app/api/auth/verify-email/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as refreshRoute } from "@/app/api/auth/refresh/route";
import { onRequestError, register as registerInstrumentation } from "@/instrumentation";
import { ROTATION_GRACE_MS, issueSession, rotateRefreshToken } from "@/lib/server/auth/session";
import { beginAttempt, LOGIN_WINDOW_MS } from "@/lib/server/auth/rate-limit";
import { inBackground } from "@/lib/server/http";
import { errorFields, log, maskEmail, requestLogger, setLogSink } from "@/lib/server/log";
import { prisma } from "@/lib/server/db";
import { cookieFrom, cookieValue, createOwner, flushBackground, PASSWORD, request } from "./helpers/factory";
import { eventNames, events, logs } from "./helpers/logs";
import { lastCode, mailControl } from "./helpers/mail";

let n = 0;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  request(path, { body, headers: { "x-forwarded-for": `198.51.100.${(n++ % 250) + 1}`, ...headers } });
const signUp = async (email: string, password = PASSWORD, headers: Record<string, string> = {}) => {
  const res = await register(post("/api/auth/register", { email, password }, headers));
  await flushBackground();
  return res;
};
const confirm = async (email: string, code: string) => {
  const res = await verify(post("/api/auth/verify-email", { email, code }));
  await flushBackground();
  return res;
};
const resetCodeLimits = () => prisma.loginAttempt.deleteMany({ where: { ipKey: { startsWith: "code-" } } });
const ago = (ms: number) => new Date(Date.now() - ms);

describe("the logger", () => {
  it("emits one structured entry with ts, level and event first", () => {
    log.info("demo.event", { a: 1, ownerId: "o-1" });
    expect(logs).toHaveLength(1);
    expect(Object.keys(logs[0]).slice(0, 3)).toEqual(["ts", "level", "event"]);
    expect(logs[0]).toMatchObject({ level: "info", event: "demo.event", a: 1, ownerId: "o-1" });
    expect(new Date(logs[0].ts as string).toISOString()).toBe(logs[0].ts);
  });

  it("a field can never overwrite ts, level or event", () => {
    log.warn("real.event", { event: "fake", level: "debug", ts: "yesterday" });
    expect(logs[0]).toMatchObject({ event: "real.event", level: "warn" });
    expect(logs[0].ts).not.toBe("yesterday");
  });

  it("respects LOG_LEVEL", () => {
    const original = process.env.LOG_LEVEL;
    try {
      process.env.LOG_LEVEL = "warn";
      log.debug("a");
      log.info("b");
      log.warn("c");
      log.error("d");
      expect(eventNames()).toEqual(["c", "d"]);
      logs.length = 0;
      process.env.LOG_LEVEL = "silent";
      log.error("e");
      expect(logs).toHaveLength(0);
      process.env.LOG_LEVEL = "nonsense"; // falls back to info
      log.debug("f");
      log.info("g");
      expect(eventNames()).toEqual(["g"]);
    } finally {
      process.env.LOG_LEVEL = original;
    }
  });

  it("child loggers add their fields to every line", () => {
    const child = log.child({ rid: "r1" }).child({ route: "/x" });
    child.info("demo", { k: "v" });
    expect(logs[0]).toMatchObject({ rid: "r1", route: "/x", k: "v" });
  });

  it("masks email addresses, including inside nested values and error messages", () => {
    expect(maskEmail("Ada.Lovelace@Gmail.com")).toBe("A***@Gmail.com");
    expect(maskEmail("nonsense")).toBe("[invalid-email]");
    log.info("demo", { email: "ada@example.com", nested: { list: ["bob@corp.io"] }, note: "failed for carol@mail.net, retrying" });
    log.error("demo.err", errorFields(new Error("550 mailbox dave@example.org unavailable")));
    const text = JSON.stringify(logs);
    for (const raw of ["ada@", "bob@", "carol@", "dave@"]) expect(text).not.toContain(raw);
    expect(text).toContain("a***@example.com");
    expect(text).toContain("d***@example.org");
  });

  it("redacts secrets by key name and by shape", () => {
    log.info("demo", {
      password: "hunter2",
      refreshToken: "abc",
      passwordHash: "$argon2id$x",
      cookie: "ft_refresh=zzz",
      authorization: "Bearer q",
      jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl",
      url: "failed to connect to postgresql://user:s3cret@db.example.com:5432/app",
    });
    const text = JSON.stringify(logs);
    for (const leak of ["hunter2", "$argon2id", "ft_refresh=zzz", "Bearer q", "eyJhbGci", "s3cret", "user:"]) expect(text).not.toContain(leak);
    expect(logs[0]).toMatchObject({ password: "[redacted]", refreshToken: "[redacted]", passwordHash: "[redacted]" });
  });

  it("caps long strings, deep nesting and big arrays", () => {
    log.info("demo", { long: "x".repeat(5000), deep: { a: { b: { c: { d: 1 } } } }, list: Array.from({ length: 100 }, (_, i) => i) });
    const entry = logs[0] as unknown as { long: string; deep: { a: { b: unknown } }; list: number[] };
    expect(entry.long.length).toBeLessThan(400);
    expect(entry.deep.a.b).toBe("[truncated]");
    expect(entry.list).toHaveLength(20);
  });

  it("prints JSON lines through console.log / warn / error, so the host can tell the levels apart", () => {
    setLogSink(null);
    const spies = { log: vi.spyOn(console, "log").mockImplementation(() => {}), warn: vi.spyOn(console, "warn").mockImplementation(() => {}), error: vi.spyOn(console, "error").mockImplementation(() => {}) };
    try {
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
      expect(spies.log).toHaveBeenCalledTimes(2);
      expect(spies.warn).toHaveBeenCalledTimes(1);
      expect(spies.error).toHaveBeenCalledTimes(1);
      expect(JSON.parse(spies.warn.mock.calls[0][0] as string)).toMatchObject({ level: "warn", event: "w" });
    } finally {
      Object.values(spies).forEach((s) => s.mockRestore());
      setLogSink((entry) => void logs.push(entry));
    }
  });

  it("the request logger uses Vercel's request id, or makes one up", () => {
    const withId = requestLogger(request("/api/auth/login", { headers: { "x-vercel-id": "iad1::abc12-1700000000000-deadbeef" } }));
    withId.info("demo");
    expect(logs[0]).toMatchObject({ rid: "abc12-1700000000000-dead", method: "GET", path: "/api/auth/login" });
    const without = requestLogger(request("/x?secret=1"));
    without.info("demo");
    expect(logs[1].rid).toMatch(/^[0-9a-f-]{8}$/);
    expect(logs[1].path).toBe("/x"); // never the query string
  });
});

describe("sign-up and email delivery are logged, including the background send", () => {
  const rid = { "x-vercel-id": "fra1::req7-1700000000000-aaaabbbbcccc" };

  it("tells the whole story under one request id", async () => {
    await signUp("Grace.Hopper@Example.com", PASSWORD, rid);
    expect(eventNames()).toEqual(["auth.register.accepted", "auth.register.outcome", "auth.otp.issued", "auth.mail.sent"]);
    expect(new Set(logs.map((l) => l.rid))).toEqual(new Set(["req7-1700000000000-aaaab"]));
    expect(events("auth.register.outcome")[0]).toMatchObject({ outcome: "created", email: "g***@example.com" });
    expect(events("auth.otp.issued")[0]).toMatchObject({ expiresInSec: 600 });
    const sent = events("auth.mail.sent")[0];
    expect(sent).toMatchObject({ kind: "otp", level: "info", messageId: "<test-message-id@example.test>" });
    expect(typeof sent.ms).toBe("number");
  });

  it("the accepted line is written before the email is sent", async () => {
    mailControl.delayMs = 150;
    await register(post("/api/auth/register", { email: "slow@example.com", password: PASSWORD }));
    expect(eventNames()).toEqual(["auth.register.accepted"]); // response is out, email still in flight
    await flushBackground();
    expect(eventNames()).toContain("auth.mail.sent");
    expect(events("auth.mail.sent")[0].ms).toBeGreaterThanOrEqual(140);
  });

  it("logs a failed send as an error with the SMTP details, address masked", async () => {
    mailControl.failWith = "550 mailbox {to} rejected";
    const res = await signUp("hedy@example.com");
    expect(res.status).toBe(200); // the person is not told; they can resend
    const failed = events("auth.mail.failed")[0];
    expect(failed).toMatchObject({ level: "error", kind: "otp", err: "Error", code: "EENVELOPE", email: "h***@example.com" });
    expect(failed.msg).toContain("h***@example.com");
    expect(JSON.stringify(logs)).not.toContain("hedy@");
    expect(eventNames()).not.toContain("auth.mail.sent");
  });

  it("records which kind of sign-up it was, while the reply stays identical", async () => {
    await createOwner("taken");
    await signUp("taken@example.test");
    expect(events("auth.register.outcome")[0]).toMatchObject({ outcome: "already_confirmed" });
    expect(events("auth.mail.sent")[0]).toMatchObject({ kind: "account_exists" });
    logs.length = 0;
    await signUp("again@example.com", "first password!");
    await resetCodeLimits();
    logs.length = 0;
    await signUp("again@example.com", "second password!");
    expect(events("auth.register.outcome")[0]).toMatchObject({ outcome: "password_replaced" });
  });

  it("logs a refused request as a warning naming which limit fired, never the address", async () => {
    for (let i = 0; i < 3; i++) {
      await prisma.loginAttempt.deleteMany({ where: { ipKey: { startsWith: "code-gap:" } } });
      await signUp("spam@example.com");
    }
    await prisma.loginAttempt.deleteMany({ where: { ipKey: { startsWith: "code-gap:" } } });
    logs.length = 0;
    const res = await signUp("spam@example.com");
    expect(res.status).toBe(429);
    expect(events("auth.register.rate_limited")[0]).toMatchObject({ level: "warn", limitedBy: ["code-send"], email: "s***@example.com" });
    expect((events("auth.register.rate_limited")[0].retryAfter as number) > 60).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("code-send:email");
  });

  it("a sign-up inside the minute is logged as accepted with the earlier code kept, not as a refusal", async () => {
    await signUp("again2@example.com");
    logs.length = 0;
    const res = await signUp("again2@example.com");
    expect(res.status).toBe(200);
    expect(events("auth.register.accepted")[0]).toMatchObject({ level: "info", codeJustSent: true });
    expect(events("auth.register.code_reused")[0]).toMatchObject({ level: "info", email: "a***@example.com" });
    expect(eventNames()).not.toContain("auth.register.rate_limited");
    expect(eventNames()).not.toContain("auth.mail.sent");
  });

  it("resend logs what it did for unknown, confirmed and unconfirmed addresses", async () => {
    await signUp("pending@example.com");
    await createOwner("done");
    await resetCodeLimits();
    logs.length = 0;
    for (const email of ["pending@example.com", "done@example.test", "ghost@example.com"]) {
      await resend(post("/api/auth/resend-verification", { email }));
      await flushBackground();
      await resetCodeLimits();
    }
    expect(events("auth.resend.outcome").map((l) => l.outcome)).toEqual(["sending", "already_confirmed", "unknown_email"]);
    expect(events("auth.mail.sent")).toHaveLength(1);
  });

  it("a background task that throws is logged with its stack, not lost", async () => {
    inBackground(async () => {
      throw new Error("boom for ada@example.com");
    }, log.child({ rid: "bg1" }));
    await flushBackground();
    const failed = events("background.failed")[0];
    expect(failed).toMatchObject({ level: "error", rid: "bg1", err: "Error" });
    expect(failed.msg).toBe("boom for a***@example.com");
    expect(typeof failed.stack).toBe("string");
  });
});

describe("code checks and sign-ins are logged with their real reason", () => {
  it("logs wrong, unknown and correct codes at the right level", async () => {
    await signUp("code@example.com");
    const right = lastCode("code@example.com");
    const wrong = right === "000000" ? "111111" : "000000";
    logs.length = 0;
    await confirm("code@example.com", wrong);
    await confirm("nobody@example.com", "123456");
    await confirm("code@example.com", right);
    const rejected = events("auth.otp.rejected");
    expect(rejected[0]).toMatchObject({ level: "warn", reason: "wrong", attemptsUsed: 1, email: "c***@example.com" });
    expect(rejected[1]).toMatchObject({ level: "warn", reason: "unknown_email" });
    expect(events("auth.otp.confirmed")[0]).toMatchObject({ level: "info", email: "c***@example.com" });
  });

  it("logs a burned code and an expired code", async () => {
    await signUp("burn@example.com");
    const right = lastCode("burn@example.com");
    const wrong = right === "000000" ? "111111" : "000000";
    logs.length = 0;
    for (let i = 0; i < 6; i++) await confirm("burn@example.com", wrong);
    expect(events("auth.otp.rejected").map((l) => l.reason)).toEqual(["wrong", "wrong", "wrong", "wrong", "wrong", "burned"]);
    await resetCodeLimits();
    await prisma.loginAttempt.deleteMany({});
    await signUp("late@example.com");
    await prisma.emailOtp.updateMany({ data: { expiresAt: ago(1000) } });
    logs.length = 0;
    await confirm("late@example.com", lastCode("late@example.com"));
    expect(events("auth.otp.rejected")[0]).toMatchObject({ reason: "expired" });
  });

  it("logs the code-check limit", async () => {
    await signUp("limit@example.com");
    logs.length = 0;
    for (let i = 0; i < 12; i++) await confirm("limit@example.com", "000001");
    expect(events("auth.otp.rate_limited")[0]).toMatchObject({ level: "warn", limitedBy: ["check"] });
  });

  it("logs sign-in failures with the internal reason, and successes", async () => {
    await createOwner();
    const email = "primary@example.test";
    const attempt = (e: string, p: string) => login(post("/api/auth/login", { email: e, password: p }));
    await attempt(email, "not the password");
    await attempt("nobody@example.test", "whatever long");
    await attempt(email, PASSWORD);
    const failed = events("auth.login.failed");
    expect(failed[0]).toMatchObject({ level: "warn", reason: "bad_password", email: "p***@example.test" });
    expect(failed[0].ownerId).toBeTruthy();
    expect(failed[1]).toMatchObject({ reason: "unknown_email", email: "n***@example.test" });
    expect(events("auth.login.ok")[0]).toMatchObject({ level: "info", email: "p***@example.test" });
  });

  it("logs an unconfirmed sign-in and whether a code went out", async () => {
    await signUp("wait@example.com");
    await resetCodeLimits();
    logs.length = 0;
    await login(post("/api/auth/login", { email: "wait@example.com", password: PASSWORD }));
    await flushBackground();
    expect(events("auth.login.unconfirmed")[0]).toMatchObject({ codeSent: true });
    expect(eventNames()).toContain("auth.mail.sent");
    logs.length = 0;
    await login(post("/api/auth/login", { email: "wait@example.com", password: PASSWORD })); // inside the 60 s gap
    expect(events("auth.login.unconfirmed")[0]).toMatchObject({ codeSent: false });
  });

  it("logs the sign-in lockout", async () => {
    await createOwner();
    for (let i = 0; i < 6; i++) await login(post("/api/auth/login", { email: "primary@example.test", password: "wrong wrong" }));
    expect(events("auth.login.rate_limited")[0]).toMatchObject({ level: "warn", limitedBy: ["email"] });
  });

  it("logs a cross-origin attempt", async () => {
    await login(request("/api/auth/login", { body: { email: "a@b.co", password: "x" }, origin: "https://evil.example" }));
    expect(events("auth.login.rejected")[0]).toMatchObject({ level: "warn", reason: "cross_origin", origin: "https://evil.example" });
  });
});

describe("token handling is logged", () => {
  it("logs a rotation, and treats a parallel request inside the grace window as debug noise", async () => {
    const ownerId = await createOwner();
    const first = await issueSession(ownerId);
    logs.length = 0;
    await rotateRefreshToken(first.refreshToken);
    await rotateRefreshToken(first.refreshToken); // parallel request, inside the grace window
    expect(events("auth.refresh.rotated")[0]).toMatchObject({ level: "info", ownerId, via: "api" });
    expect(events("auth.refresh.grace")[0]).toMatchObject({ level: "debug", ownerId });
  });

  it("logs token reuse after the grace window as a warning with who, which sign-in and how many tokens died", async () => {
    const ownerId = await createOwner();
    const first = await issueSession(ownerId);
    await rotateRefreshToken(first.refreshToken);
    await prisma.refreshToken.updateMany({ where: { rotatedAt: { not: null } }, data: { rotatedAt: ago(ROTATION_GRACE_MS + 5000) } });
    logs.length = 0;
    expect(await rotateRefreshToken(first.refreshToken)).toBeNull();
    const reuse = events("auth.refresh.reuse_detected")[0];
    expect(reuse).toMatchObject({ level: "warn", ownerId, tokensDeleted: 2 });
    expect(reuse.familyId).toBeTruthy();
    expect(reuse.sinceRotationSec).toBeGreaterThanOrEqual(14);
  });

  it("logs expired and unknown tokens at the right level, and the page refresh as via=page", async () => {
    const ownerId = await createOwner();
    const t = await issueSession(ownerId);
    await prisma.refreshToken.updateMany({ data: { expiresAt: ago(1000) } });
    logs.length = 0;
    await rotateRefreshToken(t.refreshToken);
    await rotateRefreshToken("forged-token-value");
    expect(events("auth.refresh.expired")[0]).toMatchObject({ level: "info", ownerId });
    expect(events("auth.refresh.rejected")[0]).toMatchObject({ level: "debug", reason: "unknown_token" });

    const fresh = await issueSession(ownerId);
    logs.length = 0;
    await refreshRoute(request("/api/auth/refresh?next=%2Fhistory", { cookie: `ft_refresh=${fresh.refreshToken}` }));
    expect(events("auth.refresh.rotated")[0]).toMatchObject({ via: "page", path: "/api/auth/refresh" });
  });

  it("logs a sign-out", async () => {
    await createOwner();
    const res = await login(post("/api/auth/login", { email: "primary@example.test", password: PASSWORD }));
    logs.length = 0;
    await logout(request("/api/auth/logout", { method: "POST", cookie: cookieFrom(res) }));
    expect(events("auth.logout")[0]).toMatchObject({ level: "info", tokensDeleted: 1 });
    logs.length = 0;
    await logout(request("/api/auth/logout", { method: "POST" }));
    expect(events("auth.logout")[0]).toMatchObject({ signedIn: false });
  });
});

describe("housekeeping and server errors are logged", () => {
  it("logs cleanup only when it removed something", async () => {
    await beginAttempt([{ key: "test:quiet", max: 5 }]);
    expect(events("auth.cleanup")).toHaveLength(0);
    await prisma.loginAttempt.create({ data: { ipKey: "ip:old", success: false, createdAt: ago(2 * LOGIN_WINDOW_MS) } });
    await beginAttempt([{ key: "test:busy", max: 5 }]);
    expect(events("auth.cleanup")[0]).toMatchObject({ level: "info", attempts: 1 });
  });

  it("logs abandoned accounts being removed", async () => {
    await signUp("abandoned@example.com");
    await prisma.owner.updateMany({ data: { createdAt: ago(25 * 3_600_000) } });
    await prisma.emailOtp.updateMany({ data: { expiresAt: ago(1000) } }); // a still-valid code keeps the account
    logs.length = 0;
    await beginAttempt([{ key: "test:purge", max: 5 }]);
    expect(events("auth.cleanup.unconfirmed_accounts")[0]).toMatchObject({ deleted: 1, olderThanHours: 24 });
  });

  it("onRequestError logs where an uncaught error happened, with secrets and addresses scrubbed", async () => {
    const err = Object.assign(new Error("connect failed: postgresql://app:pw123@db.internal:5432/x for ada@example.com"), { digest: "d1g3st" });
    await onRequestError(err, { path: "/api/settings?token=abc", method: "POST", headers: {} }, {
      routerKind: "App Router",
      routePath: "/api/settings",
      routeType: "route",
      renderSource: undefined,
      revalidateReason: undefined,
    } as never);
    const entry = events("server.error")[0];
    expect(entry).toMatchObject({ level: "error", method: "POST", path: "/api/settings", routePath: "/api/settings", routeType: "route", digest: "d1g3st" });
    const text = JSON.stringify(entry);
    for (const leak of ["pw123", "app:", "ada@", "token=abc"]) expect(text).not.toContain(leak);
  });

  it("logs the startup configuration as yes/no only, and errors for a missing secret", async () => {
    const original = { runtime: process.env.NEXT_RUNTIME, secret: process.env.JWT_ACCESS_SECRET };
    try {
      process.env.NEXT_RUNTIME = "nodejs";
      await registerInstrumentation();
      const start = events("server.start")[0];
      expect(start).toMatchObject({ level: "info", jwtSecretOk: true, smtpConfigured: true, logLevel: "debug" });
      expect(JSON.stringify(logs)).not.toContain(original.secret);

      logs.length = 0;
      process.env.JWT_ACCESS_SECRET = "short";
      await registerInstrumentation();
      expect(events("server.config")[0]).toMatchObject({ level: "error" });
      expect(JSON.stringify(logs)).not.toContain('"short"');
    } finally {
      process.env.NEXT_RUNTIME = original.runtime;
      process.env.JWT_ACCESS_SECRET = original.secret;
    }
  });
});

describe("nothing sensitive ever reaches the logs", () => {
  it("a full sign-up, confirm, sign-in, refresh and sign-out leaves no password, code, token or full address", async () => {
    const email = "Katherine.Johnson@Example.com";
    const password = "a very private passphrase";
    await signUp(email, password);
    const code = lastCode("katherine.johnson@example.com");
    const confirmed = await confirm("katherine.johnson@example.com", code);
    const refreshToken = cookieValue(confirmed, "ft_refresh")!;
    const accessToken = cookieValue(confirmed, "ft_access")!;
    await login(post("/api/auth/login", { email, password: "wrong password!" }));
    const ok = await login(post("/api/auth/login", { email, password }));
    await rotateRefreshToken(refreshToken);
    await rotateRefreshToken("another-forged-value-123");
    await logout(request("/api/auth/logout", { method: "POST", cookie: cookieFrom(ok) }));

    expect(logs.length).toBeGreaterThan(8);
    const text = JSON.stringify(logs);
    for (const secret of [password, "wrong password!", refreshToken, accessToken, cookieValue(ok, "ft_refresh")!, "another-forged-value-123", "$argon2", "katherine.johnson", "Katherine.Johnson"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).not.toMatch(/"code":"\d{6}"/);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}\./);
    expect(text).toContain("k***@example.com"); // addresses are lower-cased before they are used
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
