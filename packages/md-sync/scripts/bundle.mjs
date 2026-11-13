#!/usr/bin/env node
// One-file build of the daemon for the desktop sidecar: dist/md-sync.mjs (run with plain `node`).
// apps/desktop/scripts/build-sidecar.mjs copies it next to a node.exe into the Tauri resources.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const outfile = path.join(root, "dist", "md-sync.mjs");

await build({
  entryPoints: [path.join(root, "src", "cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // CommonJS dependencies call require(); give the ESM bundle one (named to avoid clashes).
  banner: {
    js: `import{createRequire as __kxCreateRequire}from"node:module";const require=__kxCreateRequire(import.meta.url);`,
  },
  legalComments: "none",
  logLevel: "warning",
});
console.log(`md-sync ${version} → ${path.relative(process.cwd(), outfile)}`);
