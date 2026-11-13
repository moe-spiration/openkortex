import { t } from "@/i18n";
/* Personal API tokens: `kx_` + 43 base64url chars (256 bit). Only the SHA-256 hex digest is stored. */

export const TOKEN_PREFIX = "kx_";
export const TOKEN_PATTERN = /^kx_[A-Za-z0-9_-]{43}$/;
export const MAX_ACTIVE_TOKENS = 10;
export const NAME_MAX = 80;

/**
 * What a token may be used for. `ingest` = capture: /api/ingest and the audio-to-text step before
 * it. `search` = read: GET /api/search (desktop launcher) and live coaching. `ask` = POST /api/chat
 * (launcher "Fragen": a copilot answer over the owner's vault, read only). A token gets `search` and
 * `ask` only when requested at creation, so existing capture-only tokens never gain read access.
 * `sync` = vault sync on the PC (desktop sidecar): POST /api/sync/session trades the token for a
 * short-lived user JWT, i.e. read and write of the whole vault under RLS. Only the desktop connect
 * flow asks for it.
 */
export const TOKEN_SCOPES = ["ingest", "search", "ask", "sync"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
export const DEFAULT_SCOPES: TokenScope[] = ["ingest"];

/** Scopes of a new token: capture always, search, ask and sync only on request. */
export const scopesFor = (opts: { search?: boolean; ask?: boolean; sync?: boolean } = {}): TokenScope[] => [
  ...DEFAULT_SCOPES,
  ...(opts.search ? (["search"] as const) : []),
  ...(opts.ask ? (["ask"] as const) : []),
  ...(opts.sync ? (["sync"] as const) : []),
];

export const looksLikePersonalToken = (value: string): boolean => TOKEN_PATTERN.test(value);

/**
 * The scope a request needs, or null when personal tokens are not accepted there at all.
 * `method` only matters for the live meeting routes (desktop HUD): a token may write a live session
 * (POST, capture) but never read one back (GET).
 */
export function scopeForPath(pathname: string, method = "GET"): TokenScope | null {
  if (pathname === "/api/ingest" || pathname.startsWith("/api/ingest/")) return "ingest";
  // Voice notes and meetings from the desktop: transcribe first, then capture through /api/ingest.
  if (pathname === "/api/chat/transcribe") return "ingest";
  // Web clipper: snooze the clip it just saved (sets remind_at of one item).
  if (pathname === "/api/reminder") return method.toUpperCase() === "POST" ? "ingest" : null;
  // Web clipper: remove a highlight it saved (only the owner's item_highlights row).
  if (pathname === "/api/highlight") return method.toUpperCase() === "POST" ? "ingest" : null;
  // Due reminders and unseen radar changes (desktop tray, Android): read only.
  if (pathname === "/api/reminders/due") return method.toUpperCase() === "GET" ? "search" : null;
  // Desktop launcher: hybrid search over the owner's vault (read only).
  if (pathname === "/api/search") return "search";
  const post = method.toUpperCase() === "POST";
  // Desktop live meeting: start, append, clip, task, end of the session item (capture).
  if (pathname === "/api/meeting/live") return post ? "ingest" : null;
  // Live coaching reads the vault (full-text matches, open tasks): the read scope.
  if (pathname === "/api/meeting/coach") return post ? "search" : null;
  // Launcher "Fragen": streaming copilot answer; retrieval runs scoped to the token's owner.
  if (pathname === "/api/chat") return post ? "ask" : null;
  // Desktop vault sync: trades the token for a user JWT (md-sync sidecar, RLS as the owner).
  if (pathname === "/api/sync/session") return post ? "sync" : null;
  return null;
}

export interface ApiTokenRow {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

/** `active` | `revoked` | `expired` for display and for the list ordering. */
export function tokenState(row: Pick<ApiTokenRow, "revoked_at" | "expires_at">, now: Date): "active" | "revoked" | "expired" {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return "expired";
  return "active";
}

export function cleanName(input: string): string {
  const name = input.replace(/\s+/g, " ").trim();
  if (!name) throw new Error(t("Please enter a name, e.g. “Chrome on the laptop”."));
  if (name.length > NAME_MAX) throw new Error(t("Name is too long (max. {max} characters).", { max: NAME_MAX }));
  return name;
}
