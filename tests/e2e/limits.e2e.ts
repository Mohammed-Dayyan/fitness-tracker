import http from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_IMPORT_BYTES } from "@/lib/shared/limits";
import { createOwner, PASSWORD } from "../helpers/factory";
import { startServer } from "./server";

// Real production server over real HTTP. Bodies are sent with chunked
// transfer-encoding (no Content-Length): the case the Next.js proxy used to
// truncate at 10 MB. node:http is used because it shows exactly what is on the wire.

let server: Awaited<ReturnType<typeof startServer>>;
let cookie = "";

const enc = new TextEncoder();

/** `total` bytes of JSON, as 64 KB pieces. */
function pieces(total: number, build: (padding: string) => string = (p) => `{"schema_version":"1.0","summary":"${p}"}`): Buffer[] {
  const overhead = enc.encode(build("")).length;
  const body = Buffer.from(build("a".repeat(Math.max(0, total - overhead))));
  const out: Buffer[] = [];
  for (let i = 0; i < body.length; i += 65536) out.push(body.subarray(i, i + 65536));
  return out;
}

type Reply = { status: number; json: () => Record<string, unknown> };

/** POSTs `chunks` and resolves with the first response. */
function post(path: string, chunks: Buffer[], headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const u = new URL(server.url);
    let settled = false;
    const req = http.request(
      // agent:false = a new connection each time: the server closes the connection after refusing an oversized upload.
      { host: u.hostname, port: Number(u.port), path, method: "POST", agent: false, headers: { "content-type": "application/json", origin: server.url, cookie, ...headers } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          settled = true;
          resolve({ status: res.statusCode!, json: () => JSON.parse(data) });
          req.destroy();
        });
      },
    );
    // The server may answer 413 and close while we are still uploading: that is expected once we have a reply.
    req.on("error", (e) => !settled && reject(e));
    (async () => {
      try {
        for (const c of chunks) if (!req.write(c)) await once(req, "drain");
        req.end();
      } catch (e) {
        if (!settled) reject(e);
      }
    })();
  });
}

describe("audit #7: request size limits on the production server", () => {
  beforeAll(async () => {
    server = await startServer(3230);
  });
  afterAll(() => server?.stop());

  // The shared test setup empties every table before each test, so each test signs in afresh.
  beforeEach(async () => {
    await createOwner();
    const res = await fetch(`${server.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.url },
      body: JSON.stringify({ password: PASSWORD }),
    });
    cookie = res.headers.get("set-cookie")!.split(";")[0];
  });

  it("a chunked body just under the limit is read in full (no truncation) and previewed", async () => {
    const res = await post("/api/import/preview", pieces(MAX_IMPORT_BYTES - 1024));
    expect(res.status).toBe(200);
    const body = res.json() as { counts: Record<string, number>; warnings: string[] };
    expect(body.counts).toEqual({ created: 0, updated: 0, unchanged: 0, deleted: 0, rejected: 0 });
    expect(body.warnings.join(" ")).toMatch(/summary.*ignored/); // the whole body was parsed
  });

  it("a chunked body over the limit gets 413 with the limit named, not 'invalid JSON'", async () => {
    const res = await post("/api/import/preview", pieces(MAX_IMPORT_BYTES + 2 * 1024 * 1024));
    expect(res.status).toBe(413);
    expect(res.json().error).toBe("Request body is too large. The limit is 10 MB.");
  });

  it("the same applies to confirm", async () => {
    const commit = await post("/api/import/commit", pieces(MAX_IMPORT_BYTES + 2 * 1024 * 1024, (p) => `{"payload":{"x":"${p}"},"preview_token":"t"}`));
    expect(commit.status).toBe(413);
  });

  it("an oversized body with a declared Content-Length is refused from the header", async () => {
    const big = pieces(MAX_IMPORT_BYTES + 1024 * 1024);
    const length = big.reduce((n, c) => n + c.length, 0);
    const res = await post("/api/import/preview", big, { "content-length": String(length) });
    expect(res.status).toBe(413);
    expect(res.json().error).toBe("Request body is too large. The limit is 10 MB.");
  });

  it("CSRF and authorization are still checked first for oversized uploads", async () => {
    const big = pieces(MAX_IMPORT_BYTES + 1024 * 1024);
    expect((await post("/api/import/preview", big, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("/api/import/preview", big, { cookie: "" })).status).toBe(401);
  });
});
