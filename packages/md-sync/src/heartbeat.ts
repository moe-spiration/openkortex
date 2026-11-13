import { t } from "./i18n";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KortexClient } from "@kortex/db";
import { KORTEX_SCHEMA } from "@kortex/db";
import type { Logger } from "./logger";
import type { ReconcileStats, SyncEngine, SyncErrorEvent } from "./engine";
import type { RemoteStatus, Unsubscribe } from "./types";

/*
 * Daemon heartbeat (WP-M): md-sync reports its vault path, last sync, pending work and version to
 * kortex.sync_status (one row per user and device, service role). The web settings show it and
 * can ask for a sync by setting sync_requested_at; the daemon sees that via Realtime (or on its
 * next heartbeat), runs a full reconcile and writes sync_handled_at.
 */

export interface HeartbeatRow {
  user_id: string;
  device_id: string;
  device_name: string;
  vault_path: string;
  daemon_version: string;
  state: "running" | "stopped" | "error";
  realtime: "connected" | "disconnected" | null;
  last_heartbeat_at: string;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  pending_local: number;
  pending_ingest: number;
  items_tracked: number | null;
  stats: Record<string, number>;
  sync_handled_at?: string;
}

export interface SyncRequest {
  sync_requested_at: string | null;
  sync_handled_at: string | null;
}

/** Storage side of the heartbeat (Supabase in the daemon, a fake in tests). */
export interface HeartbeatPort {
  upsert(row: HeartbeatRow): Promise<void>;
  readRequest(): Promise<SyncRequest | null>;
  /** Calls back on changes of this device's row (the web app's sync request). */
  subscribe(onChange: () => void): Unsubscribe;
}

/** What the heartbeat needs from the engine. */
export type HeartbeatEngine = Pick<SyncEngine, "on" | "off" | "reconcile" | "pendingWork">;

export interface SyncHeartbeatOptions {
  port: HeartbeatPort;
  engine: HeartbeatEngine;
  ingestor?: { readonly pending: number } | null;
  /** Dropzone counters (processed / duplicates / failed / pending) go into `stats`. */
  dropzone?: { readonly stats: { processed: number; duplicates: number; failed: number; pending: number } } | null;
  userId: string;
  deviceId: string;
  deviceName: string;
  vaultPath: string;
  version: string;
  /** Realtime state at start (later changes come from the engine's remote-status events). */
  realtime?: "connected" | "disconnected" | null;
  /** Regular beat (the web app calls a daemon offline after ~3 missed beats). Default 60 s. */
  intervalMs?: number;
  /** Debounce of beats after sync activity. Default 2 s. */
  activityDelayMs?: number;
  logger: Logger;
  now?: () => Date;
  /** Sees every row before it is written (desktop sidecar: status line on stdout). */
  onBeat?: (row: HeartbeatRow) => void;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);

/** Stable id of this daemon: host + a hash of the vault path (KORTEX_DEVICE_ID overrides). */
export function deviceIdFor(vaultPath: string, host = os.hostname(), override?: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "");
  if (override?.trim()) return clean(override.trim()).slice(0, 120) || "device";
  const hash = createHash("sha256").update(path.resolve(vaultPath).toLowerCase()).digest("hex").slice(0, 8);
  return `${clean(host).slice(0, 100) || "host"}.${hash}`;
}

/** Version of @kortex/md-sync (package.json). */
export function daemonVersion(): string {
  try {
    const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
    return (JSON.parse(readFileSync(pkg, "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export class SyncHeartbeat {
  private readonly now: () => Date;
  private timer: ReturnType<typeof setInterval> | undefined;
  private soon: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: Unsubscribe | null = null;
  private realtime: HeartbeatRow["realtime"] = null;
  private lastSyncAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private lastError: string | null = null;
  private lastErrorAt: string | null = null;
  private stats: Record<string, number> = {};
  private handling = false;
  private stopped = false;
  private writing: Promise<void> = Promise.resolve();
  private readonly onRec = (st: ReconcileStats) => this.onReconciled(st);
  private readonly onAct = () => this.activity();
  private readonly onErr = (e: SyncErrorEvent) => {
    this.lastError = `${e.context}: ${errText(e.error)}`.slice(0, 1000);
    this.lastErrorAt = this.now().toISOString();
    this.beatSoon();
  };
  private readonly onStatus = (e: { status: RemoteStatus }) => {
    this.realtime = e.status;
    this.beatSoon();
  };

  constructor(private readonly o: SyncHeartbeatOptions) {
    this.now = o.now ?? (() => new Date());
    this.realtime = o.realtime ?? null;
  }

  /**
   * Starts beating. `initial` = stats of the daemon's start-up reconcile, `startErrors` = the
   * `sync-error` events of `engine.start()` (they fire before the heartbeat listens; without them
   * an unreachable Supabase looked like a clean "running").
   */
  async start(initial?: ReconcileStats, startErrors: readonly SyncErrorEvent[] = []): Promise<this> {
    const last = startErrors.at(-1);
    if (last) {
      this.lastError = `${last.context}: ${errText(last.error)}`.slice(0, 1000);
      this.lastErrorAt = this.now().toISOString();
    } else if (initial?.errors) {
      this.lastError = t("reconcile: {n} errors at start", { n: initial.errors });
      this.lastErrorAt = this.now().toISOString();
    }
    if (initial) this.onReconciled(initial);
    const e = this.o.engine;
    e.on("reconciled", this.onRec);
    e.on("pushed", this.onAct);
    e.on("pulled", this.onAct);
    e.on("sync-error", this.onErr);
    e.on("remote-status", this.onStatus);
    await this.beat();
    this.unsubscribe = this.o.port.subscribe(() => void this.checkRequest());
    this.timer = setInterval(() => {
      void this.beat();
      void this.checkRequest(); // fallback when a Realtime event got lost
    }, this.o.intervalMs ?? 60_000);
    // A request made while the daemon was off is handled right away.
    await this.checkRequest();
    return this;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.soon) clearTimeout(this.soon);
    const e = this.o.engine;
    e.off("reconciled", this.onRec);
    e.off("pushed", this.onAct);
    e.off("pulled", this.onAct);
    e.off("sync-error", this.onErr);
    e.off("remote-status", this.onStatus);
    await this.unsubscribe?.();
    await this.writing;
    await this.write("stopped");
  }

  private onReconciled(s: ReconcileStats): void {
    this.stats = { ...s };
    if (!s.errors) this.lastSuccessAt = this.now().toISOString();
    if (s.pulled || s.pushed || s.removedLocal || s.removedRemote) this.lastSyncAt = this.now().toISOString();
    this.beatSoon();
  }

  private activity(): void {
    this.lastSyncAt = this.now().toISOString();
    this.beatSoon();
  }

  private beatSoon(): void {
    if (this.stopped || this.soon) return;
    this.soon = setTimeout(() => {
      this.soon = undefined;
      void this.beat();
    }, this.o.activityDelayMs ?? 2000);
  }

  /** Writes the current state (serialised, so beats never overtake each other). */
  beat(): Promise<void> {
    if (this.stopped) return this.writing;
    return this.write("running");
  }

  private write(state: HeartbeatRow["state"], extra: Partial<HeartbeatRow> = {}): Promise<void> {
    const work = this.o.engine.pendingWork();
    const row: HeartbeatRow = {
      user_id: this.o.userId,
      device_id: this.o.deviceId,
      device_name: this.o.deviceName,
      vault_path: this.o.vaultPath,
      daemon_version: this.o.version,
      state,
      realtime: this.realtime,
      last_heartbeat_at: this.now().toISOString(),
      last_sync_at: this.lastSyncAt,
      last_success_at: this.lastSuccessAt,
      last_error: this.lastError,
      last_error_at: this.lastErrorAt,
      pending_local: work.local,
      pending_ingest: this.o.ingestor?.pending ?? 0,
      items_tracked: work.tracked,
      stats: this.o.dropzone
        ? {
            ...this.stats,
            dropzone_processed: this.o.dropzone.stats.processed,
            dropzone_duplicates: this.o.dropzone.stats.duplicates,
            dropzone_failed: this.o.dropzone.stats.failed,
            dropzone_pending: this.o.dropzone.stats.pending,
          }
        : this.stats,
      ...extra,
    };
    try {
      this.o.onBeat?.(row);
    } catch {
      // A status observer must never stop the beat.
    }
    this.writing = this.writing
      .then(() => this.o.port.upsert(row))
      .catch((error: unknown) => this.o.logger.warn("heartbeat failed", { error: errText(error) }));
    return this.writing;
  }

  /** Runs a full reconcile when the web app asked for a sync after the last one handled. */
  async checkRequest(): Promise<boolean> {
    if (this.handling || this.stopped) return false;
    let req: SyncRequest | null;
    try {
      req = await this.o.port.readRequest();
    } catch (error) {
      this.o.logger.warn("sync request check failed", { error: errText(error) });
      return false;
    }
    const asked = req?.sync_requested_at ? Date.parse(req.sync_requested_at) : NaN;
    const done = req?.sync_handled_at ? Date.parse(req.sync_handled_at) : NaN;
    if (Number.isNaN(asked) || (!Number.isNaN(done) && done >= asked)) return false;
    this.handling = true;
    try {
      this.o.logger.info("sync requested from the web app, reconciling");
      const stats = await this.o.engine.reconcile();
      this.onReconciled(stats);
      if (this.soon) {
        clearTimeout(this.soon);
        this.soon = undefined;
      }
      await this.write("running", { sync_handled_at: this.now().toISOString() });
      this.o.logger.info("requested sync done", { ...stats });
      return true;
    } finally {
      this.handling = false;
    }
  }
}

/** Heartbeat storage on Supabase (service role: every query is scoped to the user explicitly). */
export function createSupabaseHeartbeatPort(client: KortexClient, userId: string, deviceId: string): HeartbeatPort {
  return {
    async upsert(row) {
      const { error } = await client.from("sync_status").upsert(row, { onConflict: "user_id,device_id" });
      if (error) throw new Error(error.message);
    },
    async readRequest() {
      const { data, error } = await client
        .from("sync_status")
        .select("sync_requested_at, sync_handled_at")
        .eq("user_id", userId)
        .eq("device_id", deviceId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as SyncRequest | null;
    },
    subscribe(onChange) {
      const channel = client
        .channel(`kortex-md-sync-status:${userId}:${deviceId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: KORTEX_SCHEMA, table: "sync_status", filter: `user_id=eq.${userId}` },
          (payload) => {
            const row = payload.new as { device_id?: string } & Partial<SyncRequest>;
            // Only a pending request matters (the daemon's own beats update this row too).
            if (row.device_id !== deviceId || !row.sync_requested_at) return;
            if (row.sync_handled_at && Date.parse(row.sync_handled_at) >= Date.parse(row.sync_requested_at)) return;
            onChange();
          },
        )
        .subscribe();
      return async () => {
        await client.removeChannel(channel);
      };
    },
  };
}
