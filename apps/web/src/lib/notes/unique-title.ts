import { tx } from "@/i18n";

/**
 * W-06: a title no other item has (case-insensitive): "Neue Unterseite", then "Neue Unterseite 2", "… 3".
 * Sub-pages are embedded as `![[Title]]`, which resolves by title, so equal titles all opened the first page.
 */
export function uniqueTitle(base: string, taken: readonly string[]): string {
  const title = base.trim() || tx("file", "Untitled");
  const have = new Set(taken.map((x) => x.trim().toLowerCase()));
  if (!have.has(title.toLowerCase())) return title;
  for (let n = 2; ; n++) {
    const next = `${title} ${n}`;
    if (!have.has(next.toLowerCase())) return next;
  }
}
