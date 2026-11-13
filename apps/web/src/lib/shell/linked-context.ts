/*
 * Ghost context: the items a note links with [[...]] (or @, which is written as [[...]]) go to the
 * copilot as background in note mode. Shared by the server retrieval and the Footbar counter.
 */

/** At most this many linked items go along (token budget); see server/chat/retrieval.ts. */
export const LINKED_MAX_ITEMS = 5;

/** Titles of `[[Target|alias]]` / `[[Target#heading]]` / `![[Target]]` links in a note, in order, unique. */
export function extractLinkedTitles(md: string): string[] {
  // Links inside fenced or inline code are text, not references.
  const text = md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "").replace(/`[^`\n]*`/g, "");
  const out = new Set<string>();
  for (const m of text.matchAll(/\[\[([^[\]|\n]+)(?:\|[^[\]\n]*)?\]\]/g)) {
    const title = (m[1] ?? "").split("#")[0]!.trim();
    if (title) out.add(title);
  }
  return [...out];
}

/** How many of the note's links resolve to another item (what the copilot will actually get). */
export function countLinkedContext(md: string, ownId: string, items: readonly { id: string; title: string }[]): number {
  const titles = new Set(items.filter((i) => i.id !== ownId).map((i) => i.title.toLowerCase()));
  return Math.min(LINKED_MAX_ITEMS, extractLinkedTitles(md).filter((t) => titles.has(t.toLowerCase())).length);
}
