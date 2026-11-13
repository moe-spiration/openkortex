import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { E2EUser } from "./admin";

/*
 * Run artefacts live in the OS temp dir, not inside apps/web: the Next dev server watches the
 * project folder and recompiles (dropping in-flight server actions) when files appear there.
 */
export const RUN_DIR = join(tmpdir(), "kortex-e2e");
export const USER_FILE = join(RUN_DIR, "user.json");
export const STATE_FILE = join(RUN_DIR, "state.json");

/**
 * `pnpm e2e:live`: against a deployed Kortex (E2E_BASE_URL, or webUrl in kortex.instance.json)
 * with the dedicated staging account from .env.local (KORTEX_E2E_EMAIL / KORTEX_E2E_PASSWORD).
 * The account stays; everything the run creates is deleted in global-teardown.
 */
export const LIVE = process.env.E2E_LIVE === "1" || process.argv.includes("--project=live");
export const LIVE_BASE_URL = (process.env.E2E_BASE_URL?.trim() || instanceWebUrl() || "").replace(/\/+$/, "");
if (LIVE && !LIVE_BASE_URL) throw new Error("e2e:live needs E2E_BASE_URL (the deployed Kortex to test against)");

/** The deployment's own address from the private overlay file in the repository root, if there is one. */
function instanceWebUrl(): string | undefined {
  const file = resolve(process.cwd(), "../../kortex.instance.json");
  if (!existsSync(file)) return undefined;
  return (JSON.parse(readFileSync(file, "utf8")) as { webUrl?: string }).webUrl;
}

export function loadUser(): E2EUser {
  return JSON.parse(readFileSync(USER_FILE, "utf8")) as E2EUser;
}
