// Local index of pages this browser captured (url -> item, folder, time). It drives the duplicate banner in the
// popup ("Already in Kortex since …", button "Add to it") and the side panel status line. The server stays the
// authority (packages/db dedup merges, never inserts twice); this only lets the UI say so before the click.
import type { KeyValueStore } from "./settings";

const KEY = "captured";
const MAX = 500;

export interface CapturedPage {
  item_id: string;
  folder_path: string;
  at: string;
  title?: string;
  /** Saved in local mode (mock): nothing reached a server. */
  local?: boolean;
  /** Hashtags the server suggested for this page (pre-selection next time). */
  tags?: string[];
}

/** Same page, other tracking: no hash, no utm_/fbclid/gclid, no trailing slash. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_|ref$)/i.test(k)) u.searchParams.delete(k);
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return url.split("#")[0]!;
  }
}

type Index = Record<string, CapturedPage>;

export async function findCapture(store: KeyValueStore, url: string): Promise<CapturedPage | null> {
  const all = (await store.get<Index>(KEY)) ?? {};
  return all[pageKey(url)] ?? null;
}

export async function rememberCapture(store: KeyValueStore, url: string, page: CapturedPage) {
  const all = (await store.get<Index>(KEY)) ?? {};
  const key = pageKey(url);
  // first capture time wins (the banner says "since"), the folder follows the latest answer
  const prev = all[key];
  all[key] = prev ? { ...prev, ...page, at: prev.at } : page;
  const entries = Object.entries(all);
  const kept = entries.length > MAX ? Object.fromEntries(entries.sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX)) : all;
  await store.set(KEY, kept);
}

/** The folder the pipeline settled on (status poll): keeps the side panel line current. */
export async function updateCaptureFolder(store: KeyValueStore, itemId: string, folder: string) {
  const all = (await store.get<Index>(KEY)) ?? {};
  let changed = false;
  for (const v of Object.values(all)) {
    if (v.item_id === itemId && v.folder_path !== folder) {
      v.folder_path = folder;
      changed = true;
    }
  }
  if (changed) await store.set(KEY, all);
}
