/*
 * Hand-over to the new-note editor (Tactile Craft v2, decision 8). Every entry point ("Neu" in the titlebar,
 * Ctrl/Alt+N, "+" in the tab strip, the Orbit-Bar) calls the shell store's
 * openNewNote(prefill?), which writes the prefill here and navigates to NEW_NOTE_HREF. The editor route reads it
 * once with takeNewNotePrefill() (read + remove), so a reload starts empty.
 */

export const NEW_NOTE_HREF = "/notes/new";

/** sessionStorage key of the prefill: JSON `{ title?: string, body?: string, template?: string, at: number }`. */
export const NEW_NOTE_PREFILL_KEY = "kortex.newnote.prefill.v1";

export interface NewNotePrefill {
  title?: string;
  body?: string;
  /**
   * Template to preselect in the editor: a template id of lib/notes/new-note.ts ("meeting", "brief" …) or
   * NEW_NOTE_PICK_TEMPLATE, which opens the editor with its template menu open ("Aus Vorlage …").
   */
  template?: string;
}

/** Prefill template value that opens the template menu instead of applying one. */
export const NEW_NOTE_PICK_TEMPLATE = "pick";

/** A prefill older than this is ignored (stale tab, back navigation much later). */
export const NEW_NOTE_PREFILL_TTL_MS = 10 * 60 * 1000;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const session = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

/** Normalised prefill, or null when there is nothing to prefill. */
export function cleanPrefill(p: NewNotePrefill | null | undefined): NewNotePrefill | null {
  if (!p) return null;
  const title = typeof p.title === "string" ? p.title.trim() : "";
  const body = typeof p.body === "string" ? p.body.replace(/\s+$/, "") : "";
  const template = typeof p.template === "string" && /^[a-z][a-z-]{0,31}$/.test(p.template) ? p.template : "";
  if (!title && !body.trim() && !template) return null;
  return { ...(title ? { title } : {}), ...(body.trim() ? { body } : {}), ...(template ? { template } : {}) };
}

/** Stores the prefill (or clears an old one when there is none). */
export function writeNewNotePrefill(p: NewNotePrefill | null | undefined, store: Storage | null = session(), now = Date.now()): void {
  if (!store) return;
  try {
    const c = cleanPrefill(p);
    if (c) store.setItem(NEW_NOTE_PREFILL_KEY, JSON.stringify({ ...c, at: now }));
    else store.removeItem(NEW_NOTE_PREFILL_KEY);
  } catch {
    /* storage blocked: the editor opens empty */
  }
}

/** Reads and removes the prefill; null when there is none, it is malformed or older than the TTL. */
export function takeNewNotePrefill(store: Storage | null = session(), now = Date.now()): NewNotePrefill | null {
  if (!store) return null;
  try {
    const raw = store.getItem(NEW_NOTE_PREFILL_KEY);
    store.removeItem(NEW_NOTE_PREFILL_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as NewNotePrefill & { at?: number };
    if (typeof p.at !== "number" || now - p.at > NEW_NOTE_PREFILL_TTL_MS) return null;
    return cleanPrefill(p);
  } catch {
    return null;
  }
}

/** Alt+N (and Ctrl/Cmd+N where the browser lets the page have it, e.g. the desktop app). */
export function isNewNoteKey(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  const n = e.key === "n" || e.key === "N" || e.code === "KeyN";
  if (!n || e.shiftKey) return false;
  return e.altKey !== (e.ctrlKey || e.metaKey);
}
