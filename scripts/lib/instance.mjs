// Instance defaults of a private Kortex deployment.
//
// The product code carries no server address: every client (Windows app, Android app, browser
// extension) asks for its server on first start, and the web app and scripts read theirs from the
// environment. A deployment that wants its own builds to come preconfigured keeps a
// `kortex.instance.json` in the repository root (private overlay, never part of the open-source
// export). Build and ops scripts read their defaults from it through this module; a missing file
// means "no defaults".
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const INSTANCE_FILE = "kortex.instance.json";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const clean = (v) => (typeof v === "string" && v.trim() ? v.trim().replace(/\/+$/, "") : undefined);

/** The parsed instance file, or `{}` when there is none. A broken file throws: silent defaults would hide it. */
export function loadInstance(root = repoRoot) {
  const file = join(root, INSTANCE_FILE);
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return {
    ...raw,
    webUrl: clean(raw.webUrl),
    supabaseUrl: clean(raw.supabaseUrl),
    mcpUrl: clean(raw.mcpUrl),
    coolifyUrl: clean(raw.coolifyUrl),
  };
}

/**
 * Environment additions for a client build: the instance addresses under the names each toolchain
 * inlines (Expo `EXPO_PUBLIC_*`, WXT `WXT_*`, Vite `VITE_*`, cargo `KORTEX_DEFAULT_*`). Values already
 * set in `env` win, so a single build can still point somewhere else.
 */
export function instanceBuildEnv(env = process.env, root = repoRoot) {
  const { webUrl, supabaseUrl } = loadInstance(root);
  const out = {};
  const put = (key, value) => {
    if (value && !env[key]?.trim()) out[key] = value;
  };
  put("EXPO_PUBLIC_KORTEX_URL", webUrl);
  put("EXPO_PUBLIC_SUPABASE_URL", supabaseUrl);
  put("WXT_KORTEX_DEFAULT_URL", webUrl);
  put("VITE_KORTEX_WEB_URL", webUrl);
  put("KORTEX_DEFAULT_WEB_URL", webUrl);
  put("KORTEX_DEFAULT_SUPABASE_URL", supabaseUrl);
  return out;
}
