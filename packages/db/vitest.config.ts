import { defineConfig } from "vitest/config";

// Same pool as every other package (vitest's default fork workers fail to start on Windows under
// load). The setup file loads the German catalog and switches the tests to German.
export default defineConfig({
  test: {
    pool: "threads",
    maxWorkers: 2,
    setupFiles: ["src/test-setup.ts"],
  },
});
