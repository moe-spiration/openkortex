import type { RawIngestInput } from "@kortex/ai-core";
import { STORAGE_BUCKETS, storagePath, type Json, type KortexClient } from "@kortex/db";
import type { ProcessOptions } from "./process";

/*
 * kortex.ingest_jobs (migration 20261028010000): the durable ingest queue. Everything here runs
 * with the service role and filters by user_id / locked_by itself. File bytes never go into the
 * row: they are staged in storage (kortex-documents/<user>/_ingest/<job>/<name>) and removed once
 * the job is finished.
 */

export type JobInput = Omit<RawIngestInput, "userId" | "itemId" | "fileBuffer">;

export interface StagedFile {
  bucket: string;
  path: string;
  name: string;
  mimeType?: string;
}

/** What a job row's payload holds. */
export interface JobPayload {
  input: JobInput;
  options: ProcessOptions;
  file?: StagedFile;
}

export interface JobRow {
  id: string;
  user_id: string;
  item_id: string | null;
  kind: string;
  payload: JobPayload;
  status: "queued" | "running" | "done" | "error";
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  locked_by: string | null;
}

export interface NewJob {
  id: string;
  userId: string;
  itemId: string;
  kind: string;
  payload: JobPayload;
  maxAttempts?: number;
}

/** Database side of the queue; the worker only talks to this (tests use an in-memory one). */
export interface JobStore {
  insert(job: NewJob): Promise<void>;
  claim(workerId: string, limit: number): Promise<JobRow[]>;
  heartbeat(workerId: string, ids: string[]): Promise<void>;
  complete(id: string, workerId: string): Promise<void>;
  retry(id: string, workerId: string, error: string, runAfter: Date): Promise<void>;
  fail(id: string, workerId: string, error: string): Promise<void>;
  /** Shutdown: back to the queue without counting the interrupted attempt. */
  release(workerId: string, ids: string[]): Promise<number>;
  requeueStale(staleSeconds: number): Promise<number>;
  /** Drops finished jobs older than `days` (keeps the table small). */
  prune(days: number): Promise<void>;
  /** Staged upload bytes of a job. */
  download(file: StagedFile): Promise<Uint8Array>;
  stage(
    userId: string,
    jobId: string,
    name: string,
    data: Uint8Array,
    mimeType?: string,
  ): Promise<StagedFile>;
  unstage(file: StagedFile): Promise<void>;
}

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`ingest_jobs ${what}: ${error.message}`);
};
const clip = (s: string) => s.slice(0, 2000);

export function createSupabaseJobStore(service: () => KortexClient): JobStore {
  return {
    async insert(job) {
      const { error } = await service()
        .from("ingest_jobs")
        .insert({
          id: job.id,
          user_id: job.userId,
          item_id: job.itemId,
          kind: job.kind,
          payload: job.payload as unknown as Json,
          ...(job.maxAttempts ? { max_attempts: job.maxAttempts } : {}),
        });
      fail("insert", error);
    },
    async claim(workerId, limit) {
      const { data, error } = await service().rpc("claim_ingest_jobs", {
        p_worker: workerId,
        p_limit: limit,
      });
      fail("claim", error);
      return (data ?? []) as unknown as JobRow[];
    },
    async heartbeat(workerId, ids) {
      if (!ids.length) return;
      const { error } = await service()
        .from("ingest_jobs")
        .update({ locked_at: new Date().toISOString() })
        .eq("status", "running")
        .eq("locked_by", workerId)
        .in("id", ids);
      fail("heartbeat", error);
    },
    async complete(id, workerId) {
      const { error } = await service()
        .from("ingest_jobs")
        .update({
          status: "done",
          payload: {},
          locked_at: null,
          locked_by: null,
          finished_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", id)
        .eq("locked_by", workerId);
      fail("complete", error);
    },
    async retry(id, workerId, message, runAfter) {
      const { error } = await service()
        .from("ingest_jobs")
        .update({
          status: "queued",
          last_error: clip(message),
          locked_at: null,
          locked_by: null,
          run_after: runAfter.toISOString(),
        })
        .eq("id", id)
        .eq("locked_by", workerId);
      fail("retry", error);
    },
    async fail(id, workerId, message) {
      const { error } = await service()
        .from("ingest_jobs")
        .update({
          status: "error",
          last_error: clip(message),
          locked_at: null,
          locked_by: null,
          finished_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("locked_by", workerId);
      fail("fail", error);
    },
    async release(workerId, ids) {
      if (!ids.length) return 0;
      const { data, error } = await service().rpc("release_ingest_jobs", {
        p_worker: workerId,
        p_ids: ids,
      });
      fail("release", error);
      return Number(data ?? 0);
    },
    async requeueStale(staleSeconds) {
      const { data, error } = await service().rpc("requeue_stale_ingest_jobs", {
        p_stale_seconds: staleSeconds,
      });
      fail("requeue", error);
      return Number(data ?? 0);
    },
    async prune(days) {
      const before = new Date(Date.now() - days * 86_400_000).toISOString();
      const { error } = await service()
        .from("ingest_jobs")
        .delete()
        .in("status", ["done", "error"])
        .lt("finished_at", before);
      fail("prune", error);
    },
    async download(file) {
      const { data, error } = await service().storage.from(file.bucket).download(file.path);
      if (error || !data)
        throw new Error(`staged upload ${file.path}: ${error?.message ?? "missing"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async stage(userId, jobId, name, data, mimeType) {
      const safe = name.replace(/[^\w.-]+/g, "_").slice(0, 120) || "upload";
      const file: StagedFile = {
        bucket: STORAGE_BUCKETS.documents,
        path: storagePath(userId, "_ingest", jobId, safe),
        name,
        ...(mimeType ? { mimeType } : {}),
      };
      const { error } = await service()
        .storage.from(file.bucket)
        .upload(file.path, data, {
          contentType: mimeType || "application/octet-stream",
          upsert: true,
        });
      if (error) throw new Error(`stage upload: ${error.message}`);
      return file;
    },
    async unstage(file) {
      await service().storage.from(file.bucket).remove([file.path]);
    },
  };
}
