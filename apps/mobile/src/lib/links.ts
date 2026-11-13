/*
 * Wiki-links, backlinks and the folder tree on the phone (parity with the web note footer and folder sidebar).
 * Pure: no React Native import, so vitest covers it.
 */

/** `[[Title]]`, `[[Title|alias]]`, `[[Title#heading]]` and `![[Title]]` targets in a Markdown body (same rule as the web). */
export function wikiTitles(md: string): string[] {
  return [...md.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]!.trim()).filter(Boolean);
}

export interface Linkable {
  id: string;
  title: string;
  folder?: string;
  content?: string;
}

const norm = (s: string) => s.split("#")[0]!.trim().toLowerCase();

/** The entry a `[[target]]` points to: same title (any case) or a vault path ending in it, like the web editor. */
export function resolveWiki<E extends Linkable>(entries: readonly E[], target: string): E | undefined {
  const t = norm(target);
  if (!t) return undefined;
  return entries.find((e) => e.title.trim().toLowerCase() === t) ?? entries.find((e) => !!e.folder && `${e.folder}/${e.title}`.toLowerCase().endsWith(t));
}

/** Both link directions for `item` among `entries`: what it links to, and what links back to it. */
export function linksOf<E extends Linkable>(item: E, entries: readonly E[]): { out: E[]; back: E[] } {
  const out: E[] = [];
  for (const title of new Set(wikiTitles(item.content ?? "").map(norm))) {
    const hit = resolveWiki(entries, title);
    if (hit && hit.id !== item.id && !out.includes(hit)) out.push(hit);
  }
  const me = item.title.trim().toLowerCase();
  const back = me
    ? entries.filter((e) => e.id !== item.id && !out.includes(e) && wikiTitles(e.content ?? "").some((x) => norm(x) === me))
    : [];
  return { out, back };
}

/** Pattern for a SQL `ilike` that finds `[[title` literally (`%`, `_` and `\` escaped). */
export function wikiLikePattern(title: string): string {
  return `%[[${title.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Readable name of one folder segment: "30_Clippings" → "Clippings", "AI_Memories" → "AI Memories". */
export const folderLabel = (segment: string) => segment.replace(/^\d+_/, "").replace(/_/g, " ").trim() || segment;

export interface FolderNode {
  path: string;
  label: string;
}

/**
 * The folders directly below `parent` ("" = vault root), from every known folder path. Intermediate folders that
 * only exist as part of a deeper path count too. Sorted like the vault (numbered spaces first, then A to Z).
 */
export function childFolders(paths: readonly string[], parent: string): FolderNode[] {
  const prefix = parent ? `${parent}/` : "";
  const seen = new Set<string>();
  for (const p of paths) {
    if (!p || (prefix && !p.startsWith(prefix))) continue;
    const head = p.slice(prefix.length).split("/")[0];
    if (head) seen.add(prefix + head);
  }
  return [...seen]
    .map((path) => ({ path, label: folderLabel(path.split("/").pop()!) }))
    .sort((a, b) => {
      const an = /^\d+_/.test(a.path.split("/").pop()!);
      const bn = /^\d+_/.test(b.path.split("/").pop()!);
      return an !== bn ? (an ? -1 : 1) : an ? a.path.localeCompare(b.path) : a.label.localeCompare(b.label);
    });
}

/** Breadcrumb of a folder path: one node per segment, root first. */
export function folderTrail(path: string): FolderNode[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((seg, i) => ({ path: parts.slice(0, i + 1).join("/"), label: folderLabel(seg) }));
}

/** Parent of a folder path ("" for a top-level space). */
export const parentFolder = (path: string) => path.split("/").slice(0, -1).join("/");
