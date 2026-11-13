import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { pool: "threads", maxWorkers: 2, include: ["test/**/*.test.{ts,tsx}"], environment: "node", setupFiles: ["test/setup.ts"] },
});
