// "Speichern & schließen" when Kortex answers late: the tabs are closed as soon as the queued session
// is delivered, not left open forever. Only tabs that still show the saved page are closed.
import type { KeyValueStore } from "./settings";

const KEY = "sessions.pendingClose";
/** Older than this, a pending close is dropped (the user has moved on). */
const MAX_AGE_MS = 6 * 60 * 60_000;

export interface PendingClose {
  /** idempotency_key of the session note */
  key: string;
  windowId: number;
  tabs: { id: number; url: string }[];
  at: number;
}

export async function rememberPendingClose(s: KeyValueStore, entry: PendingClose) {
  const list = ((await s.get<PendingClose[]>(KEY)) ?? []).filter((e) => e.key !== entry.key && Date.now() - e.at < MAX_AGE_MS);
  await s.set(KEY, [...list, entry].slice(-20));
}

/** Takes the pending close for `key` out of storage (null when there is none or it is too old). */
export async function takePendingClose(s: KeyValueStore, key: string, now = Date.now()): Promise<PendingClose | null> {
  const list = (await s.get<PendingClose[]>(KEY)) ?? [];
  const hit = list.find((e) => e.key === key);
  if (!hit) return null;
  await s.set(KEY, list.filter((e) => e.key !== key));
  return now - hit.at < MAX_AGE_MS ? hit : null;
}

/** Same document: query and path equal, the #fragment and a trailing slash do not count (SPAs and players rewrite those). */
export function sameDocument(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const norm = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.origin}${x.pathname.replace(/\/+$/, "")}${x.search}`;
    } catch {
      return u;
    }
  };
  return norm(a) === norm(b);
}

/** Tab ids that still show the page that was saved (a tab navigated elsewhere stays open). */
export function tabsStillToClose(pending: Pick<PendingClose, "tabs">, current: readonly { id?: number; url?: string }[]): number[] {
  const now = new Map(current.flatMap((t) => (t.id === undefined ? [] : [[t.id, t.url] as const])));
  return pending.tabs.filter((t) => sameDocument(now.get(t.id), t.url)).map((t) => t.id);
}
