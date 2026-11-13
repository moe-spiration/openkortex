import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/*
 * Smoke suite: every route and every main action once, with a hard fail on console errors, on the
 * mock data (no Supabase, no account, no global setup), so it works in any worktree without secrets.
 *
 * `pnpm --filter @kortex/web e2e:smoke` (--project=smoke-prod): against a production build, which must
 * be a mock build because the data source is inlined at build time:
 *   KORTEX_DATA_SOURCE=mock pnpm --filter @kortex/web build
 * `e2e:smoke:dev`: against next dev (no build, but each route compiles on its first visit).
 * SMOKE_BASE_URL=http://localhost:3500 points it at an already running server instead.
 */

const PORT = Number(process.env.SMOKE_PORT ?? 3510);
const external = process.env.SMOKE_BASE_URL?.trim().replace(/\/+$/, "");
const baseURL = external || `http://localhost:${PORT}`;
const prod = process.env.SMOKE_PROD === "1" || process.argv.includes("--project=smoke-prod");
// Worker processes do not see the CLI args: hand the mode down through the environment.
if (prod) process.env.SMOKE_PROD = "1";

export default defineConfig({
  testDir: "./e2e/smoke",
  outputDir: join(tmpdir(), "kortex-e2e-smoke", "results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // next dev compiles each route on its first visit.
    navigationTimeout: 120_000,
    actionTimeout: 20_000,
    ...devices["Desktop Chrome"],
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [{ name: prod ? "smoke-prod" : "smoke" }],
  webServer: external
    ? undefined
    : {
        command: prod ? "node e2e/support/serve-prod.mjs" : `pnpm exec next dev --port ${PORT}`,
        url: `${baseURL}/home`,
        // Mock data, whatever .env.local says: the suite never touches a real account.
        env: { PORT: String(PORT), KORTEX_DATA_SOURCE: "mock" },
        reuseExistingServer: !!process.env.SMOKE_REUSE_SERVER,
        timeout: 300_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
