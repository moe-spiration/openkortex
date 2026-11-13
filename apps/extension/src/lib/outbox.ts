// Optimistic delivery: the UI is told "saved" as soon as the request is safely queued, the
// background worker delivers it and retries transient failures with backoff.
import { isRetryable, validateIngestRequest, type ApiClient, type IngestRequest, type IngestResponse } from "./api";
import { t } from "../i18n";
import { applyLimits } from "./limits";
import type { KeyValueStore } from "./settings";

const KEY = "outbox";
const MAX_QUEUE = 200;
const MAX_ATTEMPTS = 8;
/** A server without configuration may be fixed hours later: keep those entries about a day (30 min cap). */
const MAX_ATTEMPTS_NOT_CONFIGURED = 48;
const maxAttempts = (code?: string) => (code === "not_configured" ? MAX_ATTEMPTS_NOT_CONFIGURED : MAX_ATTEMPTS);

export interface OutboxEntry {
  id: string;
  request: IngestRequest;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  lastCode?: string;
}

/** `notices`: what the client shortened to fit the server limits (shown to the user). */
export type SubmitResult =
  | { ok: true; delivered: true; response: IngestResponse & { ok: true }; notices?: string[] }
  | { ok: true; delivered: false; queued: true; reason: string; code?: string; notices?: string[] }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export const readOutbox = async (store: KeyValueStore) => (await store.get<OutboxEntry[]>(KEY)) ?? [];

/** A capture written ahead of its first attempt is left alone by the regular flush for this long. */
const IN_FLIGHT_GRACE_MS = 60_000;

const backoffMs = (attempts: number) => Math.min(30 * 60_000, 15_000 * 2 ** attempts);

export function createOutbox(deps: {
  store: KeyValueStore;
  api: Pick<ApiClient, "ingest">;
  now?: () => number;
  newId?: () => string;
  /** Called for every capture the server accepted, right away or after a retry (activity log). */
  onDelivered?: (request: IngestRequest, response: IngestResponse & { ok: true }) => void | Promise<void>;
}) {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  // Serialises read-modify-write cycles on the queue (service workers handle messages concurrently).
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };

  const notify = async (request: IngestRequest, response: IngestResponse & { ok: true }) => {
    try {
      await deps.onDelivered?.(request, response);
    } catch {
      /* bookkeeping must never turn a delivered capture into a failure */
    }
  };

  const read = () => readOutbox(deps.store);
  const write = (entries: OutboxEntry[]) => deps.store.set(KEY, entries);

  return {
    size: async () => (await read()).length,
    list: read,

    /** Drops one queued capture (user gave up on it). */
    remove: (id: string) => exclusive(async () => write((await read()).filter((e) => e.id !== id))),

    /** Try once right away; transient failures are queued, final failures are reported to the caller. */
    async submit(input: IngestRequest): Promise<SubmitResult> {
      const fitted = applyLimits(input);
      if (fitted.error) return { ok: false, error: { code: "invalid_request", message: fitted.error } };
      const request = fitted.request;
      const notices = fitted.notices.length ? fitted.notices : undefined;
      const invalid = validateIngestRequest(request);
      if (invalid) return { ok: false, error: { code: "invalid_request", message: invalid } };
      // Write-ahead: the capture is on disk before the request leaves. If the service worker is stopped
      // mid-request (MV3 ends idle workers), the next flush delivers it; the idempotency key keeps that single.
      const id = newId();
      await exclusive(async () => {
        const queue = await read();
        queue.push({ id, request, attempts: 0, nextAttemptAt: now() + IN_FLIGHT_GRACE_MS });
        await write(queue.slice(-MAX_QUEUE));
      });
      const drop = () => exclusive(async () => write((await read()).filter((e) => e.id !== id)));
      const res = await deps.api.ingest(request).catch((e: unknown): IngestResponse => ({
        ok: false,
        error: { code: "network", message: e instanceof Error ? e.message : t("Kortex is unreachable") },
      }));
      if (res.ok) {
        await drop();
        await notify(request, res);
        return { ok: true, delivered: true, response: res, notices };
      }
      if (!isRetryable(res)) {
        await drop();
        return { ok: false, error: res.error };
      }
      await exclusive(async () => {
        const queue = await read();
        await write(
          queue.map((e) =>
            e.id === id ? { ...e, attempts: 1, nextAttemptAt: now() + backoffMs(1), lastError: res.error.message, lastCode: res.error.code } : e,
          ),
        );
      });
      return { ok: true, delivered: false, queued: true, reason: res.error.message, code: res.error.code, notices };
    },

    /**
     * Delivers everything that is due (`force`: everything, e.g. right after the settings changed).
     * Returns how many entries were delivered / dropped.
     */
    flush(opts: { force?: boolean } = {}): Promise<{ delivered: number; dropped: number; pending: number }> {
      return exclusive(async () => {
        const queue = await read();
        const keep: OutboxEntry[] = [];
        let delivered = 0;
        let dropped = 0;
        for (const entry of queue) {
          if (!opts.force && entry.nextAttemptAt > now()) {
            keep.push(entry);
            continue;
          }
          const res = await deps.api.ingest(entry.request);
          if (res.ok) {
            delivered++;
            await notify(entry.request, res);
          } else if (isRetryable(res) && entry.attempts + 1 < maxAttempts(res.error.code)) {
            const attempts = entry.attempts + 1;
            keep.push({
              ...entry,
              attempts,
              nextAttemptAt: now() + backoffMs(attempts),
              lastError: res.error.message,
              lastCode: res.error.code,
            });
          } else {
            dropped++;
          }
        }
        await write(keep);
        return { delivered, dropped, pending: keep.length };
      });
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
