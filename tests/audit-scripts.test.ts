import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** Runs one of scripts/lib.sh's functions in bash, as the db-*.sh scripts do. */
function lib(fn: string, arg: string) {
  const r = spawnSync("bash", ["-c", `source scripts/lib.sh; ${fn} "$1"`, "_", arg], { encoding: "utf8" });
  return { out: r.stdout.trim(), err: r.stderr.trim(), code: r.status };
}

const URL = "postgresql://postgres.abcd:s3cr3t%40pw@aws-0-eu.pooler.supabase.com:5432/postgres";

describe("audit #25: backup/restore script helpers", () => {
  it("strips Prisma-only query parameters that pg_dump/psql reject, and keeps the rest", () => {
    expect(lib("libpq_url", `${URL}?schema=public`).out).toBe(URL);
    expect(lib("libpq_url", `${URL}?pgbouncer=true&connection_limit=1&sslmode=require`).out).toBe(`${URL}?sslmode=require`);
    expect(lib("libpq_url", `${URL}?sslmode=require&schema=public`).out).toBe(`${URL}?sslmode=require`);
    expect(lib("libpq_url", `${URL}?sslmode=verify-full&sslrootcert=/tmp/ca.crt`).out).toBe(`${URL}?sslmode=verify-full&sslrootcert=/tmp/ca.crt`);
    expect(lib("libpq_url", URL).out).toBe(URL);
  });

  it("shows only host and database, never the user or password", () => {
    const host = lib("url_host", `${URL}?schema=public`);
    expect(host.out).toBe("aws-0-eu.pooler.supabase.com:5432");
    expect(lib("url_db", `${URL}?schema=public`).out).toBe("postgres");
    for (const text of [host.out, lib("url_db", URL).out]) {
      expect(text).not.toContain("s3cr3t");
      expect(text).not.toContain("postgres.abcd");
    }
  });

  it("refuses a localhost URL (which inside Docker is the container itself) and explains what to use", () => {
    for (const u of ["postgresql://u:p@localhost:5434/db", "postgresql://u:p@127.0.0.1:5434/db", "postgresql://u:p@[::1]:5434/db"]) {
      const r = lib("refuse_localhost_url", u);
      expect(r.code, u).toBe(1);
      expect(r.err).toContain("host.docker.internal");
      expect(r.err).not.toContain(":p@"); // no credentials in the message
    }
    expect(lib("refuse_localhost_url", "postgresql://u:p@host.docker.internal:5434/db").code).toBe(0);
    expect(lib("refuse_localhost_url", URL).code).toBe(0);
  });
});
