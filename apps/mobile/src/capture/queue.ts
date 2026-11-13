import type { IngestRequest } from "../api/ingest";

/*
 * Offline queue for captures. A capture that fails because Kortex is unreachable (no network,
 * timeout, 5xx, rate limit) is stored on the device and sent again later (app back in the
 * foreground, pull to refresh, every 30 s while something waits). Storage is injected so the
 * queue is testable; the app passes the SecureStore adapter.
 */

export type QueueJob =
  | { kind: "ingest"; title: string; req: IngestRequest }
  /** Voice memo not yet transcribed: the recording stays in the app's cache until it is sent. */
  | { kind: "voice"; title: string; uri: string }
  /** Photo or file from the device (multipart upload). */
  | { kind: "file"; title: string; uri: string; name: string; mimeType: string; /** Optional note (photo mode, the user's words), stored as the item's first note. */ note?: string };

export type Queued = QueueJob & { id: string; at: string; tries: number };

export interface QueueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** ok = sent, retry = keep for later, drop = permanent failure (bad request, unauthorized…). */
export type SendResult = "ok" | "retry" | "drop";

const KEY = "kortex.queue";
/** Give up after this many attempts so a broken capture cannot block the queue forever. */
export const MAX_TRIES = 20;

export function createQueue(storage: QueueStorage, now: () => Date = () => new Date()) {
  let flushing = false;

  async function list(): Promise<Queued[]> {
    try {
      const raw = await storage.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as Queued[]) : [];
    } catch {
      return [];
    }
  }
  const save = (items: Queued[]) => storage.setItem(KEY, JSON.stringify(items));

  return {
    list,
    /** Sign-out: captures belong to the account that made them and must not reach the next one. */
    clear: () => save([]),
    async add(job: QueueJob): Promise<number> {
      const items = await list();
      items.push({ ...job, id: `q${now().getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now().toISOString(), tries: 0 });
      await save(items);
      return items.length;
    },
    /** Sends oldest first; stops at the first `retry` (still offline). Returns what happened. */
    async flush(send: (job: Queued) => Promise<SendResult>): Promise<{ sent: number; dropped: number; left: number }> {
      if (flushing) return { sent: 0, dropped: 0, left: (await list()).length };
      flushing = true;
      let sent = 0;
      let dropped = 0;
      try {
        const items = await list();
        const rest: Queued[] = [];
        let offline = false;
        for (const job of items) {
          if (offline) {
            rest.push(job);
            continue;
          }
          let r: SendResult;
          try {
            r = await send(job);
          } catch {
            r = "retry";
          }
          if (r === "ok") sent++;
          else if (r === "drop" || job.tries + 1 >= MAX_TRIES) dropped++;
          else {
            rest.push({ ...job, tries: job.tries + 1 });
            offline = true;
          }
        }
        await save(rest);
        return { sent, dropped, left: rest.length };
      } finally {
        flushing = false;
      }
    },
  };
}

export type CaptureQueue = ReturnType<typeof createQueue>;

/** A thrown fetch error (no network, DNS, abort) means "try later", not "this capture is broken". */
export const isNetworkError = (e: unknown) => e instanceof TypeError || (e instanceof Error && /network|abort|timeout|zeitüberschreitung|nicht erreichbar/i.test(e.message));
