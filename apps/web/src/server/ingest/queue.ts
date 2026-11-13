import type { RawIngestInput } from "@kortex/ai-core";
import type { AuthContext } from "../auth";
import { createJobQueue } from "../queue";
import type { JobStore } from "./jobs";
import type { ProcessOptions } from "./process";

/*
 * Where accepted ingests go. Production: a row in kortex.ingest_jobs (staged file bytes in
 * storage) picked up by the worker (./worker.ts, ./runtime.ts), which survives restarts.
 * Tests: an in-process runner with the same contract.
 */

export interface IngestJobSpec {
  itemId: string;
  /** Request kind (web_clip, note, file …), for logs and the row. */
  kind: string;
  input: Omit<RawIngestInput, "userId" | "itemId">;
  options: ProcessOptions;
}

export interface IngestQueue {
  /** Persists (or schedules) the job; resolves once it is safely queued, not when it ran. */
  enqueue(ctx: AuthContext, job: IngestJobSpec): Promise<void>;
  /** Resolves when no job is waiting or running in this process (tests). */
  idle(): Promise<void>;
}

export function createMemoryIngestQueue(
  run: (ctx: AuthContext, job: IngestJobSpec) => Promise<void>,
  options: {
    concurrency?: number;
    onError?: (label: string, err: unknown) => void;
    /** Keeps the job alive after the response (Next `after()` / test bookkeeping). */
    defer?: (work: Promise<unknown>) => void;
  } = {},
): IngestQueue {
  const q = createJobQueue(options);
  return {
    async enqueue(ctx, job) {
      // Registered now (idle() waits for it), started after the response like a real worker.
      const p = q.enqueue(`ingest:${job.itemId}`, async () => {
        await new Promise((r) => setImmediate(r));
        await run(ctx, job);
      });
      if (options.defer) options.defer(p);
      else void p;
    },
    idle: () => q.idle(),
  };
}

export function createDurableIngestQueue(o: {
  store: JobStore;
  uuid: () => string;
  /** Wakes the local worker (it also polls). */
  notify: () => void;
  maxAttempts?: number;
}): IngestQueue {
  return {
    async enqueue(ctx, job) {
      const id = o.uuid();
      const { fileBuffer, ...input } = job.input;
      const file = fileBuffer
        ? await o.store.stage(
            ctx.userId,
            id,
            job.input.fileName ?? "upload",
            new Uint8Array(fileBuffer),
            job.input.mimeType,
          )
        : undefined;
      await o.store.insert({
        id,
        userId: ctx.userId,
        itemId: job.itemId,
        kind: job.kind,
        payload: { input, options: job.options, ...(file ? { file } : {}) },
        ...(o.maxAttempts ? { maxAttempts: o.maxAttempts } : {}),
      });
      o.notify();
    },
    // Durable jobs run in the worker; nothing to wait for in the request process.
    idle: async () => {},
  };
}
