import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Browser tests: `npm run test:e2e` (builds first). Uses the test database and
// the locally installed Chrome (CHROME_PATH), driven by playwright-core.
export default defineConfig({
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/helpers/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/e2e/**/*.e2e.ts"],
    environment: "node",
    globalSetup: ["./tests/helpers/global-setup.ts"],
    setupFiles: ["./tests/helpers/setup.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
