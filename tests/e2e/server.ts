import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { testDatabaseUrl } from "../helpers/test-db-url";

export const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
export const chromeAvailable = existsSync(CHROME);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Starts `next start` (needs a prior `next build`) against the test database. */
export async function startServer(port: number, extraEnv: Record<string, string> = {}): Promise<{ url: string; stop: () => void }> {
  const child: ChildProcess = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl(), ...extraEnv },
    stdio: "ignore",
    detached: true,
  });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/login`)).ok) return { url, stop: () => process.kill(-child.pid!, "SIGTERM") };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  process.kill(-child.pid!, "SIGTERM");
  throw new Error(`server on ${port} did not start`);
}

export const fakeClockPreload = fileURLToPath(new URL("./fake-clock.cjs", import.meta.url));
