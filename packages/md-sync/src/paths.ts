import path from "node:path";

/** Case-insensitive file systems (NTFS, APFS default): compare vault paths case-insensitively. */
export const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

/** Key for comparing vault-relative paths. */
export const pathKey = (rel: string) => (CASE_INSENSITIVE_FS ? rel.toLowerCase() : rel);
export const samePath = (a: string | null | undefined, b: string | null | undefined) =>
  a != null && b != null && pathKey(a) === pathKey(b);

// Windows forbids these characters and control characters in names.
// eslint-disable-next-line no-control-regex
const INVALID_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const MAX_NAME_LENGTH = 100;

/**
 * Turns a slug/title/folder name into a single Windows-safe path segment.
 * Keeps readable names ("My Note" stays "My Note"); only strips what the OS rejects
 * or what the sync would ignore (leading dots = hidden, `.conflict-` = conflict copies).
 */
export function sanitizeName(input: string, fallback = "untitled"): string {
  let s = input
    .normalize("NFC")
    .replace(INVALID_NAME_CHARS, "-")
    .replace(/\s+/g, " ")
    .replace(/\.conflict-/gi, "-conflict-")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  if (s.length > MAX_NAME_LENGTH) s = s.slice(0, MAX_NAME_LENGTH).replace(/[.\s]+$/, "");
  if (!s) s = fallback;
  if (RESERVED_WINDOWS_NAMES.test(s.split(".")[0] ?? s)) s = `${s}_`;
  return s;
}

/** URL/DB-style slug for folders (`Mercedes-AMG` -> `mercedes-amg`), like the system folders. */
export function slugify(input: string): string {
  const s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "folder";
}

/** Normalises a DB folder_path ("10_Notes\\A/", "/x") into vault-relative posix segments. */
export function normalizeFolderPath(folderPath: string | null | undefined): string {
  return (folderPath ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .join("/");
}

/** Folder path as it exists on disk (every segment Windows-safe). */
export function localFolderPath(folderPath: string): string {
  return normalizeFolderPath(folderPath)
    .split("/")
    .filter(Boolean)
    .map((seg) => sanitizeName(seg, "folder"))
    .join("/");
}

export const joinRel = (...parts: string[]) => parts.filter(Boolean).join("/");
export const dirnameRel = (rel: string) => {
  const i = rel.lastIndexOf("/");
  return i === -1 ? "" : rel.slice(0, i);
};
export const basenameRel = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);
/** "10_Notes/My Note.md" -> "My Note" */
export const stemOf = (rel: string) => basenameRel(rel).replace(/\.md$/i, "");

export const isMarkdownPath = (rel: string) => /\.md$/i.test(rel);
export const CONFLICT_FILE_PATTERN = /\.conflict-[^/]*\.md$/i;
export const isConflictFile = (rel: string) => CONFLICT_FILE_PATTERN.test(rel);

/** The agents guide in the vault root, written by the daemon and never synced as an item. */
export const VAULT_AGENTS_FILE = "agents.md";

/**
 * Vault-relative paths the daemon never syncs: dot-files/-folders (`.kortex`, `.obsidian`,
 * atomic-write temp files), `node_modules`, `*.tmp`, conflict copies and the root `agents.md`.
 */
export function isIgnoredRel(rel: string): boolean {
  if (!rel) return false;
  if (pathKey(rel) === pathKey(VAULT_AGENTS_FILE)) return true;
  const segments = rel.split("/");
  if (segments.some((s) => s.startsWith(".") || s === "node_modules")) return true;
  if (/\.tmp$/i.test(rel)) return true;
  return isConflictFile(rel);
}

/** A markdown file that takes part in the sync. */
export const isSyncableFile = (rel: string) => isMarkdownPath(rel) && !isIgnoredRel(rel);

export function toRel(vaultPath: string, absPath: string): string {
  const rel = path.relative(vaultPath, absPath);
  return rel.split(path.sep).join("/");
}

export function toAbs(vaultPath: string, rel: string): string {
  return rel ? path.join(vaultPath, ...rel.split("/")) : vaultPath;
}

/** `20261023T101500Z` - sortable and Windows-safe. */
export function compactTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_PATTERN.test(v);
