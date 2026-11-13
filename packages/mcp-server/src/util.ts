// Normalisation helpers shared by the tools and both repositories, so the in-memory
// and Supabase implementations agree on what a valid folder path / tag / slug is.

export class BrainError extends Error {
  override name = "BrainError";
}

// eslint-disable-next-line no-control-regex
const FORBIDDEN_SEGMENT_CHARS = /[<>:"|?*\\\u0000-\u001f]/;

/** "a//b/", "\\a\\b" -> "a/b". Rejects empty paths, "." / ".." and characters unsafe in a vault path. */
export function normalizeFolderPath(input: string): string {
  const segments = input
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) throw new BrainError("folder_path must not be empty");
  if (segments.length > 8) throw new BrainError("folder_path is nested too deeply (max 8 levels)");
  for (const s of segments) {
    if (s === "." || s === "..") throw new BrainError(`folder_path must not contain "${s}"`);
    if (FORBIDDEN_SEGMENT_CHARS.test(s) || s.length > 100) {
      throw new BrainError(`folder_path segment "${s}" contains unsupported characters`);
    }
  }
  return segments.join("/");
}

/** All ancestor paths including the path itself: "a/b/c" -> ["a", "a/b", "a/b/c"]. */
export function folderChain(folderPath: string): string[] {
  const parts = folderPath.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function isInFolder(itemFolder: string, folder: string): boolean {
  return itemFolder === folder || itemFolder.startsWith(`${folder}/`);
}

/** Lowercase, strip a leading "#", spaces -> "-". Hierarchical tags use "/" ("ai/mcp"). */
export function normalizeTag(input: string): string {
  const tag = input
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/|\/$/g, "");
  if (!tag || tag.length > 64 || !/^[\p{L}\p{N}_\-/]+$/u.test(tag)) {
    throw new BrainError(
      `Invalid tag "${input}": use letters, digits, "-", "_" and "/" (max 64 chars)`,
    );
  }
  return tag;
}

export function normalizeTags(inputs: readonly string[] | undefined): string[] {
  return [...new Set((inputs ?? []).map(normalizeTag))];
}

/** A filter tag matches an item tag when equal or when it is a hierarchical ancestor ("ai" ~ "ai/mcp"). */
export function tagMatches(itemTags: readonly string[], filterTag: string): boolean {
  return itemTags.some((t) => t === filterTag || t.startsWith(`${filterTag}/`));
}

export function slugify(input: string, fallback = "untitled"): string {
  const slug = input
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Accepts "2026-11-01" or a full ISO timestamp; returns a normalised ISO timestamp. */
export function normalizeDueDate(input: string): string {
  const t = Date.parse(input);
  if (Number.isNaN(t) || !/^\d{4}-\d{2}-\d{2}/.test(input)) {
    throw new BrainError(
      `Invalid due_date "${input}": use ISO 8601 (YYYY-MM-DD or full timestamp)`,
    );
  }
  return new Date(t).toISOString();
}

/** Every filter key equals the metadata value; for an array value the filter value must be in it. */
export function metadataMatches(
  metadata: Record<string, unknown> | null | undefined,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) return true;
  const meta = metadata ?? {};
  return Object.entries(filter).every(([key, want]) => {
    const have = meta[key];
    if (Array.isArray(have) && !Array.isArray(want)) return have.includes(want);
    return JSON.stringify(have) === JSON.stringify(want);
  });
}

/** Key-wise merge; a `null` in the patch removes the key. */
export function applyMetadataPatch(
  metadata: Record<string, unknown>,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!patch) return metadata;
  const out = { ...metadata };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

/** True when no due filter is given, or the reminder is set and at/before the limit. */
export function isDue(remindAt: string | null | undefined, dueBy: string | undefined): boolean {
  if (!dueBy) return true;
  return !!remindAt && Date.parse(remindAt) <= Date.parse(dueBy);
}
