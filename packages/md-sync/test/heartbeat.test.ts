import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { ReconcileStats } from "../src/engine";
import {
  daemonVersion,
  deviceIdFor,
  SyncHeartbeat,
  type HeartbeatEngine,
  type HeartbeatPort,
  type HeartbeatRow,
  type SyncRequest,
} from "../src/heartbeat";

const stats = (o: Partial<ReconcileStats> = {}): ReconcileStats => ({
  pulled: 0,
  pushed: 0,
  conflicts: 0,
  removedLocal: 0,
  removedRemote: 0,
  unchanged: 3,
  errors: 0,
  ...o,
});

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

function setup(request: SyncRequest | null = null) {
  const rows: HeartbeatRow[] = [];
  let listener: (() => void) | null = null;
  let req = request;
  const port: HeartbeatPort = {
    upsert: async (row) => {
      rows.push(row);
      if (row.sync_handled_at && req) req = { ...req, sync_handled_at: row.sync_handled_at };
    },
    readRequest: async () => req,
    subscribe: (fn) => {
      listener = fn;
      return async () => {
        listener = null;
      };
    },
  };
  let reconciles = 0;
  const engine = Object.assign(new EventEmitter(), {
    reconcile: async () => {
      reconciles++;
      return stats({ pulled: 1 });
    },
    pendingWork: () => ({ local: 2, tracked: 40 }),
  });
  let t = Date.parse("2026-10-27T08:00:00Z");
  const now = () => new Date((t += 1000));
  const hb = new SyncHeartbeat({
    port,
    engine: engine as unknown as HeartbeatEngine,
    ingestor: { pending: 1 },
    userId: "u1",
    deviceId: "pc.1234abcd",
    deviceName: "pc",
    vaultPath: "C:/Vault",
    version: "1.2.3",
    intervalMs: 3_600_000,
    activityDelayMs: 5,
    logger: quiet,
    now,
  });
  return {
    hb,
    rows,
    engine,
    reconciles: () => reconciles,
    request: (at: string) => {
      req = { sync_requested_at: at, sync_handled_at: req?.sync_handled_at ?? null };
      listener?.();
    },
  };
}

describe("SyncHeartbeat", () => {
  it("shows an error of the start-up reconcile in the first beat (Supabase unreachable, M-07)", async () => {
    const s = setup();
    await s.hb.start(stats({ errors: 1 }), [{ context: "reconcile", error: new TypeError("fetch failed") }]);
    const first = s.rows[0]!;
    expect(first.last_error).toBe("reconcile: fetch failed");
    expect(first.last_error_at).not.toBeNull();
    expect(first.last_success_at).toBeNull(); // the desktop then shows "Mit Fehlern", not "Synchron"
    // Without the event, the error count alone still marks it.
    const t = setup();
    await t.hb.start(stats({ errors: 2 }));
    expect(t.rows[0]!.last_error).toMatch(/2 Fehler/);
    // A later clean reconcile counts as success again (newer than the error).
    s.engine.emit("reconciled", stats());
    await new Promise((r) => setTimeout(r, 30));
    const last = s.rows.at(-1)!;
    expect(Date.parse(last.last_success_at!)).toBeGreaterThan(Date.parse(last.last_error_at!));
    await s.hb.stop();
    await t.hb.stop();
  });

  it("writes vault, version, pending work and the last successful reconcile on start", async () => {
    const s = setup();
    await s.hb.start(stats());
    const first = s.rows[0]!;
    expect(first).toMatchObject({
      user_id: "u1",
      device_id: "pc.1234abcd",
      vault_path: "C:/Vault",
      daemon_version: "1.2.3",
      state: "running",
      pending_local: 2,
      pending_ingest: 1,
      items_tracked: 40,
      last_sync_at: null,
    });
    expect(first.last_success_at).not.toBeNull();
    await s.hb.stop();
    expect(s.rows.at(-1)!.state).toBe("stopped");
  });

  it("records sync activity and errors with a debounced beat", async () => {
    const s = setup();
    await s.hb.start();
    s.engine.emit("pushed", { id: "a", path: "x.md" });
    s.engine.emit("sync-error", { error: new Error("disk full"), context: "push" });
    s.engine.emit("remote-status", { status: "connected" });
    await new Promise((r) => setTimeout(r, 30));
    const last = s.rows.at(-1)!;
    expect(last.last_sync_at).not.toBeNull();
    expect(last.last_error).toBe("push: disk full");
    expect(last.realtime).toBe("connected");
    await s.hb.stop();
  });

  it("runs one reconcile per web request and marks it handled", async () => {
    const s = setup({ sync_requested_at: "2026-10-27T07:00:00Z", sync_handled_at: null });
    await s.hb.start(); // a request made while the daemon was off
    expect(s.reconciles()).toBe(1);
    expect(s.rows.at(-1)!.sync_handled_at).toBeDefined();
    expect(await s.hb.checkRequest()).toBe(false); // already handled

    s.request("2026-10-27T09:00:00Z"); // newer than handled
    await new Promise((r) => setTimeout(r, 10));
    expect(s.reconciles()).toBe(2);
    expect(s.rows.at(-1)!.stats).toMatchObject({ pulled: 1 });
    await s.hb.stop();
  });
});

describe("deviceIdFor", () => {
  it("is stable per host and vault, and safe for the id column", () => {
    const a = deviceIdFor("C:/Users/x/KortexVault", "Max's PC");
    expect(a).toMatch(/^Max-s-PC\.[0-9a-f]{8}$/);
    expect(deviceIdFor("C:/Users/x/KortexVault", "Max's PC")).toBe(a);
    expect(deviceIdFor("C:/Other", "Max's PC")).not.toBe(a);
    expect(deviceIdFor("C:/x", "h", "my laptop")).toBe("my-laptop");
  });
});

describe("daemonVersion", () => {
  it("reports md-sync's package.json version (the shared client version), never 0.0.0", async () => {
    const { readFile } = await import("node:fs/promises");
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(daemonVersion()).toBe(pkg.version);
    expect(daemonVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(daemonVersion()).not.toBe("0.0.0");
  });
});
