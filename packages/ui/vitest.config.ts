import { defineConfig } from "vitest/config";

// Same pool as every other package: vitest's default fork workers fail to start on Windows under
// load ("Timeout waiting for worker to respond"), which made the editor tests look flaky.
export default defineConfig({
  test: {
    pool: "threads",
    maxWorkers: 2,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
});
