/**
 * Minimal in-process job queue (concurrency limit, never rejects). Production ingest uses the
 * durable kortex.ingest_jobs queue (./ingest/queue.ts, ./ingest/worker.ts); this one backs the
 * in-memory test runner.
 */
export interface JobQueue {
  /** Resolves when this job has finished (never rejects; failures go to `onError`). */
  enqueue(label: string, job: () => Promise<void>): Promise<void>;
  /** Jobs waiting + running. */
  size(): number;
  /** Resolves when the queue is empty (tests). */
  idle(): Promise<void>;
}

export function createJobQueue(
  options: { concurrency?: number; onError?: (label: string, err: unknown) => void } = {},
): JobQueue {
  const concurrency = Math.max(options.concurrency ?? 2, 1);
  const waiting: Array<() => void> = [];
  let running = 0;
  let idleWaiters: Array<() => void> = [];

  const next = () => {
    while (running < concurrency && waiting.length > 0) waiting.shift()?.();
    if (running === 0 && waiting.length === 0) {
      const w = idleWaiters;
      idleWaiters = [];
      w.forEach((r) => r());
    }
  };

  return {
    enqueue(label, job) {
      return new Promise<void>((resolve) => {
        waiting.push(() => {
          running++;
          job()
            .catch((err: unknown) => options.onError?.(label, err))
            .finally(() => {
              running--;
              resolve();
              next();
            });
        });
        next();
      });
    },
    size: () => running + waiting.length,
    idle: () =>
      running === 0 && waiting.length === 0
        ? Promise.resolve()
        : new Promise<void>((r) => idleWaiters.push(r)),
  };
}
