#!/usr/bin/env node
// Denylist check: no identifier of this private instance may appear in product code.
//
//   node scripts/denylist.mjs            exit 1 and a list of hits when a term leaks
//
// The terms live in the private overlay file (`denylist` in kortex.instance.json: `terms` match
// anywhere and ignore case, `words` match as whole words, `privatePaths` are the git pathspecs
// that stay private and may contain them). More terms can come from KORTEX_DENYLIST (comma list).
// Without any term (the open-source repository has no overlay file) the check passes.
// It reads tracked and new, not ignored files; binary files are skipped.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadInstance } from "./lib/instance.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Terms, words and private paths from the overlay file plus KORTEX_DENYLIST. */
export function denylistConfig(instance = {}, env = process.env) {
  const list = (v) => (Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean);
  const d = instance.denylist ?? {};
  const extra = String(env.KORTEX_DENYLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    terms: [...new Set([...list(d.terms), ...extra])],
    words: [...new Set(list(d.words))],
    privatePaths: list(d.privatePaths),
  };
}

function grep(root, patterns, privatePaths, extraArgs) {
  if (patterns.length === 0) return [];
  const args = ["grep", "--untracked", "-I", "-n", "-F", ...extraArgs];
  for (const p of patterns) args.push("-e", p);
  args.push("--", ".", ...privatePaths.map((p) => `:(exclude)${p}`));
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 1) return []; // git grep: nothing found
  if (r.status !== 0) throw new Error(`git grep failed: ${(r.stderr || "").trim()}`);
  return r.stdout.split("\n").filter(Boolean);
}

/** Whether `text` still carries a denied term once the published forms are taken out. */
function stillDenied(text, cfg) {
  let rest = text;
  for (const allowed of cfg.publicIdentifiers ?? []) rest = rest.split(allowed).join(" ");
  const lower = rest.toLowerCase();
  if (cfg.terms.some((t) => lower.includes(t.toLowerCase()))) return true;
  return cfg.words.some((w) =>
    new RegExp(`(^|\\W)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`).test(rest),
  );
}

/**
 * Every `file:line:text` that carries a denied term outside the private paths. An identifier the
 * owner decided to publish (`publicIdentifiers`, oss/export.json) is fine in exactly that form.
 */
export function scanDenylist(root, cfg) {
  const hits = [
    ...grep(root, cfg.terms, cfg.privatePaths, ["-i"]),
    ...grep(root, cfg.words, cfg.privatePaths, ["-w"]),
  ];
  const kept =
    (cfg.publicIdentifiers ?? []).length === 0 ? hits : hits.filter((h) => stillDenied(h, cfg));
  return [...new Set(kept)].sort();
}

/** The published identifiers of the open-source export, when this repository has one. */
export function publicIdentifiers(root) {
  const file = join(root, "oss", "export.json");
  if (!existsSync(file)) return [];
  const list = JSON.parse(readFileSync(file, "utf8")).publicIdentifiers;
  return (Array.isArray(list) ? list : []).map((s) => String(s)).filter(Boolean);
}

export function main(root = repoRoot, env = process.env, log = console) {
  const cfg = {
    ...denylistConfig(loadInstance(root), env),
    publicIdentifiers: publicIdentifiers(root),
  };
  if (cfg.terms.length + cfg.words.length === 0) {
    log.log("denylist: no terms configured, nothing to check");
    return 0;
  }
  const hits = scanDenylist(root, cfg);
  if (hits.length === 0) {
    log.log(`denylist: clean (${cfg.terms.length + cfg.words.length} terms)`);
    return 0;
  }
  log.error(`denylist: ${hits.length} hit(s) of private identifiers in product code:`);
  for (const h of hits) log.error(`  ${h.length > 220 ? `${h.slice(0, 220)}…` : h}`);
  log.error(
    "Replace them with a setting or a neutral example (example.com), or move the file to the private paths.",
  );
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
