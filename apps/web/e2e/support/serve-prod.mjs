// Serves the PRODUCTION build for `pnpm e2e:prod` (Playwright webServer).
// - Standalone output present (NEXT_OUTPUT=standalone build, Linux/Docker): lays out static files
//   and public/ exactly like apps/web/Dockerfile and runs `node apps/web/server.js`.
// - Otherwise: `next start` on the regular build (Windows cannot create the standalone symlinks).
// Env (Supabase keys, service role) comes from apps/web/.env.local, loaded by playwright.config.ts.
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = process.env.PORT ?? "3500";
const root = join(web, ".next", "standalone");
const server = join(root, "apps", "web", "server.js");

let child;
if (existsSync(server)) {
  const staticDst = join(root, "apps", "web", ".next", "static");
  const publicDst = join(root, "apps", "web", "public");
  if (!existsSync(staticDst)) cpSync(join(web, ".next", "static"), staticDst, { recursive: true });
  if (!existsSync(publicDst) && existsSync(join(web, "public"))) cpSync(join(web, "public"), publicDst, { recursive: true });
  console.log(`[e2e:prod] standalone server.js on :${port}`);
  child = spawn(process.execPath, [server], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production", PORT: port, HOSTNAME: "127.0.0.1" },
  });
} else {
  if (!existsSync(join(web, ".next", "BUILD_ID"))) {
    console.error("[e2e:prod] no production build: run `pnpm --filter @kortex/web build` first");
    process.exit(1);
  }
  console.log(`[e2e:prod] next start on :${port}`);
  child = spawn("pnpm", ["exec", "next", "start", "--port", port], {
    cwd: web,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, NODE_ENV: "production" },
  });
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
