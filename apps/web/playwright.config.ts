import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { LIVE, LIVE_BASE_URL, RUN_DIR, STATE_FILE } from "./e2e/support/user";

// Secrets (Supabase keys, service role) come from apps/web/.env.local; never printed.
const envFile = resolve(__dirname, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Fallback for the e2e account: the values live in the repo root .env.local (the main checkout holds it,
// worktrees do not). Only the keys the e2e runs need are taken, nothing is copied to disk, and already
// set variables win. A local (non-live) run does not take the Supabase keys, so it stays on the mock data.
function rootEnvFiles(): string[] {
  const roots = [resolve(__dirname, "../..")];
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: __dirname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    roots.push(dirname(common));
  } catch {
    /* not a git checkout */
  }
  return roots.map((r) => join(r, ".env.local")).filter((f, i, all) => existsSync(f) && all.indexOf(f) === i);
}
const E2E_KEYS = /^(KORTEX_E2E_[A-Z_]+)$/;
const LIVE_KEYS = /^(KORTEX_E2E_[A-Z_]+|NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)$/;
for (const file of rootEnvFiles()) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    const key = m?.[1];
    if (!key || !(LIVE ? LIVE_KEYS : E2E_KEYS).test(key) || process.env[key]) continue;
    const v = (m?.[2] ?? "").replace(/^["']|["']$/g, "");
    if (v && !/^<.*>$/.test(v)) process.env[key] = v;
  }
}

const PORT = 3500;
// `pnpm e2e:prod`: the production build (standalone server.js or next start) instead of next dev.
const PROD = !!process.env.E2E_PROD || process.argv.some((a) => a === "--project=prod" || a === "--project=ui");
// Worker processes do not see the CLI args: hand the mode down through the environment.
if (PROD) process.env.E2E_PROD = "1";
// `pnpm e2e:live`: the prod specs against a deployed Kortex with the staging account (no local server).
if (LIVE) process.env.E2E_LIVE = "1";
// A localhost live target (E2E_BASE_URL=http://localhost:3500) still gets the local production server.
const LIVE_LOCAL = LIVE && new URL(LIVE_BASE_URL).origin === `http://localhost:${PORT}`;
const baseURL = LIVE ? LIVE_BASE_URL : `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: join(RUN_DIR, "results"),
  // One shared test user and a stateful database: run serially.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    // next dev compiles each route on first visit (10-30 s).
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "login", testMatch: /login\.spec\.ts/, dependencies: ["setup"], use: { ...devices["Desktop Chrome"] } },
    // Production-build smoke test (e2e/prod): only with E2E_PROD / --project=prod.
    ...(PROD
      ? [
          {
            name: "prod",
            testMatch: /prod\/.*\.spec\.ts/,
            dependencies: ["setup"],
            use: { ...devices["Desktop Chrome"], storageState: STATE_FILE },
          },
        ]
      : []),
    // UI acceptance (e2e/ui, A-01 to A-23): against the production build, or with E2E_LIVE=1 against the deployed Kortex.
    ...(PROD || LIVE
      ? [
          {
            name: "ui",
            testMatch: [/ui\/.*\.spec\.ts/, /prod\/spaces-loading-prod\.spec\.ts/],
            dependencies: ["setup"],
            use: {
              ...devices["Desktop Chrome"],
              storageState: STATE_FILE,
              // A fake microphone for the Orbit-Bar tests (A-13, A-22).
              launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
              permissions: ["microphone", "clipboard-read", "clipboard-write"],
            },
          },
        ]
      : []),
    ...(LIVE
      ? [
          {
            name: "live",
            testMatch: /prod\/.*\.spec\.ts/,
            dependencies: ["setup"],
            use: { ...devices["Desktop Chrome"], storageState: STATE_FILE },
          },
        ]
      : []),
    {
      name: "flows",
      testMatch: /flows\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: STATE_FILE },
    },
  ],
  webServer: LIVE && !LIVE_LOCAL ? undefined : {
    command: PROD || LIVE ? `node e2e/support/serve-prod.mjs` : `pnpm exec next dev --port ${PORT}`,
    url: `${baseURL}/login`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !!process.env.E2E_REUSE_SERVER, // dev only: keep a warm `next dev --port 3500` running
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
