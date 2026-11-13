import { useRef } from "react";
import type { WikiLinkTarget } from "@kortex/ui/editor";
import type { KnowledgeItem } from "@/lib/workspace-data";

/*
 * Targets of the [[ autocomplete: every other item (notes and objects). Typing changes only the open note's object in
 * the store, so the list is rebuilt only when another item appears, disappears or gets a new title or path (fx2-perf:
 * the old string join over up to 1,500 items ran on every keystroke and handed the editor a new list each time).
 */

/** True when every item other than `selfId` has the same id, title and path in both maps. No allocation. */
export function sameLinkTargets(prev: Record<string, KnowledgeItem>, next: Record<string, KnowledgeItem>, selfId: string): boolean {
  if (prev === next) return true;
  let n = 0;
  for (const id in next) {
    n++;
    if (id === selfId) continue;
    const a = prev[id];
    const b = next[id]!;
    if (!a) return false;
    if (a !== b && (a.title !== b.title || a.path !== b.path)) return false;
  }
  return n === Object.keys(prev).length;
}

export function buildWikiTargets(items: Record<string, KnowledgeItem>, selfId: string): WikiLinkTarget[] {
  const out: WikiLinkTarget[] = [];
  for (const i of Object.values(items)) if (i.id !== selfId) out.push({ id: i.id, title: i.title, path: i.path });
  return out;
}

/** The [[ targets for note `selfId`; the same array while only the note's own text (or other content) changes. */
export function useWikiTargets(items: Record<string, KnowledgeItem>, selfId: string): WikiLinkTarget[] {
  const ref = useRef<{ items: Record<string, KnowledgeItem>; selfId: string; targets: WikiLinkTarget[] } | null>(null);
  const cur = ref.current;
  if (!cur || cur.selfId !== selfId || !sameLinkTargets(cur.items, items, selfId)) {
    ref.current = { items, selfId, targets: buildWikiTargets(items, selfId) };
  } else cur.items = items;
  return ref.current!.targets;
}
