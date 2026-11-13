import { runAsUser } from "../locale";
import { IngestionError } from "@kortex/ai-core";
import type { AuthContext } from "../auth";
import type { ServerDeps } from "../deps";
import { withUsageContext } from "../limits";
import { createSupabaseJobStore, type JobRow, type JobStore } from "./jobs";
import { markItemFailed, processItem } from "./process";
import { createDurableIngestQueue, type IngestQueue } from "./queue";
import { sweepOrphanItems } from "./sweep";
import { createIngestWorker, type IngestWorker } from "./worker";

/*
 * The production ingest queue: kortex.ingest_jobs + one worker per web process. The worker runs
 * jobs with the service role and the job's user_id (every repo query filters by it), because
 * after a restart there is no user session to borrow.
 */

export interface IngestRuntime {
  store: JobStore;
  worker: IngestWorker;
  queue: IngestQueue;
}

const g = globalThis as { __kortexIngest?: IngestRuntime };

const serviceCtx = (deps: ServerDeps, userId: string): AuthContext => ({
  userId,
  mode: "api_token",
  client: deps.clients.service(),
});

export function createIngestRuntime(
  deps: ServerDeps,
  store: JobStore = createSupabaseJobStore(() => deps.clients.service()),
): IngestRuntime {
  const unstage = (job: JobRow) =>
    job.payload?.file
      ? store.unstage(job.payload.file).catch((err) => deps.log.error(`unstage ${job.id}`, err))
      : Promise.resolve();

  const worker = createIngestWorker({
    store,
    concurrency: Number(deps.env.raw.KORTEX_INGEST_CONCURRENCY) || 2,
    log: deps.log,
    isPermanent: (err) => err instanceof IngestionError,
    // No request here: the job (pipeline prompts, generated texts, error reasons) runs in its user's language.
    within: (job, fn) => runAsUser(deps.clients.service(), job.user_id, fn),
    async run(job, attempt) {
      if (!job.item_id) return; // item deleted (FK cascade removes the job too)
      const p = job.payload;
      const input = p.file
        ? {
            ...p.input,
            fileBuffer: await store.download(p.file),
            fileName: p.file.name,
            ...(p.file.mimeType ? { mimeType: p.file.mimeType } : {}),
          }
        : p.input;
      // S2a metering: the job's AI calls are charged to its user (no request context here).
      const itemId = job.item_id;
      await withUsageContext({ userId: job.user_id }, () =>
        processItem(deps, serviceCtx(deps, job.user_id), itemId, input, p.options ?? {}, attempt),
      );
      await unstage(job);
    },
    async onFailed(job, message) {
      if (job.item_id)
        await markItemFailed(deps, serviceCtx(deps, job.user_id), job.item_id, message).catch(
          () => {},
        );
      await unstage(job);
    },
  });
  const queue = createDurableIngestQueue({ store, uuid: deps.uuid, notify: () => worker.notify() });
  return { store, worker, queue };
}

/**
 * One runtime per process. Dev hot reloads re-evaluate modules; the first worker keeps running
 * instead of a second one competing for the same jobs.
 */
export function ingestRuntime(deps: ServerDeps): IngestRuntime {
  return (g.__kortexIngest ??= createIngestRuntime(deps));
}

let signalsBound = false;

/** Starts the worker (idempotent) and hands running jobs back on SIGTERM / SIGINT. */
export function startIngestWorker(deps: ServerDeps): IngestWorker {
  const { worker } = ingestRuntime(deps);
  // Without the service role (mock mode, CI) there is no queue to work on.
  if (
    deps.env.raw.KORTEX_INGEST_WORKER === "off" ||
    !deps.env.supabaseUrl ||
    !deps.env.supabaseServiceRoleKey
  )
    return worker;
  void worker.start();
  startSweep(deps);
  if (!signalsBound) {
    signalsBound = true;
    for (const sig of ["SIGTERM", "SIGINT"] as const)
      process.once(sig, () => {
        void worker.stop(8_000);
      });
  }
  return worker;
}

let sweepTimer: ReturnType<typeof setInterval> | undefined;

/** Every 5 min (first run after 30 s): agent saves without a job go into the queue (./sweep.ts). */
function startSweep(deps: ServerDeps): void {
  if (sweepTimer || deps.env.raw.KORTEX_INGEST_SWEEP === "off") return;
  const run = () =>
    void sweepOrphanItems(deps, ingestRuntime(deps).queue)
      .then((n) => n && deps.log.info(`ingest sweep: ${n} entries without a job queued`))
      .catch((err) => deps.log.error("ingest sweep failed", err));
  setTimeout(run, 30_000).unref?.();
  sweepTimer = setInterval(run, 5 * 60_000);
  sweepTimer.unref?.();
}
