import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    pool: "threads",
    maxWorkers: 2,
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/server/__tests__/setup.ts"],
    environment: "node",
  },
});
