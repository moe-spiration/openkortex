import type { KnowledgeItem } from "@/lib/mock/types";

/*
 * Merging a newly installed workspace snapshot into the notes store (live mode). The store copies
 * items once for optimistic editing; without this merge, items captured after the first load
 * (capture → router.refresh() → new snapshot) were missing from the store, so their note sheet
 * opened empty and edits went nowhere.
 *
 * Rules: items the store does not know are added; known items are replaced only when the server
 * copy is newer (updated_at) and the item has no unsaved local edit (`dirty`). Items that vanished
 * from the snapshot stay (the snapshot is capped; deleting is explicit elsewhere).
 */
export function mergeSnapshotItems(
  local: Readonly<Record<string, KnowledgeItem>>,
  incoming: readonly KnowledgeItem[],
  dirty: ReadonlySet<string> = new Set(),
): Record<string, KnowledgeItem> | null {
  let next: Record<string, KnowledgeItem> | null = null;
  for (const item of incoming) {
    const cur = local[item.id];
    const newer = !!cur && !!item.updatedAt && (!cur.updatedAt || item.updatedAt > cur.updatedAt);
    if (cur && (!newer || dirty.has(item.id))) continue;
    next ??= { ...local };
    next[item.id] = { ...item };
  }
  return next;
}
