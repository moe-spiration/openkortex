import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { providerKeys } from "@kortex/ai-core";
import { isUuid } from "./paths";
import type { LocalDeleteMode } from "./engine";

/**
 * How the daemon reaches Supabase:
 * - `service`: CLI / server with `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS, scoped to KORTEX_USER_ID in code).
 * - `token`: desktop sidecar with the user's personal `kx_` token (scope `sync`). The web app trades it
 *   for a short-lived user JWT (`POST /api/sync/session`), so everything runs under RLS. No service key.
 */
export type DaemonAuth =
  | { mode: "service"; userId: string; supabaseUrl: string; serviceRoleKey: string }
  | { mode: "token"; apiUrl: string; token: string };

export interface DaemonConfig {
  vaultPath: string;
  auth: DaemonAuth;
  localDeleteMode: LocalDeleteMode;
  reconcileIntervalMs: number;
  allowMassDelete: boolean;
  usePolling: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  ingest: IngestConfig;
  dropzone: DropzoneConfig;
}

export interface DropzoneConfig {
  enabled: boolean;
  /** Files above this size are not handed over (moved to `.failed`). */
  maxBytes: number;
  /** Allowed extensions, lower case, without dot. */
  extensions: string[];
}

export const DEFAULT_DROPZONE_EXTENSIONS: readonly string[] = [
  "pdf", "epub", "png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "avif",
  "mp3", "m4a", "wav", "ogg", "flac", "webm", "eml", "txt",
];

/** KORTEX_SYNC_DROPZONE (default on), KORTEX_SYNC_DROPZONE_MAX_MB (default 50), KORTEX_SYNC_DROPZONE_TYPES. */
export function readDropzoneConfig(env: NodeJS.ProcessEnv = process.env): DropzoneConfig {
  const off = ["0", "false", "off"].includes((env.KORTEX_SYNC_DROPZONE ?? "").trim().toLowerCase());
  const mb = Number(env.KORTEX_SYNC_DROPZONE_MAX_MB ?? 50);
  const listed = (env.KORTEX_SYNC_DROPZONE_TYPES ?? "")
    .split(",")
    .map((e) => e.trim().replace(/^\./, "").toLowerCase())
    .filter((e) => e && e !== "md");
  return {
    enabled: !off,
    maxBytes: Math.floor((Number.isFinite(mb) && mb > 0 ? mb : 50) * 1024 * 1024),
    extensions: listed.length ? [...new Set(listed)] : [...DEFAULT_DROPZONE_EXTENSIONS],
  };
}

export interface IngestConfig {
  /** Off when KORTEX_SYNC_INGEST=0 or no ADR-06 provider key (Anthropic, OpenRouter, Eden AI) is set. */
  enabled: boolean;
  /** Why it is off (for the startup log). */
  disabledReason: string | null;
  folders: string[];
  debounceMs: number;
}

/** KORTEX_SYNC_INGEST (default on), KORTEX_SYNC_INGEST_FOLDERS, KORTEX_SYNC_INGEST_DEBOUNCE_MS. */
export function readIngestConfig(env: NodeJS.ProcessEnv = process.env): IngestConfig {
  const off = ["0", "false", "off"].includes((env.KORTEX_SYNC_INGEST ?? "").trim().toLowerCase());
  // ADR-06: any provider key is enough; which task runs where comes from the user's routing.
  const hasKey = Object.keys(providerKeys(env)).length > 0;
  const folders = (env.KORTEX_SYNC_INGEST_FOLDERS ?? "40_AI_Memories")
    .split(",")
    .map((f) =>
      f
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, ""),
    )
    .filter(Boolean);
  const debounce = Number(env.KORTEX_SYNC_INGEST_DEBOUNCE_MS ?? 3000);
  return {
    enabled: !off && hasKey && folders.length > 0,
    disabledReason: off
      ? "KORTEX_SYNC_INGEST=0"
      : !hasKey
        ? "no AI provider key (ANTHROPIC_API_KEY / CLAUDE_API_KEY, OPENROUTER_API_KEY, EDENAI_API_KEY)"
        : folders.length === 0
          ? "KORTEX_SYNC_INGEST_FOLDERS is empty"
          : null,
    folders,
    debounceMs: Number.isFinite(debounce) && debounce >= 0 ? debounce : 3000,
  };
}

/**
 * Loads `.env.local` / `.env` (first match wins per key, real env vars always win).
 * Lets the daemon run from the repo root config without a dotenv dependency.
 */
export function loadEnvFiles(files: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const loaded: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const parsed = parseEnv(readFileSync(file, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined && value !== undefined) env[key] = value;
    }
    loaded.push(file);
  }
  return loaded;
}

/**
 * Windows extended-length paths back to the normal form: `\\?\C:\x` -> `C:\x`,
 * `\\?\UNC\srv\share` -> `\\srv\share`. Node's realpath trips over the prefix
 * (`EISDIR: lstat 'C:'`), and Tauri hands such paths out on Windows.
 */
export function plainWindowsPath(p: string): string {
  if (/^\\\\\?\\UNC\\/i.test(p)) return `\\\\${p.slice(8)}`;
  if (/^\\\\\?\\[a-z]:/i.test(p)) return p.slice(4);
  return p;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const missing: string[] = [];
  const need = (...keys: string[]) => {
    for (const k of keys) {
      const v = env[k]?.trim();
      if (v) return v;
    }
    missing.push(keys.join(" | "));
    return "";
  };
  const vaultPath = need("KORTEX_VAULT_PATH");
  const token = env.KORTEX_SYNC_TOKEN?.trim();
  let auth: DaemonAuth;
  if (token) {
    const apiUrl = need("KORTEX_API_URL");
    if (missing.length) throw new ConfigError(`missing env: ${missing.join(", ")}`);
    if (!/^kx_[A-Za-z0-9_-]{43}$/.test(token))
      throw new ConfigError("KORTEX_SYNC_TOKEN must be a personal kx_ token");
    if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/i.test(apiUrl))
      throw new ConfigError("KORTEX_API_URL must be https:// (or http://localhost)");
    auth = { mode: "token", apiUrl: apiUrl.replace(/\/+$/, ""), token };
  } else {
    const userId = need("KORTEX_USER_ID");
    const supabaseUrl = need("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = need("SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length)
      throw new ConfigError(`missing env: ${missing.join(", ")} (or KORTEX_SYNC_TOKEN + KORTEX_API_URL)`);
    if (!isUuid(userId)) throw new ConfigError("KORTEX_USER_ID must be the Supabase auth user uuid");
    if (serviceRoleKey.startsWith("<"))
      throw new ConfigError("SUPABASE_SERVICE_ROLE_KEY is a placeholder");
    auth = { mode: "service", userId: userId.toLowerCase(), supabaseUrl, serviceRoleKey };
  }

  const deleteMode = (env.KORTEX_SYNC_DELETE_MODE ?? "archive").trim();
  if (deleteMode !== "archive" && deleteMode !== "delete") {
    throw new ConfigError("KORTEX_SYNC_DELETE_MODE must be 'archive' or 'delete'");
  }
  const minutes = Number(env.KORTEX_SYNC_RECONCILE_MINUTES ?? 10);
  const level = (env.KORTEX_SYNC_LOG_LEVEL ?? "info").trim() as DaemonConfig["logLevel"];
  const flag = (v: string | undefined) => v === "1" || v?.toLowerCase() === "true";

  return {
    vaultPath: path.resolve(
      plainWindowsPath(vaultPath).replace(/^~(?=$|[\\/])/, process.env.USERPROFILE ?? process.env.HOME ?? "~"),
    ),
    auth,
    localDeleteMode: deleteMode,
    reconcileIntervalMs: Number.isFinite(minutes) && minutes >= 0 ? minutes * 60_000 : 600_000,
    allowMassDelete: flag(env.KORTEX_SYNC_ALLOW_MASS_DELETE),
    usePolling: flag(env.KORTEX_SYNC_USE_POLLING),
    logLevel: ["debug", "info", "warn", "error"].includes(level) ? level : "info",
    // Token mode: AI enrichment of vault files stays on the server, the PC holds no provider keys.
    ingest:
      auth.mode === "token"
        ? { ...readIngestConfig(env), enabled: false, disabledReason: "token mode (desktop sidecar)" }
        : readIngestConfig(env),
    dropzone: readDropzoneConfig(env),
  };
}
