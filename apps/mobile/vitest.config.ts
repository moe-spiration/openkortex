import { defineConfig } from "vitest/config";

// Pure TypeScript only: theme maths, smart search, mock answers and the ingest client.
// Tests run in German: test/setup.ts loads the catalog and calls setLocale("de").
// Screens are checked in the Expo web preview (they need the React Native runtime).
export default defineConfig({ test: { pool: "threads", maxWorkers: 2, include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"], environment: "node" } });
