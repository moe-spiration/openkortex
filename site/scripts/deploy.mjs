#!/usr/bin/env node
// Uploads site/dist to the Cloudflare Pages project in site/site.json (Direct Upload, no Git link).
// Needs CLOUDFLARE_API_TOKEN (permission "Cloudflare Pages: Edit") and CLOUDFLARE_ACCOUNT_ID in the
// environment, or a one-time `npx wrangler login`. Build first: pnpm site:build.
// Usage: node site/scripts/deploy.mjs [--branch main] [--dir site/dist]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const dir = resolve(arg("--dir", join(root, "site/dist")));
const { cloudflareProject } = JSON.parse(readFileSync(join(root, "site/site.json"), "utf8"));
if (!existsSync(join(dir, "index.html")) || !existsSync(join(dir, "home.html"))) {
  console.error(`site: ${dir} has no complete build (website and demo); run pnpm site:build first`);
  process.exit(1);
}
// Wrangler is pinned and fetched on demand, so it is not a dependency of the repository.
const r = spawnSync(
  "npx",
  ["--yes", "wrangler@4.156.0", "pages", "deploy", dir, "--project-name", cloudflareProject, "--branch", arg("--branch", "main"), "--commit-dirty=true"],
  { stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(r.status ?? 1);
