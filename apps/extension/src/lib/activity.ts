// "Verlauf": what the server answered for the last live captures, kept locally so the options page can
// show where each item went (auto-placed folder) and whether the pipeline has finished.
import type { IngestRequest, IngestSuccess, ItemStatusInfo } from "./api";
import type { KeyValueStore } from "./settings";

const KEY = "activity";
const MAX = 20;

export interface ActivityEntry {
  /** ISO time the server accepted the capture. */
  at: string;
  /** `file` = an uploaded file (the popup's screenshot). */
  kind: IngestRequest["kind"] | "file";
  /** Page or chat title; for highlights the page title. */
  title: string;
  item_id: string;
  folder_path: string;
  auto_routed: boolean;
  status: IngestSuccess["status"];
  duplicate: boolean;
  replayed: boolean;
  /** Pipeline error reported by the server (status `error`). */
  error?: string;
}

/** Page or chat title of a request (highlights carry the page title). */
export const requestTitle = (req: IngestRequest) => (req.kind === "highlight" ? req.page_title : req.title);

export const toActivity = (request: IngestRequest, res: IngestSuccess, at: string): ActivityEntry => ({
  at,
  kind: request.kind,
  title: requestTitle(request),
  item_id: res.item_id,
  folder_path: res.folder_path,
  auto_routed: res.auto_routed,
  status: res.status,
  duplicate: res.duplicate,
  replayed: res.replayed === true,
});

export const readActivity = async (store: KeyValueStore) => (await store.get<ActivityEntry[]>(KEY)) ?? [];
export const clearActivity = (store: KeyValueStore) => store.remove(KEY);

/** Newest first; a repeated capture of the same item (merge/replay) updates its entry instead of adding one. */
export async function appendActivity(store: KeyValueStore, entry: ActivityEntry) {
  const list = await readActivity(store);
  const rest = list.filter((e) => !(e.item_id === entry.item_id && e.kind === entry.kind));
  await store.set(KEY, [entry, ...rest].slice(0, MAX));
}

/** Entries whose pipeline may still be running. */
export const isOpen = (e: Pick<ActivityEntry, "status">) => e.status === "inbox" || e.status === "processing";

/** Copies the server's current view (status, final folder, error) onto the stored entry. */
export async function applyStatus(store: KeyValueStore, info: ItemStatusInfo) {
  const list = await readActivity(store);
  let changed = false;
  const next = list.map((e) => {
    if (e.item_id !== info.item_id) return e;
    changed = true;
    return { ...e, status: info.status, folder_path: info.folder_path, error: info.error };
  });
  if (changed) await store.set(KEY, next);
  return next;
}
