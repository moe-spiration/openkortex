import { t } from "@/i18n";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import type { JobRow, JobStore } from "./jobs";

/*
 * Ingest worker inside the web process. Claims due jobs (FOR UPDATE SKIP LOCKED, so several
 * processes can run side by side), keeps their lock alive with a heartbeat, retries failures with
 * exponential backoff and gives up after max_attempts. On start it puts jobs of dead workers
 * (no heartbeat for `staleSeconds`) back into the queue; on stop it waits for running jobs a
 * little and hands the rest back without counting the attempt.
 */

export interface WorkerLog {
  info(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface WorkerOptions {
  store: JobStore;
  /** Processes one job. `final` = last attempt (the item gets its error state then). */
  run(job: JobRow, attempt: { final: boolean }): Promise<void>;
  /** Called once when a job ends in error (permanent error or attempts used up). */
  onFailed?(job: JobRow, message: string): Promise<void>;
  /** Errors that no retry can fix (bad input, no adapter). */
  isPermanent?(err: unknown): boolean;
  /** Wraps one job's whole run (work, timeout text, failure handling), e.g. in the language of the job's user. */
  within?(job: JobRow, fn: () => Promise<void>): Promise<void>;
  workerId?: string;
  concurrency?: number;
  pollMs?: number;
  heartbeatMs?: number;
  staleSeconds?: number;
  jobTimeoutMs?: number;
  /** Delay before attempt n+1 after attempt n failed. Default 30 s · 4^(n-1): 30 s, 2 min, 8 min … */
  backoffMs?(attempt: number): number;
  now?(): Date;
  log?: WorkerLog;
}

export interface IngestWorker {
  readonly id: string;
  start(): Promise<void>;
  /** Stop claiming, wait up to `graceMs` for running jobs, release the rest. */
  stop(graceMs?: number): Promise<void>;
  /** Look for work now (after an enqueue). */
  notify(): void;
  /** Running job ids. */
  active(): string[];
  /** Tests: claim and run until nothing is due. */
  drain(): Promise<void>;
}

export const defaultBackoff = (attempt: number) => 30_000 * 4 ** Math.max(0, attempt - 1);

export const newWorkerId = () => `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 2000);

class JobTimeout extends Error {}

export function createIngestWorker(o: WorkerOptions): IngestWorker {
  const id = o.workerId ?? newWorkerId();
  const concurrency = Math.max(1, o.concurrency ?? 2);
  const pollMs = o.pollMs ?? 5_000;
  const heartbeatMs = o.heartbeatMs ?? 15_000;
  const staleSeconds = o.staleSeconds ?? 60;
  const jobTimeoutMs = o.jobTimeoutMs ?? 30 * 60_000;
  const backoff = o.backoffMs ?? defaultBackoff;
  const now = o.now ?? (() => new Date());
  const log = o.log;

  const running = new Map<string, Promise<void>>();
  let started = false;
  let stopping = false;
  let pumping: Promise<void> | null = null;
  let again = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;

  const execute = (job: JobRow): Promise<void> => (o.within ? o.within(job, () => executeJob(job)) : executeJob(job));

  async function executeJob(job: JobRow): Promise<void> {
    const final = job.attempts >= job.max_attempts;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        o.run(job, { final }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new JobTimeout(t("Timed out after {minutes} min", { minutes: Math.round(jobTimeoutMs / 60_000) })),
              ),
            jobTimeoutMs,
          );
        }),
      ]);
      await o.store.complete(job.id, id);
    } catch (err) {
      const msg = message(err);
      const permanent = o.isPermanent?.(err) ?? false;
      try {
        if (final || permanent) {
          await o.store.fail(job.id, id, msg);
          await o.onFailed?.(job, msg);
          log?.error(`ingest job ${job.id} failed (${job.attempts}/${job.max_attempts})`, msg);
        } else {
          const at = new Date(now().getTime() + backoff(job.attempts));
          await o.store.retry(job.id, id, msg, at);
          log?.info(
            `ingest job ${job.id} retry ${job.attempts + 1}/${job.max_attempts} at ${at.toISOString()}`,
            msg,
          );
        }
      } catch (e) {
        // The lock runs out and the stale recovery picks the job up again.
        log?.error(`ingest job ${job.id}: could not record the result`, e);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function pumpOnce(): Promise<void> {
    while (!stopping && running.size < concurrency) {
      const jobs = await o.store.claim(id, concurrency - running.size);
      if (!jobs.length) return;
      for (const job of jobs) {
        const p = execute(job).finally(() => {
          running.delete(job.id);
          pump();
        });
        running.set(job.id, p);
      }
    }
  }

  /** Serialised claim loop; a call while one runs schedules exactly one more round. */
  function pump(): void {
    if (stopping || !started) return;
    if (pumping) {
      again = true;
      return;
    }
    pumping = pumpOnce()
      .catch((err) => log?.error("ingest worker: claim failed", err))
      .finally(() => {
        pumping = null;
        if (again) {
          again = false;
          pump();
        }
      });
  }

  return {
    id,
    async start() {
      if (started) return;
      started = true;
      stopping = false;
      try {
        const n = await o.store.requeueStale(staleSeconds);
        if (n) log?.info(`ingest worker: ${n} interrupted jobs queued again`);
        await o.store.prune(7);
      } catch (err) {
        log?.error("ingest worker: recovery failed", err);
      }
      poll = setInterval(() => {
        // Jobs of workers that died while this one runs.
        void o.store.requeueStale(staleSeconds).catch(() => {});
        pump();
      }, pollMs);
      beat = setInterval(() => {
        void o.store
          .heartbeat(id, [...running.keys()])
          .catch((err) => log?.error("ingest worker: heartbeat failed", err));
      }, heartbeatMs);
      poll.unref?.();
      beat.unref?.();
      log?.info(`ingest worker ${id} started`);
      pump();
    },
    async stop(graceMs = 10_000) {
      stopping = true;
      clearInterval(poll);
      clearInterval(beat);
      if (running.size) {
        await Promise.race([
          Promise.allSettled([...running.values()]),
          new Promise((r) => setTimeout(r, graceMs)),
        ]);
      }
      const left = [...running.keys()];
      if (left.length) {
        const n = await o.store.release(id, left).catch(() => 0);
        log?.info(`ingest worker ${id}: ${n} running jobs handed back`);
      }
      started = false;
    },
    notify: () => pump(),
    active: () => [...running.keys()],
    async drain() {
      for (;;) {
        const jobs = await o.store.claim(id, concurrency);
        if (!jobs.length) return;
        await Promise.all(jobs.map((j) => execute(j)));
      }
    },
  };
}
