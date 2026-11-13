/*
 * Unsaved note bodies in localStorage (review N5 #3). The store writes a draft when the page is
 * hidden or closed while a save is still pending (a request started during unload may never reach
 * the server) and removes it once the text is saved. On the next load a draft is restored only if
 * the server copy has not changed since the draft was written, so a newer edit from another device
 * is never overwritten.
 */

const KEY = "kortex.notes.drafts.v1";
/** Drafts older than this are dropped unread. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface Draft {
  md: string;
  /** ISO time the draft was written (client clock). */
  at: string;
}

type Drafts = Record<string, Draft>;

function read(): Drafts {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!v || typeof v !== "object") return {};
    const out: Drafts = {};
    for (const [id, d] of Object.entries(v as Record<string, unknown>)) {
      const x = d as Partial<Draft>;
      if (typeof x?.md === "string" && typeof x.at === "string") out[id] = { md: x.md, at: x.at };
    }
    return out;
  } catch {
    return {};
  }
}

function write(d: Drafts) {
  try {
    if (Object.keys(d).length) window.localStorage.setItem(KEY, JSON.stringify(d));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage blocked or full: the in-flight save is all we have */
  }
}

export function saveDrafts(entries: Iterable<[string, string]>, now = new Date()) {
  const d = read();
  let changed = false;
  for (const [id, md] of entries) {
    d[id] = { md, at: now.toISOString() };
    changed = true;
  }
  if (changed) write(d);
}

/** Removes the draft of `id` when it holds exactly `md` (that text is on the server now). */
export function clearDraft(id: string, md: string) {
  const d = read();
  if (d[id]?.md !== md) return;
  delete d[id];
  write(d);
}

/**
 * Drafts to restore: the note exists, its text differs, and the server copy is not newer than the
 * draft. Everything else (restored, stale or superseded) is removed from storage.
 */
export function takeRestorableDrafts(
  items: Readonly<Record<string, { contentMd: string; updatedAt?: string | null }>>,
  now = new Date(),
): { id: string; md: string }[] {
  const d = read();
  const out: { id: string; md: string }[] = [];
  for (const [id, draft] of Object.entries(d)) {
    const item = items[id];
    const at = Date.parse(draft.at);
    const fresh = Number.isFinite(at) && now.getTime() - at < MAX_AGE_MS;
    const serverNewer = !!item?.updatedAt && Date.parse(item.updatedAt) > at;
    if (item && fresh && !serverNewer && item.contentMd !== draft.md) out.push({ id, md: draft.md });
  }
  write({});
  return out;
}
