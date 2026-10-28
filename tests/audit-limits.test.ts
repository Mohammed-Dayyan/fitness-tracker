import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as commit } from "@/app/api/import/commit/route";
import { POST as preview } from "@/app/api/import/preview/route";
import { POST as login } from "@/app/api/auth/login/route";
import { readJsonBody } from "@/lib/server/http";
import { COMMIT_WRAPPER_BYTES, MAX_IMPORT_BYTES, formatBytes } from "@/lib/shared/limits";
import { cookieFrom, createOwner, ctx, ORIGIN, PASSWORD, request } from "./helpers/factory";

const enc = new TextEncoder();

/** A POST whose body arrives as a stream with no Content-Length, like a chunked upload. */
function streamed(parts: string[], headers: Record<string, string> = {}) {
  const state = { cancelled: false, pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = parts[state.pulled++];
      if (next === undefined) controller.close();
      else controller.enqueue(enc.encode(next));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  const req = new NextRequest(new URL("/x", ORIGIN), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: stream,
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1]);
  return { req, state };
}

const jsonOfBytes = (n: number, ch = "x") => `{"a":"${ch.repeat((n - 8) / enc.encode(ch).length)}"}`;

describe("audit #7: request size limits", () => {
  it("accepts a body up to and including the limit, however it arrives", async () => {
    const body = jsonOfBytes(1000);
    expect(enc.encode(body).length).toBe(1000);
    const { req } = streamed([body.slice(0, 400), body.slice(400)]);
    expect(await readJsonBody(req, 1000)).toEqual({ ok: true, value: { a: "x".repeat(992) } });
  });

  it("returns 413 (not 'invalid JSON') for a chunked body over the limit, and stops reading it", async () => {
    const chunk = "x".repeat(300);
    const { req, state } = streamed(['{"a":"', chunk, chunk, chunk, chunk, chunk, chunk, '"}']);
    const res = await readJsonBody(req, 1000);
    expect(res).toEqual({ ok: false, status: 413, error: "Request body is too large. The limit is 1000 bytes." });
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(8); // the rest of the upload was never read
  });

  it("counts bytes, not characters", async () => {
    expect((await readJsonBody(streamed([jsonOfBytes(1000, "é")]).req, 1000)).ok).toBe(true);
    expect(await readJsonBody(streamed([jsonOfBytes(1002, "é")]).req, 1000)).toMatchObject({ ok: false, status: 413 });
  });

  it("rejects a declared Content-Length over the limit without reading the body", async () => {
    const { req } = streamed(["{}"], { "content-length": "5000" });
    expect(await readJsonBody(req, 1000)).toMatchObject({ ok: false, status: 413 });
    expect(req.bodyUsed).toBe(false); // never started reading
  });

  it("still reports genuinely invalid JSON as 400", async () => {
    for (const body of ["", "{nope", '{"a":']) {
      expect(await readJsonBody(streamed([body]).req, 1000)).toEqual({ ok: false, status: 400, error: "Body is not valid JSON." });
    }
  });

  it("formats limits readably", () => {
    expect(formatBytes(MAX_IMPORT_BYTES)).toBe("10 MB");
    expect(formatBytes(4096)).toBe("4 KB");
  });

  it("preview: 413 just over the limit, no 413 at the limit (reaches JSON parsing instead)", async () => {
    await createOwner();
    const cookie = cookieFrom(await login(request("/api/auth/login", { body: { password: PASSWORD } })));
    const over = await preview(request("/api/import/preview", { body: " ".repeat(MAX_IMPORT_BYTES + 1), cookie }), ctx);
    expect(over.status).toBe(413);
    expect((await over.json()).error).toBe("Request body is too large. The limit is 10 MB.");
    const atLimit = await preview(request("/api/import/preview", { body: " ".repeat(MAX_IMPORT_BYTES), cookie }), ctx);
    expect(atLimit.status).toBe(400); // size accepted; whitespace is not JSON
  });

  it("confirm allows exactly the wrapper allowance beyond the preview limit, and no more", async () => {
    await createOwner();
    const cookie = cookieFrom(await login(request("/api/auth/login", { body: { password: PASSWORD } })));
    const limit = MAX_IMPORT_BYTES + COMMIT_WRAPPER_BYTES;
    expect((await commit(request("/api/import/commit", { body: " ".repeat(limit + 1), cookie }), ctx)).status).toBe(413);
    expect((await commit(request("/api/import/commit", { body: " ".repeat(limit), cookie }), ctx)).status).toBe(400);
  });

  it("authorization and CSRF still come first: oversized anonymous or cross-origin requests are not read", async () => {
    const big = " ".repeat(MAX_IMPORT_BYTES + 1);
    expect((await preview(request("/api/import/preview", { body: big }), ctx)).status).toBe(401);
    await createOwner();
    const cookie = cookieFrom(await login(request("/api/auth/login", { body: { password: PASSWORD } })));
    expect((await preview(request("/api/import/preview", { body: big, cookie, origin: "https://evil.example" }), ctx)).status).toBe(403);
  });

  it("the login endpoint has its own small limit", async () => {
    const res = await login(request("/api/auth/login", { body: JSON.stringify({ password: "a".repeat(5000) }) }));
    expect(res.status).toBe(413);
  });
});
