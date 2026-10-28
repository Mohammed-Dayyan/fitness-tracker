import { describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as exportRoute } from "@/app/api/export/route";
import { GET as contextRoute } from "@/app/api/export/context/route";
import { POST as preview } from "@/app/api/import/preview/route";
import { POST as commit } from "@/app/api/import/commit/route";
import { POST as settings } from "@/app/api/settings/route";
import { prisma } from "@/lib/server/db";
import { createSession } from "@/lib/server/auth/session";
import { cookieFrom, createBareOwner, createOwner, ctx, PASSWORD, request } from "./helpers/factory";

const payload = { schema_version: "1.0", date: "2026-10-27", food_entries: [{ id: "f1", name: "Oats", calories: 150 }] };

async function signedIn() {
  const ownerId = await createOwner();
  const cookie = cookieFrom(await login(request("/api/auth/login", { body: { password: PASSWORD } })));
  return { ownerId, cookie };
}

describe("API authorization", () => {
  it("every data endpoint returns 401 without a valid session", async () => {
    const bad = "ft_session=forged-token";
    for (const cookie of [undefined, bad]) {
      expect((await preview(request("/api/import/preview", { body: payload, cookie }), ctx)).status).toBe(401);
      expect((await commit(request("/api/import/commit", { body: { payload, preview_token: "x" }, cookie }), ctx)).status).toBe(401);
      expect((await exportRoute(request("/api/export?scope=all", { cookie }), ctx)).status).toBe(401);
      expect((await contextRoute(request("/api/export/context", { cookie }), ctx)).status).toBe(401);
    }
    expect(await prisma.foodEntry.count()).toBe(0);
  });

  it("rejects state-changing requests from another origin, or with no origin information", async () => {
    const { cookie } = await signedIn();
    const evil = await preview(request("/api/import/preview", { body: payload, cookie, origin: "https://evil.example" }), ctx);
    expect(evil.status).toBe(403);
    const none = await commit(request("/api/import/commit", { body: { payload, preview_token: "x" }, cookie, origin: null }), ctx);
    expect(none.status).toBe(403);
    const fetchMeta = await preview(
      request("/api/import/preview", { body: payload, cookie, origin: null, headers: { "sec-fetch-site": "same-origin" } }),
      ctx,
    );
    expect(fetchMeta.status).toBe(200);
  });

  it("requires JSON content type for imports", async () => {
    const { cookie } = await signedIn();
    const req = request("/api/import/preview", { method: "POST", cookie, headers: { "content-type": "text/plain" } });
    expect((await preview(req, ctx)).status).toBe(415);
  });

  it("full flow over HTTP: preview, confirm, export", async () => {
    const { cookie } = await signedIn();
    const p = await preview(request("/api/import/preview", { body: payload, cookie }), ctx);
    expect(p.status).toBe(200);
    const pBody = await p.json();
    expect(pBody.counts.created).toBe(1);

    const c = await commit(request("/api/import/commit", { body: { payload, preview_token: pBody.preview_token }, cookie }), ctx);
    expect(c.status).toBe(200);
    expect((await c.json()).counts.created).toBe(1);

    const e = await exportRoute(request("/api/export?scope=day&date=2026-10-27&download=1", { cookie }), ctx);
    expect(e.status).toBe(200);
    expect(e.headers.get("content-disposition")).toBe('attachment; filename="fitness-export-2026-10-27.json"');
    expect(e.headers.get("cache-control")).toBe("no-store");
    const body = await e.json();
    expect(body.food_entries).toEqual([expect.objectContaining({ id: "f1", name: "Oats", calories: 150 })]);
  });

  it("ignores any owner identifier supplied by the client", async () => {
    const other = await createBareOwner("victim");
    const { cookie, ownerId } = await signedIn();
    const sneaky = { ...payload, owner_id: other };
    const p = await preview(request("/api/import/preview", { body: sneaky, cookie }), ctx);
    expect(p.status).toBe(422); // unknown top-level field
    const e = await exportRoute(request(`/api/export?scope=all&owner_id=${other}`, { cookie }), ctx);
    expect(e.status).toBe(200);
    expect(ownerId).not.toBe(other);
  });

  it("a session for one owner only ever sees that owner's data", async () => {
    const a = await createBareOwner("a");
    const b = await createBareOwner("b");
    await prisma.foodEntry.create({ data: { ownerId: a, id: "fa", date: new Date("2026-10-27"), name: "A food" } });
    const { token } = await createSession(b);
    const e = await exportRoute(request("/api/export?scope=all", { cookie: `ft_session=${token}` }), ctx);
    expect((await e.json()).food_entries).toEqual([]);
  });

  it("validates export parameters", async () => {
    const { cookie } = await signedIn();
    for (const q of ["scope=day&date=2026-13-01", "scope=month&month=2026-1", "scope=range&from=2026-10-10&to=2026-10-01", "scope=weird"]) {
      expect((await exportRoute(request(`/api/export?${q}`, { cookie }), ctx)).status).toBe(400);
    }
  });

  it("settings: requires a session and same origin; saves through the import engine", async () => {
    const body = { section: "targets", effective_from: "2026-10-01", calories: "2100" };
    expect((await settings(request("/api/settings", { body }), ctx)).status).toBe(401);
    const { cookie, ownerId } = await signedIn();
    expect((await settings(request("/api/settings", { body, cookie, origin: "https://evil.example" }), ctx)).status).toBe(403);
    const ok = await settings(request("/api/settings", { body, cookie }), ctx);
    expect(ok.status).toBe(200);
    expect(await prisma.targetSet.count({ where: { ownerId } })).toBe(1);
    const bad = await settings(request("/api/settings", { body: { ...body, calories: "lots" }, cookie }), ctx);
    expect(bad.status).toBe(422);
    expect((await bad.json()).fieldErrors).toEqual({ calories: "Enter a number" });
    expect((await settings(request("/api/settings", { body: { section: "other" }, cookie }), ctx)).status).toBe(400);
  });
});
