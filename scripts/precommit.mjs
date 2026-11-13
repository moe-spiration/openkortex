// Runs typecheck + lint on packages affected since HEAD^1 (fast, cached by turbo).
// Tests are NOT part of the hook: the merge gate (scripts/merge-branch.mjs -> `pnpm check`) runs them
// before anything reaches main. Opt in locally with KORTEX_HOOK_TESTS=1 to add `test` to the hook.
// Falls back to a full run when HEAD^1 doesn't exist (first commits).
// --concurrency=2 keeps vitest workers reliable on Windows (same as `pnpm check`).
import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function hasRef(ref) {
  try {
    execSync(`git rev-parse --verify --quiet ${ref}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Turbo arguments for the hook; exported for the test. */
export function hookArgs({ withTests = process.env.KORTEX_HOOK_TESTS === "1", hasParent = hasRef("HEAD^1") } = {}) {
  const args = ["turbo", "run", "typecheck", "lint"];
  if (withTests) args.push("test");
  args.push("--concurrency=2");
  if (hasParent) args.push("--filter=...[HEAD^1]");
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // one command line instead of (command, args) + shell: true, which Node deprecates (DEP0190)
  const res = spawnSync(["pnpm", ...hookArgs()].join(" "), { stdio: "inherit", shell: true });
  process.exit(res.status ?? 1);
}
