import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("./", import.meta.url)),
      // "server-only" throws outside React Server Components; tests run in Node.
      "server-only": fileURLToPath(new URL("./tests/helpers/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/helpers/global-setup.ts"],
    setupFiles: ["./tests/helpers/setup.ts"],
    // Tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
