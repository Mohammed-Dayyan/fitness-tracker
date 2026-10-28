import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations need a direct (non-pooled) connection on hosts that put a
    // transaction pooler in front of Postgres (Supabase, Neon). The app itself
    // only ever reads DATABASE_URL, so switching providers is a config change.
    url: process.env["DIRECT_DATABASE_URL"] || process.env["DATABASE_URL"],
  },
});
