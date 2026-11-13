#!/usr/bin/env node
/**
 * md-sync daemon entry: `pnpm --filter @kortex/md-sync start`
 *
 * Two auth modes (see README and config.ts):
 * - service: KORTEX_VAULT_PATH, KORTEX_USER_ID, SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL),
 *   SUPABASE_SERVICE_ROLE_KEY; for AI enrichment any ADR-06 key: ANTHROPIC_API_KEY (alias
 *   CLAUDE_API_KEY), OPENROUTER_API_KEY, EDENAI_API_KEY (+ KORTEX_SYNC_INGEST_*).
 * - token (desktop sidecar): KORTEX_VAULT_PATH, KORTEX_API_URL, KORTEX_SYNC_TOKEN (personal kx_
 *   token with the scope `sync`). Runs under RLS as the token's owner, no service key on the PC.
 * Reads the repo's `.env.local` / `.env` if present (service mode only).
 */
import { applyUserLocale } from "./i18n";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSupabaseUsageLedger } from "@kortex/ai-core";
import { createKortexClient, type KortexClient } from "@kortex/db";
import { Dropzone } from "./dropzone";
import { VaultAgentsFile } from "./agents-file";
import { createVaultPipeline } from "./ai-routing";
import { ConfigError, loadEnvFiles, readConfig } from "./config";
import { SyncEngine, type SyncErrorEvent } from "./engine";
import {
  createSupabaseHeartbeatPort,
  daemonVersion,
  deviceIdFor,
  SyncHeartbeat,
  type HeartbeatRow,
} from "./heartbeat";
import { VaultIngestor } from "./ingest";
import { createConsoleLogger } from "./logger";
import { ApiDropzoneStore } from "./remote/api-dropzone-store";
import { SupabaseDropzoneStore, type DropzoneStore } from "./remote/dropzone-store";
import { SupabaseRemoteStore } from "./remote/supabase";
import { createTokenClient, SyncUnavailableError, TokenAuthError, TokenSession } from "./remote/token-session";
import { statusLine } from "./status-line";
import { acquireVaultLock, VaultLockedError } from "./vault-lock";
import { DROPZONE_FOLDER } from "./vault-layout";

/**
 * Exit codes the desktop sidecar maps to a status (vault.rs): 2 = config, 3 = token rejected,
 * 4 = server has no vault sync, 5 = another md-sync already runs on this vault. These do not
 * restart; any other exit does (with backoff).
 */
const EXIT_CONFIG = 2;
const EXIT_AUTH = 3;
const EXIT_UNAVAILABLE = 4;
const EXIT_LOCKED = 5;

/** Machine-readable status lines for the desktop sidecar (KORTEX_SYNC_STATUS_STDOUT=1). */
const statusOut = process.env.KORTEX_SYNC_STATUS_STDOUT === "1";
function emit(kind: "status" | "fatal", payload: Record<string, unknown>): void {
  if (statusOut) process.stdout.write(statusLine(kind, payload));
}

async function main(): Promise<void> {
  if (!process.env.KORTEX_SYNC_TOKEN?.trim()) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "../../..");
    const pkgRoot = path.resolve(here, "..");
    loadEnvFiles([
      path.join(pkgRoot, ".env.local"),
      path.join(pkgRoot, ".env"),
      path.join(repoRoot, ".env.local"),
      path.join(repoRoot, ".env"),
    ]);
  }

  const config = readConfig();
  const log = createConsoleLogger(config.logLevel);
  const auth = config.auth;

  let client: KortexClient;
  let userId: string;
  let session: TokenSession | null = null;
  if (auth.mode === "token") {
    session = new TokenSession({ apiUrl: auth.apiUrl, token: auth.token });
    ({ client, userId } = await createTokenClient(session));
  } else {
    userId = auth.userId;
    client = createKortexClient(auth.supabaseUrl, auth.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  // Single-user process: the account's language once at start-up (no row or value: English).
  const locale = await applyUserLocale(client, userId);
  // One daemon per vault (desktop sidecar and a CLI/pm2 daemon must never sync the same folder).
  const lock = acquireVaultLock(config.vaultPath, os.hostname());
  const remote = new SupabaseRemoteStore(client, null, userId, { userScoped: auth.mode === "token" });
  const engine = new SyncEngine({
    vaultPath: config.vaultPath,
    remote,
    localDeleteMode: config.localDeleteMode,
    reconcileIntervalMs: config.reconcileIntervalMs,
    allowMassDelete: config.allowMassDelete,
    usePolling: config.usePolling,
    logger: log,
  });
  let realtime: "connected" | "disconnected" | null = null;
  engine.on("remote-status", ({ status, detail }) => {
    realtime = status;
    log.info(`realtime ${status}`, detail ? { detail } : undefined);
  });

  // AI enrichment of vault files (agent memories, optionally the inbox) via @kortex/ai-core.
  // Service mode only: in token mode the PC holds no provider keys and the server meters AI use.
  let ingestor: VaultIngestor | null = null;
  // Daily AI budget + usage log, same table and prices as the web server (service role writes).
  const ledger =
    auth.mode === "service"
      ? createSupabaseUsageLedger({
          client,
          userId,
          env: process.env,
          onError: (message, error) => log.warn(message, { error: String(error) }),
        })
      : undefined;
  const vault =
    config.ingest.enabled && ledger
      ? await remote
          .bootstrapUser() // the embedding lock lives in user_settings
          .then(() =>
            createVaultPipeline({
              client,
              userId,
              env: process.env,
              logger: log,
              ledger,
            }),
          )
          .catch((error: unknown) => {
            log.error("ai routing failed, ai ingest disabled", { error: String(error) });
            return null;
          })
      : null;
  if (vault && ledger) {
    // Same routing as the web app (ADR-06); OpenRouter always with data_collection = 'deny'.
    const { pipeline } = vault;
    ingestor = new VaultIngestor({
      engine,
      store: remote,
      pipeline,
      folders: config.ingest.folders,
      debounceMs: config.ingest.debounceMs,
      ledger,
      logger: log,
    }).start();
    log.info("ai ingest enabled", { folders: config.ingest.folders });
  } else {
    log.info("ai ingest disabled", { reason: config.ingest.disabledReason ?? "ai routing failed" });
  }

  log.info("md-sync starting", { vault: config.vaultPath, user: userId, auth: auth.mode, locale });
  // Errors of the start-up reconcile (Supabase unreachable, ...) go into the first heartbeat.
  const startErrors: SyncErrorEvent[] = [];
  const onStartError = (e: SyncErrorEvent) => startErrors.push(e);
  engine.on("sync-error", onStartError);
  const stats = await engine.start();
  engine.off("sync-error", onStartError);
  if (stats.errors) log.warn("md-sync running with errors", { ...stats, error: String(startErrors.at(-1)?.error ?? "") });
  else log.info("md-sync running", { ...stats });
  // Dropzone: non-Markdown files in 00_Inbox/Dropzone/ go to Kortex (docs/dropzone.md).
  // Token mode hands them to POST /api/ingest (dedup, budget and queue on the server).
  let dropzone: Dropzone | null = null;
  if (config.dropzone.enabled) {
    const store: DropzoneStore =
      auth.mode === "token"
        ? new ApiDropzoneStore(auth.apiUrl, auth.token)
        : new SupabaseDropzoneStore(client, userId);
    dropzone = await new Dropzone({
      vaultPath: config.vaultPath,
      store,
      extensions: config.dropzone.extensions,
      maxBytes: config.dropzone.maxBytes,
      ledger,
      logger: log,
    }).start();
  } else {
    log.info("dropzone disabled", { reason: "KORTEX_SYNC_DROPZONE=0" });
  }
  const deviceId = deviceIdFor(config.vaultPath, os.hostname(), process.env.KORTEX_DEVICE_ID);
  const onBeat = (row: HeartbeatRow) =>
    emit("status", {
      state: row.state,
      realtime: row.realtime,
      vault_path: row.vault_path,
      dropzone_path: dropzone ? path.join(config.vaultPath, DROPZONE_FOLDER) : null,
      device_id: row.device_id,
      version: row.daemon_version,
      last_sync_at: row.last_sync_at,
      last_success_at: row.last_success_at,
      last_error: row.last_error,
      last_error_at: row.last_error_at,
      pending_local: row.pending_local,
      items_tracked: row.items_tracked,
      stats: row.stats,
      at: row.last_heartbeat_at,
    });
  // Heartbeat for the web settings (vault card, "Sync" button); KORTEX_SYNC_HEARTBEAT=0 turns it off.
  let heartbeat: SyncHeartbeat | null = null;
  if (process.env.KORTEX_SYNC_HEARTBEAT !== "0") {
    heartbeat = await new SyncHeartbeat({
      port: createSupabaseHeartbeatPort(client, userId, deviceId),
      engine,
      ingestor,
      dropzone,
      userId,
      deviceId,
      deviceName: process.env.KORTEX_DEVICE_NAME?.trim() || os.hostname(),
      vaultPath: config.vaultPath,
      version: process.env.KORTEX_SYNC_VERSION?.trim() || daemonVersion(),
      realtime, // Realtime usually connects during engine.start(), before the heartbeat listens
      logger: log,
      onBeat,
    }).start(stats, startErrors);
    log.info("heartbeat on", { device: deviceId });
  }
  // <vault>/agents.md: routing guide + folder index for agents reading the vault (G6).
  const agentsFile =
    process.env.KORTEX_SYNC_AGENTS_FILE === "0"
      ? null
      : await new VaultAgentsFile({ engine, logger: log }).start();
  if (ingestor) {
    const queued = await ingestor.backfill();
    if (queued) log.info("ai ingest backfill queued", { items: queued });
  }

  let stopping = false;
  let tokenCheck: ReturnType<typeof setInterval> | undefined;
  const shutdown = async (signal: string, code = 0) => {
    if (stopping) return;
    stopping = true;
    log.info(`received ${signal}, stopping`);
    if (tokenCheck) clearInterval(tokenCheck);
    await heartbeat?.stop().catch(() => {});
    await agentsFile?.stop();
    await dropzone?.stop();
    await ingestor?.stop();
    await vault?.close();
    await engine.stop();
    lock.release();
    process.exit(code);
  };
  // Token mode: a revoked or expired token stops the daemon (exit 3) instead of failing quietly.
  if (session) {
    const s = session;
    tokenCheck = setInterval(() => {
      s.session().catch((error: unknown) => {
        if (!(error instanceof TokenAuthError)) return;
        emit("fatal", { kind: "auth", message: error.message });
        log.error("sync token rejected, stopping", { error: error.message });
        void shutdown("token rejected", EXIT_AUTH);
      });
    }, 5 * 60_000);
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // PM2 on Windows sends a 'shutdown' message instead of signals.
  process.on("message", (msg) => msg === "shutdown" && void shutdown("shutdown"));
  // Desktop sidecar: Windows has no SIGTERM for child processes, so the app closes stdin (or
  // writes "stop") for a clean stop; a vanished parent closes it too. "sync" = full reconcile now.
  if (process.env.KORTEX_SYNC_STOP_ON_STDIN_END === "1") {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      for (const cmd of chunk.split(/\r?\n/).map((c) => c.trim())) {
        if (cmd === "stop") void shutdown("stop");
        if (cmd === "sync")
          void engine
            .reconcile()
            .then(async (s) => {
              log.info("sync requested from the desktop", { ...s });
              await heartbeat?.beat();
            })
            .catch((error: unknown) => log.warn("requested sync failed", { error: String(error) }));
      }
    });
    process.stdin.on("end", () => void shutdown("stdin closed"));
    process.stdin.resume();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    emit("fatal", { kind: "config", message: error.message });
    console.error(`md-sync: ${error.message}`);
    process.exit(EXIT_CONFIG);
  }
  if (error instanceof TokenAuthError) {
    emit("fatal", { kind: "auth", message: error.message });
    console.error(`md-sync: ${error.message}`);
    process.exit(EXIT_AUTH);
  }
  if (error instanceof SyncUnavailableError) {
    emit("fatal", { kind: "unavailable", message: error.message });
    console.error(`md-sync: ${error.message}`);
    process.exit(EXIT_UNAVAILABLE);
  }
  if (error instanceof VaultLockedError) {
    emit("fatal", { kind: "locked", message: error.message });
    console.error(`md-sync: ${error.message}`);
    process.exit(EXIT_LOCKED);
  }
  emit("fatal", { kind: "error", message: error instanceof Error ? error.message : String(error) });
  console.error(error);
  process.exit(1);
});
