/*
 * Body saves of the notes store (review N5 #3). Per note:
 * - edits are debounced (`delayMs`) and only the newest text is sent;
 * - at most one save is in flight; edits that arrive meanwhile wait and go out right after it,
 *   so saves can never land out of order and the last version always wins;
 * - `flush()` sends everything pending at once (unmount, page hide, tab switch);
 * - a failed save keeps its text as pending (retried by the next edit or flush) and is reported.
 * Pure (no React), so the rules are unit-tested (save-queue.test.ts).
 */

export type SaveResult = { ok: true } | { ok: false; error: string };

export interface ContentSaverOptions {
  save: (id: string, md: string) => Promise<SaveResult>;
  delayMs: number;
  /** A save failed; `md` stays pending. */
  onError?: (id: string, error: string) => void;
  /** `md` reached the server and nothing newer is waiting for this note. */
  onSaved?: (id: string, md: string) => void;
}

interface Slot {
  timer?: ReturnType<typeof setTimeout>;
  /** Newest text not yet sent. */
  pending?: string;
  /** Save in flight. */
  inFlight?: Promise<void>;
  /** The last attempt failed (pending holds its text). */
  failed?: boolean;
}

export interface ContentSaver {
  /** Queue `md` for `id` (debounced). */
  schedule(id: string, md: string): void;
  /** Send pending text now (all notes, or one); resolves when those saves have finished. */
  flush(id?: string): Promise<void>;
  /** Notes with unsaved text (pending, in flight or failed): their local copy must win over snapshots. */
  dirtyIds(): Set<string>;
  /** Newest unsaved text of a note. */
  pendingText(id: string): string | undefined;
  /** Stop all timers without sending (tests). */
  dispose(): void;
}

export function createContentSaver(o: ContentSaverOptions): ContentSaver {
  const slots = new Map<string, Slot>();
  const slot = (id: string) => {
    let s = slots.get(id);
    if (!s) slots.set(id, (s = {}));
    return s;
  };
  const cleanup = (id: string) => {
    const s = slots.get(id);
    if (s && s.pending === undefined && !s.inFlight && !s.timer) slots.delete(id);
  };

  /** Sends the pending text of `id`, or chains it after the save in flight. */
  const send = (id: string): Promise<void> => {
    const s = slot(id);
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = undefined;
    }
    if (s.inFlight) return s.inFlight.then(() => (slots.get(id)?.pending !== undefined ? send(id) : undefined));
    const md = s.pending;
    if (md === undefined) return Promise.resolve();
    s.pending = undefined;
    s.failed = false;
    s.inFlight = o
      .save(id, md)
      .catch((err: unknown): SaveResult => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
      .then((r) => {
        const cur = slot(id);
        cur.inFlight = undefined;
        if (!r.ok) {
          // Keep the text for a retry, unless something newer is already waiting.
          cur.pending ??= md;
          cur.failed = true;
          o.onError?.(id, r.error);
          return;
        }
        if (cur.pending === undefined) {
          o.onSaved?.(id, md);
          cleanup(id);
          return;
        }
        // Newer text arrived while this save ran: send it now (last version wins).
        if (!cur.timer) return send(id);
      });
    return s.inFlight;
  };

  return {
    schedule(id, md) {
      const s = slot(id);
      s.pending = md;
      if (s.timer) clearTimeout(s.timer);
      s.timer = setTimeout(() => {
        s.timer = undefined;
        void send(id);
      }, o.delayMs);
    },
    flush(id) {
      const ids = id ? [id] : [...slots.keys()];
      return Promise.all(ids.map((i) => send(i))).then(() => undefined);
    },
    dirtyIds() {
      return new Set([...slots].filter(([, s]) => s.pending !== undefined || s.inFlight || s.failed).map(([id]) => id));
    },
    pendingText(id) {
      return slots.get(id)?.pending;
    },
    dispose() {
      for (const s of slots.values()) if (s.timer) clearTimeout(s.timer);
      slots.clear();
    },
  };
}
