import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: { pool: "threads", maxWorkers: 2, environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"], setupFiles: ["test/setup.ts"] },
});
