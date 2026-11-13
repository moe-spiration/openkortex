import type { ActionItem, KnowledgeItem } from "@/lib/workspace-data";

/*
 * Smart Object footer: everything linked to an item, grouped semantically
 * (Verknüpfte Meetings, Offene Action Items, Erwähnungen & Dokumente). Links count both ways:
 * the item's own [[links]] and every item that links to it.
 */

export interface BacklinkGroups {
  meetings: KnowledgeItem[];
  actions: { item: KnowledgeItem; action: ActionItem }[];
  mentions: KnowledgeItem[];
}

export function relatedItems(item: KnowledgeItem, all: Record<string, KnowledgeItem>): KnowledgeItem[] {
  const ids = new Set(item.links);
  for (const other of Object.values(all)) if (other.id !== item.id && other.links.includes(item.id)) ids.add(other.id);
  ids.delete(item.id);
  return [...ids].map((id) => all[id]).filter((x): x is KnowledgeItem => !!x);
}

export function groupBacklinks(item: KnowledgeItem, all: Record<string, KnowledgeItem>): BacklinkGroups {
  const related = relatedItems(item, all);
  const byDate = (a: KnowledgeItem, b: KnowledgeItem) => (a.date + a.time < b.date + b.time ? 1 : -1);
  return {
    meetings: related.filter((r) => r.type === "meeting").sort(byDate),
    actions: related.flatMap((r) => r.actionItems.filter((a) => !a.done).map((action) => ({ item: r, action }))),
    mentions: related.filter((r) => r.type !== "meeting").sort(byDate),
  };
}

const sameList = <T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean) => a.length === b.length && a.every((x, i) => eq(x, b[i]!));

/** Same groups (same item objects in the same order): the footer need not re-render (a keystroke in the note itself). */
export function sameBacklinkGroups(a: BacklinkGroups, b: BacklinkGroups): boolean {
  return (
    sameList(a.meetings, b.meetings, Object.is) &&
    sameList(a.mentions, b.mentions, Object.is) &&
    sameList(a.actions, b.actions, (x, y) => x.item === y.item && x.action === y.action)
  );
}

/** Most recent linked meeting (the person pill "Letztes Meeting"). */
export function lastMeeting(item: KnowledgeItem, all: Record<string, KnowledgeItem>): KnowledgeItem | undefined {
  return groupBacklinks(item, all).meetings[0];
}
