import { execSync } from "node:child_process";
import { testDatabaseUrl } from "./test-db-url";

export default function setup() {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: "pipe",
  });
}
