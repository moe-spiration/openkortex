import { describe, expect, it, vi } from "vitest";
import { IngestionError } from "@kortex/ai-core";
import { createIngestHandlers } from "../ingest/handler";
import { currentUsageContext } from "../limits";
import type { JobRow, JobStore, NewJob, StagedFile } from "../ingest/jobs";
import { createDurableIngestQueue } from "../ingest/queue";
import { createIngestRuntime } from "../ingest/runtime";
import { createIngestWorker, defaultBackoff } from "../ingest/worker";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, postJson, seedFolders, setup, USER_ID } from "./helpers";

/** In-memory kortex.ingest_jobs with the same claim / retry / stale semantics as the SQL. */
function memStore(clock: { now: number }) {
  type Row = JobRow & { run_after: number; locked_at: number | null; finished: boolean };
  const rows = new Map<string, Row>();
  const files = new Map<string, Uint8Array>();
  const log: string[] = [];
  const store: JobStore = {
    async insert(j: NewJob) {
      rows.set(j.id, {
        id: j.id,
        user_id: j.userId,
        item_id: j.itemId,
        kind: j.kind,
        payload: j.payload,
        status: "queued",
        attempts: 0,
        max_attempts: j.maxAttempts ?? 4,
        last_error: null,
        locked_by: null,
        run_after: clock.now,
        locked_at: null,
        finished: false,
      });
    },
    async claim(worker, limit) {
      const due = [...rows.values()]
        .filter((r) => r.status === "queued" && r.run_after <= clock.now)
        .slice(0, limit);
      for (const r of due)
        Object.assign(r, {
          status: "running",
          locked_by: worker,
          locked_at: clock.now,
          attempts: r.attempts + 1,
        });
      log.push(`claim ${due.length}`);
      return due.map((r) => ({ ...r }));
    },
    async heartbeat(worker, ids) {
      for (const id of ids) {
        const r = rows.get(id);
        if (r?.locked_by === worker) r.locked_at = clock.now;
      }
    },
    async complete(id, worker) {
      const r = rows.get(id)!;
      if (r.locked_by === worker)
        Object.assign(r, { status: "done", locked_by: null, finished: true });
    },
    async retry(id, worker, error, at) {
      const r = rows.get(id)!;
      if (r.locked_by === worker)
        Object.assign(r, {
          status: "queued",
          last_error: error,
          locked_by: null,
          run_after: at.getTime(),
        });
    },
    async fail(id, worker, error) {
      const r = rows.get(id)!;
      if (r.locked_by === worker)
        Object.assign(r, { status: "error", last_error: error, locked_by: null, finished: true });
    },
    async release(worker, ids) {
      let n = 0;
      for (const id of ids) {
        const r = rows.get(id);
        if (r?.status === "running" && r.locked_by === worker) {
          Object.assign(r, {
            status: "queued",
            attempts: Math.max(0, r.attempts - 1),
            locked_by: null,
            run_after: clock.now,
          });
          n++;
        }
      }
      return n;
    },
    async requeueStale(sec) {
      let n = 0;
      for (const r of rows.values())
        if (r.status === "running" && (r.locked_at ?? 0) < clock.now - sec * 1000) {
          Object.assign(r, {
            status: r.attempts >= r.max_attempts ? "error" : "queued",
            locked_by: null,
            run_after: clock.now,
          });
          n++;
        }
      return n;
    },
    async prune() {},
    async download(f: StagedFile) {
      return files.get(f.path)!;
    },
    async stage(userId, jobId, name, data, mimeType) {
      const f = {
        bucket: "kortex-documents",
        path: `${userId}/_ingest/${jobId}/${name}`,
        name,
        ...(mimeType ? { mimeType } : {}),
      };
      files.set(f.path, data);
      return f;
    },
    async unstage(f) {
      files.delete(f.path);
    },
  };
  return { store, rows, files, log };
}

const ctx = { userId: USER_ID, mode: "session" as const, client: new FakeSupabase().client };
const spec = (over: Record<string, unknown> = {}) => ({
  itemId: "item-1",
  kind: "note",
  input: { rawText: "x" },
  options: {},
  ...over,
});

describe("durable ingest queue + worker", () => {
  it("stages file bytes in storage (not in the row), runs the job and removes the staged file", async () => {
    const clock = { now: 1_000 };
    const m = memStore(clock);
    let n = 0;
    const q = createDurableIngestQueue({
      store: m.store,
      uuid: () => `job-${++n}`,
      notify: () => {},
    });
    await q.enqueue(
      ctx,
      spec({
        input: {
          fileBuffer: new Uint8Array([1, 2, 3]),
          fileName: "scan.pdf",
          mimeType: "application/pdf",
        },
      }),
    );
    const row = m.rows.get("job-1")!;
    expect(row.payload.input).toEqual({ fileName: "scan.pdf", mimeType: "application/pdf" });
    expect(row.payload.file).toMatchObject({
      bucket: "kortex-documents",
      path: `${USER_ID}/_ingest/job-1/scan.pdf`,
    });
    expect(m.files.size).toBe(1);

    const seen: Uint8Array[] = [];
    const worker = createIngestWorker({
      store: m.store,
      run: async (job) => {
        seen.push(await m.store.download(job.payload.file!));
        await m.store.unstage(job.payload.file!);
      },
      now: () => new Date(clock.now),
    });
    await worker.drain();
    expect([...seen[0]!]).toEqual([1, 2, 3]);
    expect(row.status).toBe("done");
    expect(m.files.size).toBe(0);
  });

  it("retries with exponential backoff, then gives up after max_attempts and reports it once", async () => {
    const clock = { now: 0 };
    const m = memStore(clock);
    await m.store.insert({
      id: "j",
      userId: USER_ID,
      itemId: "i",
      kind: "note",
      payload: { input: {}, options: {} },
      maxAttempts: 3,
    });
    const finals: boolean[] = [];
    const failed = vi.fn(async () => {});
    const worker = createIngestWorker({
      store: m.store,
      run: async (_job, { final }) => {
        finals.push(final);
        throw new Error("Jina 503");
      },
      onFailed: failed,
      now: () => new Date(clock.now),
    });
    await worker.drain();
    expect(m.rows.get("j")).toMatchObject({
      status: "queued",
      attempts: 1,
      last_error: "Jina 503",
      run_after: defaultBackoff(1),
    });
    await worker.drain(); // not due yet
    expect(finals).toEqual([false]);
    clock.now = defaultBackoff(1);
    await worker.drain();
    expect(m.rows.get("j")).toMatchObject({
      status: "queued",
      attempts: 2,
      run_after: defaultBackoff(1) + defaultBackoff(2),
    });
    clock.now += defaultBackoff(2);
    await worker.drain();
    expect(finals).toEqual([false, false, true]);
    expect(m.rows.get("j")).toMatchObject({ status: "error", attempts: 3 });
    expect(failed).toHaveBeenCalledTimes(1);
    expect(defaultBackoff(1)).toBe(30_000);
    expect(defaultBackoff(3)).toBe(480_000);
  });

  it("permanent errors fail right away", async () => {
    const clock = { now: 0 };
    const m = memStore(clock);
    await m.store.insert({
      id: "j",
      userId: USER_ID,
      itemId: "i",
      kind: "file",
      payload: { input: {}, options: {} },
    });
    const worker = createIngestWorker({
      store: m.store,
      run: async () => {
        throw new IngestionError("no_adapter", "Kein Adapter");
      },
      isPermanent: (e) => e instanceof IngestionError,
    });
    await worker.drain();
    expect(m.rows.get("j")).toMatchObject({ status: "error", attempts: 1 });
  });

  it("on start, jobs of a dead worker (no heartbeat) are requeued and finished", async () => {
    const clock = { now: 0 };
    const m = memStore(clock);
    await m.store.insert({
      id: "j",
      userId: USER_ID,
      itemId: "i",
      kind: "note",
      payload: { input: {}, options: {} },
    });
    await m.store.claim("dead-worker", 1); // the old process took it and was killed
    clock.now = 120_000;
    const ran = vi.fn(async () => {});
    const worker = createIngestWorker({
      store: m.store,
      run: ran,
      staleSeconds: 60,
      pollMs: 60_000,
    });
    await worker.start();
    await vi.waitFor(() => expect(m.rows.get("j")?.status).toBe("done"));
    expect(m.rows.get("j")?.attempts).toBe(2);
    await worker.stop(0);
  });

  it("graceful stop hands running jobs back without counting the attempt", async () => {
    const clock = { now: 0 };
    const m = memStore(clock);
    await m.store.insert({
      id: "j",
      userId: USER_ID,
      itemId: "i",
      kind: "note",
      payload: { input: {}, options: {} },
    });
    let release!: () => void;
    const worker = createIngestWorker({
      store: m.store,
      run: () => new Promise<void>((r) => (release = r)),
      pollMs: 60_000,
    });
    await worker.start();
    await vi.waitFor(() => expect(worker.active()).toEqual(["j"]));
    await worker.stop(10);
    expect(m.rows.get("j")).toMatchObject({ status: "queued", attempts: 0, locked_by: null });
    release();
  });

  it("end to end: POST /api/ingest → ingest_jobs → worker (service role, user_id) → item processed", async () => {
    const enrichment = {
      title: "MCP für Second Brains",
      summary: "MCP öffnet Wissen für Agenten.",
      cluster_name: "AI & Engineering",
      suggested_folder_path: "30_Clippings/AI",
      tags: ["ai/mcp"],
      entities: [],
      action_items: [],
    };
    const db = new FakeSupabase();
    seedFolders(db);
    const s = setup({ db, models: mockRouter({ fast: mockModel([enrichment]) }) });
    const clock = { now: 0 };
    const m = memStore(clock);
    // The worker has no request context: S2a metering must still charge the job's user.
    const payers: (string | undefined)[] = [];
    const resolve = s.deps.resolveModels;
    const metered = {
      ...s.deps,
      resolveModels: (c: Parameters<typeof resolve>[0]) => {
        payers.push(currentUsageContext()?.userId);
        return resolve(c);
      },
    };
    const runtime = createIngestRuntime(metered, m.store);
    const deps = { ...metered, queue: runtime.queue };
    const h = createIngestHandlers(() => deps);
    const res = await (
      await h.POST(
        postJson("https://kortex.test/api/ingest", {
          kind: "note",
          content_md: "# Idee\nMCP-Tool für Rezepte",
        }),
      )
    ).json();
    expect(res).toMatchObject({ kind: "note", queued: true, status: "inbox" });
    expect([...m.rows.values()]).toEqual([
      expect.objectContaining({
        kind: "note",
        user_id: USER_ID,
        item_id: res.item_id,
        status: "queued",
      }),
    ]);
    await runtime.worker.drain();
    expect(db.rows("knowledge_items")[0]).toMatchObject({
      id: res.item_id,
      status: "processed",
      title: "MCP für Second Brains",
    });
    expect([...m.rows.values()][0]?.status).toBe("done");
    expect(s.clientKinds).toContain("service");
    expect(payers).toEqual([USER_ID]);
  });

  it("a failed attempt keeps the item processing; the last one marks it error with the reason", async () => {
    const db = new FakeSupabase();
    seedFolders(db);
    const s = setup({ db, models: mockRouter({ fast: mockModel([]) }) }); // the organizer call fails
    const m = memStore({ now: 0 });
    const runtime = createIngestRuntime(s.deps, m.store);
    const failing = {
      ...s.deps,
      queue: runtime.queue,
      resolveModels: async () => {
        throw new Error("Provider down");
      },
    } as typeof s.deps;
    const rt = createIngestRuntime(failing, m.store);
    const h = createIngestHandlers(() => ({ ...failing, queue: rt.queue }));
    const res = await (
      await h.POST(postJson("https://kortex.test/api/ingest", { kind: "note", content_md: "Text" }))
    ).json();
    const row = [...m.rows.values()][0]!;
    row.max_attempts = 2;
    await rt.worker.drain();
    expect(db.rows("knowledge_items")[0]).toMatchObject({ id: res.item_id, status: "processing" });
    expect(
      (db.rows("knowledge_items")[0]?.metadata as { ingest: { state: string } }).ingest.state,
    ).toBe("retrying");
    row.run_after = 0;
    await rt.worker.drain();
    const item = db.rows("knowledge_items")[0]!;
    expect(item.status).toBe("error");
    expect((item.metadata as { ingest: { error: string } }).ingest.error).toContain(
      "Provider down",
    );
  });
});
