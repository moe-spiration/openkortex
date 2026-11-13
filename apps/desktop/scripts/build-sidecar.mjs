#!/usr/bin/env node
// Vault sync sidecar for the installer (src-tauri/src/vault.rs): bundles md-sync into one file and
// puts it next to a Node runtime in src-tauri/sidecar/, which tauri.conf.json ships as resources.
//
//   node scripts/build-sidecar.mjs            (runs as part of `tauri build`, beforeBuildCommand)
//
// The Node runtime is the one running this script (`process.execPath`), so the installer carries
// the same Node version the repo is built and tested with. KORTEX_SIDECAR_NODE overrides it.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const out = path.resolve(here, "../src-tauri/sidecar");

execSync("pnpm --filter @kortex/md-sync bundle", { cwd: repo, stdio: "inherit" });
const bundle = path.join(repo, "packages/md-sync/dist/md-sync.mjs");
if (!existsSync(bundle)) throw new Error(`bundle missing: ${bundle}`);

mkdirSync(out, { recursive: true });
copyFileSync(bundle, path.join(out, "md-sync.mjs"));
const node = process.env.KORTEX_SIDECAR_NODE || process.execPath;
const nodeName = process.platform === "win32" ? "node.exe" : "node";
copyFileSync(node, path.join(out, nodeName));
// License texts of the shipped dependencies, when the release workflow generated them
// (scripts/third-party-notices.mjs): the installer carries them next to the runtime they cover.
const notices = path.join(repo, "THIRD-PARTY-NOTICES.md");
if (existsSync(notices)) copyFileSync(notices, path.join(out, "THIRD-PARTY-NOTICES.md"));

const mb = (f) => (statSync(path.join(out, f)).size / 1024 / 1024).toFixed(1);
console.log(
  `sidecar: md-sync.mjs ${mb("md-sync.mjs")} MB, ${nodeName} ${process.version} ${mb(nodeName)} MB → ${path.relative(repo, out)}`,
);
