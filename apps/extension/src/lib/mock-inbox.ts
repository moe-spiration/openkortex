import type { MockInboxEntry } from "./api";
import type { KeyValueStore } from "./settings";

const KEY = "mockInbox";
const MAX = 50;

export async function appendMockInbox(store: KeyValueStore, entry: MockInboxEntry) {
  const list = (await store.get<MockInboxEntry[]>(KEY)) ?? [];
  await store.set(KEY, [entry, ...list].slice(0, MAX));
}

export const readMockInbox = async (store: KeyValueStore) => (await store.get<MockInboxEntry[]>(KEY)) ?? [];
export const clearMockInbox = (store: KeyValueStore) => store.remove(KEY);

/** Inline highlights are re-applied when the user revisits a page. */
export interface StoredHighlight {
  id: string;
  locator: import("./api").HighlightLocator;
  savedAt: string;
  /** Server id (item_highlights.id), set when Kortex confirmed the highlight; needed to remove it there. */
  highlightId?: string;
}
const hlKey = (url: string) => `hl:${url.split("#")[0]}`;

export async function loadPageHighlights(store: KeyValueStore, url: string) {
  return (await store.get<StoredHighlight[]>(hlKey(url))) ?? [];
}
export async function addPageHighlight(store: KeyValueStore, url: string, h: StoredHighlight) {
  const list = await loadPageHighlights(store, url);
  await store.set(hlKey(url), [...list.filter((x) => x.id !== h.id), h].slice(-200));
}

export async function removePageHighlight(store: KeyValueStore, url: string, id: string) {
  const list = await loadPageHighlights(store, url);
  const hit = list.find((x) => x.id === id) ?? null;
  await store.set(hlKey(url), list.filter((x) => x.id !== id));
  return hit;
}
