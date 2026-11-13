import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import type { FSWatcher } from "chokidar";
import { EchoLock } from "./echo-lock";
import {
  FrontmatterError,
  canonicalFolderPath,
  canonicalFromFile,
  canonicalFromItem,
  checksumOf,
  itemWriteFromCanonical,
  normalizeTimestamp,
  parseMarkdown,
  renderMarkdown,
  type CanonicalDoc,
  type ParsedMarkdown,
} from "./frontmatter";
import {
  exists,
  isUnderDir,
  moveFile,
  moveToTrash,
  readTextIfExists,
  removeDirIfEmpty,
  scanVault,
  statIfExists,
  writeFileAtomic,
} from "./fs-utils";
import { silentLogger, type Logger } from "./logger";
import {
  CASE_INSENSITIVE_FS,
  compactTimestamp,
  dirnameRel,
  isIgnoredRel,
  isSyncableFile,
  isUuid,
  joinRel,
  localFolderPath,
  normalizeFolderPath,
  samePath,
  sanitizeName,
  slugify,
  stemOf,
  toAbs,
} from "./paths";
import { SerialQueue } from "./queue";
import { RemoteIdConflictError } from "./remote/supabase";
import { DuplicateItemError, type RemoteStore } from "./remote/store";
import { SyncState } from "./state";
import type { RemoteChange, RemoteStatus, SyncItem, Unsubscribe } from "./types";
import {
  AI_MEMORIES_FOLDER,
  INBOX_FOLDER,
  KORTEX_DIR,
  bootstrapVault,
  inferTypeFromFolder,
  isInFolder,
} from "./vault-layout";
import { watchVault } from "./watcher";

export interface AiMemoryEvent {
  id: string;
  path: string;
  title: string;
  folderPath: string;
}

export interface ConflictEvent {
  id: string;
  winner: "local" | "remote";
  /** Where the winning version now lives. */
  path: string;
  /** `<slug>.conflict-<timestamp>.md` with the losing version (local only, never synced). */
  conflictPath: string;
}

export interface DuplicateEvent {
  /** The existing item the new file was merged into. */
  id: string;
  reason: string;
  /** Where the new file was (it never became an item of its own). */
  path: string;
  /** The file kept next to it as `<slug>.conflict-<ts>.md` (local only, never synced). */
  keptAs: string;
}

export interface SyncErrorEvent {
  error: unknown;
  context: string;
  id?: string;
  path?: string;
}

export interface ReconcileStats {
  pulled: number;
  pushed: number;
  conflicts: number;
  removedLocal: number;
  removedRemote: number;
  unchanged: number;
  errors: number;
}

export interface SyncEngineEvents {
  pulled: [{ id: string; path: string }];
  pushed: [{ id: string; path: string; created: boolean }];
  "local-removed": [{ id: string; path: string; trashPath: string }];
  "remote-removed": [{ id: string; path: string; mode: LocalDeleteMode }];
  conflict: [ConflictEvent];
  duplicate: [DuplicateEvent];
  "ai-memory": [AiMemoryEvent];
  "local-write": [{ path: string }];
  "remote-status": [{ status: RemoteStatus; detail?: string }];
  reconciled: [ReconcileStats];
  "sync-error": [SyncErrorEvent];
}

export type LocalDeleteMode = "archive" | "delete";

export interface SyncEngineOptions {
  vaultPath: string;
  remote: RemoteStore;
  /** Start the chokidar watcher (tests can drive the handlers directly). Default true. */
  watch?: boolean;
  usePolling?: boolean;
  /** awaitWriteFinish stability threshold (spec: 400 ms). */
  stabilityThreshold?: number;
  /** A deleted file only counts as deleted after this long: a move is unlink + add. */
  deleteGraceMs?: number;
  /** How long the daemon's own writes/removals are ignored by the watcher. */
  echoLockMs?: number;
  /** What a local file deletion does remotely. Default `archive` (status = 'archived'). */
  localDeleteMode?: LocalDeleteMode;
  /** More destructive actions than this in one batch/reconcile are held back. */
  massDeleteThreshold?: number;
  allowMassDelete?: boolean;
  /** Safety-net full reconcile interval (Realtime can drop events). 0 = off. */
  reconcileIntervalMs?: number;
  /** Call `kortex._bootstrap_user` on start. Default true. */
  bootstrapRemote?: boolean;
  /** Hook for the ingest pipeline: new files in `40_AI_Memories/`. */
  onAiMemory?: (event: AiMemoryEvent) => void | Promise<void>;
  now?: () => Date;
  logger?: Logger;
}

interface LoadedFile {
  rel: string;
  raw: string;
  parsed: ParsedMarkdown;
  declaredId: string | null;
  declaredChecksum: string | null;
  declaredFolderPath: string | null;
  mtimeMs: number;
  createdAt: string;
}

interface LocalVersion extends LoadedFile {
  id: string;
  doc: CanonicalDoc;
  hash: string;
  /** The file's frontmatter is out of date in a way worth a write (missing/foreign id, moved). */
  needsRewrite: boolean;
}

interface SyncOptions {
  suppressDestructive?: boolean;
  /** The local file was just unlinked and may reappear (move): don't propagate a delete yet. */
  deferLocalDelete?: boolean;
  stats?: ReconcileStats;
}

const emptyStats = (): ReconcileStats => ({
  pulled: 0,
  pushed: 0,
  conflicts: 0,
  removedLocal: 0,
  removedRemote: 0,
  unchanged: 0,
  errors: 0,
});

const sameName = (a: string, b: string) =>
  CASE_INSENSITIVE_FS ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * The 2-way sync state machine (spec 02, section 7.1).
 *
 * Every item is compared three ways: local file (L), remote row (R) and the last agreed
 * version (base: `.kortex/state.json`, falling back to the frontmatter `checksum`).
 * Only the side that moved away from the base is propagated; if both moved, the newer
 * `updated_at` wins and the loser is kept as `<slug>.conflict-<timestamp>.md`.
 */
export class SyncEngine extends EventEmitter<SyncEngineEvents> {
  readonly vaultPath: string;
  private readonly remote: RemoteStore;
  private readonly opts: Required<
    Omit<SyncEngineOptions, "vaultPath" | "remote" | "onAiMemory" | "now" | "logger">
  >;
  private readonly now: () => Date;
  private readonly log: Logger;
  private readonly queue = new SerialQueue();
  private readonly echo: EchoLock;
  private state!: SyncState;
  private watcher: FSWatcher | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private deleteTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingDeletes = new Set<string>();
  private readonly pendingDirRemovals = new Set<string>();
  private reconcilePending: Promise<ReconcileStats> | null = null;
  private realtimeDown = false;
  private started = false;
  private stopped = false;

  constructor(private readonly options: SyncEngineOptions) {
    super();
    this.vaultPath = options.vaultPath;
    this.remote = options.remote;
    this.now = options.now ?? (() => new Date());
    this.log = options.logger ?? silentLogger;
    this.opts = {
      watch: options.watch ?? true,
      usePolling: options.usePolling ?? false,
      stabilityThreshold: options.stabilityThreshold ?? 400,
      deleteGraceMs: options.deleteGraceMs ?? 2500,
      echoLockMs: options.echoLockMs ?? 3000,
      localDeleteMode: options.localDeleteMode ?? "archive",
      massDeleteThreshold: options.massDeleteThreshold ?? 50,
      allowMassDelete: options.allowMassDelete ?? false,
      reconcileIntervalMs: options.reconcileIntervalMs ?? 10 * 60_000,
      bootstrapRemote: options.bootstrapRemote ?? true,
    };
    this.echo = new EchoLock(this.opts.echoLockMs);
  }

  // ===========================================================================
  // lifecycle
  // ===========================================================================

  async start(): Promise<ReconcileStats> {
    if (this.started) throw new Error("SyncEngine already started");
    this.started = true;
    const created = await bootstrapVault(this.vaultPath, { onError: this.folderError });
    if (created.length) this.log.info("vault bootstrapped", { created });
    this.state = await SyncState.load(this.vaultPath, this.remote.userId);
    if (this.opts.bootstrapRemote) {
      try {
        await this.remote.bootstrapUser();
      } catch (error) {
        this.reportError(error, "bootstrap remote user");
      }
    }
    if (this.opts.watch) {
      this.watcher = await watchVault(
        this.vaultPath,
        {
          file: (rel) => void this.handleLocalFile(rel),
          unlink: (rel) => this.handleLocalUnlink(rel),
          addDir: (rel) => void this.handleLocalDirAdded(rel),
          unlinkDir: (rel) => this.handleLocalDirRemoved(rel),
          error: (error) => this.reportError(error, "watcher"),
        },
        { usePolling: this.opts.usePolling, stabilityThreshold: this.opts.stabilityThreshold },
      );
    }
    this.unsubscribe = this.remote.subscribe({
      onChange: (change) => void this.handleRemoteChange(change),
      onStatus: (status, detail) => this.handleRemoteStatus(status, detail),
    });
    const stats = await this.reconcile();
    if (this.opts.reconcileIntervalMs > 0) {
      this.reconcileTimer = setInterval(() => void this.reconcile(), this.opts.reconcileIntervalMs);
      this.reconcileTimer.unref?.();
    }
    return stats;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.reconcileTimer);
    clearTimeout(this.deleteTimer);
    this.deleteTimer = undefined;
    await this.unsubscribe?.();
    await this.watcher?.close();
    await this.queue.idle();
    clearTimeout(this.saveTimer);
    if (this.state) await this.state.save();
  }

  /** Resolves when all queued work (incl. pending delete batches) is done. For tests/CLI. */
  /** Work not yet done, for the heartbeat: held-back deletes and the number of tracked files. */
  pendingWork(): { local: number; tracked: number | null } {
    return {
      local: this.pendingDeletes.size + this.pendingDirRemovals.size,
      tracked: this.state ? this.state.itemIds().length : null,
    };
  }

  async idle(): Promise<void> {
    for (;;) {
      await this.queue.idle();
      if (!this.deleteTimer) return;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  // ===========================================================================
  // entry points (all serialised through the queue)
  // ===========================================================================

  /**
   * Full 3-way reconcile of vault vs. remote. Calls coalesce with a reconcile that is queued
   * but not started yet; one requested while another runs is queued after it.
   */
  reconcile(): Promise<ReconcileStats> {
    if (this.reconcilePending) return this.reconcilePending;
    const run = this.queue
      .run(() => {
        this.reconcilePending = null;
        return this.doReconcile();
      })
      .catch((error) => {
        this.reportError(error, "reconcile");
        return { ...emptyStats(), errors: 1 };
      });
    this.reconcilePending = run;
    return run;
  }

  /** chokidar add/change for a markdown file. */
  handleLocalFile(rel: string): Promise<void> {
    return this.enqueue(`local change ${rel}`, () => this.onLocalFile(rel), { path: rel });
  }

  /** chokidar unlink. Deletions are batched and delayed so moves (unlink + add) survive. */
  handleLocalUnlink(rel: string): void {
    if (this.stopped || !isSyncableFile(rel) || this.echo.isRemovalEcho(rel)) return;
    const id = this.state.itemIdAtPath(rel);
    if (!id) return;
    this.pendingDeletes.add(id);
    this.scheduleDeleteBatch();
  }

  handleLocalDirAdded(rel: string): Promise<void> {
    return this.enqueue(`local dir ${rel}`, async () => {
      if (isIgnoredRel(rel) || this.state.folderIdAtPath(rel)) return;
      await this.ensureFolderPath(rel);
    });
  }

  handleLocalDirRemoved(rel: string): void {
    if (this.stopped || isIgnoredRel(rel) || this.echo.isRemovalEcho(rel)) return;
    if (!this.state.folderIdAtPath(rel)) return;
    this.pendingDirRemovals.add(rel);
    this.scheduleDeleteBatch();
  }

  handleRemoteChange(change: RemoteChange): Promise<void> {
    return this.enqueue(`remote ${change.table} ${change.op}`, () => this.onRemoteChange(change), {
      id: change.id,
    });
  }

  private handleRemoteStatus(status: RemoteStatus, detail?: string): void {
    this.emit("remote-status", { status, detail });
    if (status === "disconnected") {
      if (!this.realtimeDown) this.log.warn("realtime disconnected", { detail });
      this.realtimeDown = true;
    } else if (this.realtimeDown) {
      // Catch up on whatever happened while the channel was down.
      this.realtimeDown = false;
      this.log.info("realtime reconnected, reconciling");
      void this.reconcile();
    }
  }

  private enqueue(
    context: string,
    job: () => Promise<void>,
    where: { id?: string; path?: string } = {},
  ): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.queue
      .run(job)
      .catch((error) => this.reportError(error, context, where))
      .finally(() => this.scheduleSave());
  }

  /** A folder (or a path in it) that can't be created or read: report, keep syncing the rest. */
  private readonly folderError = (rel: string, error: unknown): void => {
    this.reportError(error, "folder not accessible, skipped", { path: rel });
  };

  /**
   * Whether a vault path still exists. "Can't tell" (EPERM on a folder that is being deleted
   * while a handle is open) counts as still there, so it never turns into a remote delete.
   */
  private async stillThere(rel: string): Promise<boolean> {
    try {
      return await exists(toAbs(this.vaultPath, rel));
    } catch (error) {
      this.folderError(rel, error);
      return true;
    }
  }

  private reportError(
    error: unknown,
    context: string,
    where: { id?: string; path?: string } = {},
  ): void {
    this.log.error(context, {
      ...where,
      error: error instanceof Error ? error.message : String(error),
    });
    this.emit("sync-error", { error, context, ...where });
  }

  private scheduleSave(): void {
    if (this.stopped || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.queue.run(() => this.state.save()).catch((e) => this.reportError(e, "save state"));
    }, 250);
    this.saveTimer.unref?.();
  }

  private scheduleDeleteBatch(): void {
    clearTimeout(this.deleteTimer);
    this.deleteTimer = setTimeout(() => {
      void this.queue
        .run(() => this.processDeleteBatch())
        .catch((e) => this.reportError(e, "delete batch"))
        .finally(() => {
          this.deleteTimer = undefined;
          this.scheduleSave();
        });
    }, this.opts.deleteGraceMs);
  }

  // ===========================================================================
  // local -> cloud
  // ===========================================================================

  private async onLocalFile(relIn: string): Promise<void> {
    if (!isSyncableFile(relIn)) return;
    const rel = relIn.includes("/") ? relIn : await this.moveRootFileToInbox(relIn);
    const loaded = await this.loadLocalReported(rel);
    if (!loaded) return;

    let id = loaded.declaredId;
    if (id) {
      if (this.echo.isWriteEcho(rel, this.toLocalVersion(loaded, id).hash)) return;
      const tracked = this.state.getItem(id);
      if (tracked && !samePath(tracked.path, rel)) {
        // Moved, or copied? A copy still has the original next to it with the same id.
        const original = await this.loadLocal(tracked.path).catch(() => null);
        if (original?.declaredId === id) id = null;
      }
    } else {
      id = this.state.itemIdAtPath(rel) ?? null; // frontmatter stripped from a tracked file
    }
    if (!id) {
      await this.createFromLocal(loaded);
      return;
    }

    this.pendingDeletes.delete(id);
    const local = this.toLocalVersion(loaded, id);
    const tracked = this.state.getItem(id);
    if (
      tracked &&
      tracked.hash === local.hash &&
      samePath(tracked.path, rel) &&
      !local.needsRewrite
    ) {
      return; // nothing new (echo of our own write, or a touch)
    }
    await this.syncItem(id, local, await this.remote.getItem(id), {});
  }

  private async createFromLocal(loaded: LoadedFile, stats?: ReconcileStats): Promise<void> {
    const id = randomUUID();
    // A copy of a tracked file (it still carries the original's id) is a deliberate new item.
    await this.push(id, this.toLocalVersion(loaded, id), null, stats, false, !loaded.declaredId);
  }

  private async push(
    id: string,
    local: LocalVersion,
    remote: SyncItem | null,
    stats?: ReconcileStats,
    retried = false,
    dedup = false,
  ): Promise<void> {
    const folderId = await this.ensureFolderPath(local.doc.folder_path);
    const created = !remote;
    const moved = remote
      ? canonicalFolderPath(remote.folder_path) !== local.doc.folder_path
      : false;
    // Spec 7.1: files the user creates in / moves into a folder are manual placements, which
    // the AI auto-organizer must respect. New files in the inbox are left to the organizer.
    const isManualPlacement = created
      ? local.doc.folder_path !== INBOX_FOLDER
      : moved
        ? true
        : undefined;
    const write = itemWriteFromCanonical(local.doc, {
      slug: this.slugForPush(local.rel, remote, id),
      folderId,
      checksum: local.hash,
      isManualPlacement,
    });

    // A new file that duplicates an existing item (same URL, ISBN, content, object title) is merged
    // into it instead of becoming a second item; the file itself is kept as a local-only copy.
    if (created && dedup && this.remote.mergeIfDuplicate) {
      const hit = await this.remote.mergeIfDuplicate(write);
      if (hit) return this.keepDuplicate(local.rel, hit.id, hit.reason);
    }

    let row: SyncItem;
    try {
      row = await this.remote.upsertItem(write);
    } catch (error) {
      if (error instanceof DuplicateItemError)
        return this.keepDuplicate(local.rel, error.existingId, error.reason);
      if (error instanceof RemoteIdConflictError && !retried) {
        // The id in the file belongs to someone else's row: give this file a fresh identity.
        const freshId = randomUUID();
        this.log.warn("foreign item id in file, assigning a new one", { path: local.rel, id });
        await this.push(freshId, this.toLocalVersion(local, freshId), null, stats, true);
        return;
      }
      throw error;
    }

    this.state.setItem(id, { path: local.rel, hash: local.hash, remoteUpdatedAt: row.updated_at });
    if (local.needsRewrite) await this.writeLocal(local.rel, local.doc, row.updated_at, local.hash);
    if (stats) stats.pushed++;
    this.log.info(created ? "pushed new item" : "pushed item", { id, path: local.rel });
    this.emit("pushed", { id, path: local.rel, created });

    if (created && isInFolder(local.doc.folder_path, AI_MEMORIES_FOLDER)) {
      const event: AiMemoryEvent = {
        id,
        path: local.rel,
        title: local.doc.title,
        folderPath: local.doc.folder_path,
      };
      this.emit("ai-memory", event);
      try {
        await this.options.onAiMemory?.(event);
      } catch (error) {
        this.reportError(error, "onAiMemory hook", { id, path: local.rel });
      }
    }
  }

  /** Keeps the DB slug when the file name is just its (sanitised / de-duplicated) form. */
  private slugForPush(rel: string, remote: SyncItem | null, id: string): string {
    const stem = stemOf(rel);
    if (remote) {
      const safe = sanitizeName(remote.slug || remote.title);
      if (sameName(stem, safe) || sameName(stem, `${safe}-${id.slice(0, 8)}`)) return remote.slug;
    }
    return stem;
  }

  private async processDeleteBatch(): Promise<void> {
    const ids = [...this.pendingDeletes];
    const dirs = [...this.pendingDirRemovals];
    this.pendingDeletes.clear();
    this.pendingDirRemovals.clear();

    // Unplugged drive / vault moved away: everything "disappears". Never propagate that.
    if (!(await exists(this.vaultPath)) || !(await exists(toAbs(this.vaultPath, KORTEX_DIR)))) {
      this.reportError(new Error("vault folder is missing"), "local deletes not propagated");
      return;
    }

    const confirmed: string[] = [];
    for (const id of ids) {
      const tracked = this.state.getItem(id);
      if (tracked && !(await this.stillThere(tracked.path))) confirmed.push(id);
    }
    if (confirmed.length > this.opts.massDeleteThreshold && !this.opts.allowMassDelete) {
      this.reportError(
        new Error(`${confirmed.length} local deletions at once - held back (mass delete guard)`),
        "local deletes not propagated",
      );
      return;
    }
    for (const id of confirmed) {
      try {
        await this.syncItem(id, null, await this.remote.getItem(id), {});
      } catch (error) {
        this.reportError(error, "propagate local delete", { id });
      }
    }

    // Deepest first, so children are gone before their parents.
    for (const rel of dirs.sort((a, b) => b.length - a.length)) {
      if (await this.stillThere(rel)) continue; // came back (rename), or can't tell
      const folderId = this.state.folderIdAtPath(rel);
      const folder = folderId ? this.state.getFolder(folderId) : undefined;
      if (!folderId || !folder || folder.system) continue; // system folders are recreated
      try {
        await this.remote.deleteFolder(folderId);
        for (const [fid, f] of this.state.folderEntries()) {
          if (f.path === rel || f.path.startsWith(`${rel}/`)) this.state.deleteFolder(fid);
        }
        this.log.info("deleted folder", { path: rel });
      } catch (error) {
        this.reportError(error, "delete folder", { path: rel });
      }
    }
  }

  /** Creates folder rows for every segment of a path. Returns the deepest folder id. */
  private async ensureFolderPath(folderPath: string): Promise<string | null> {
    let parentId: string | null = null;
    let current = "";
    for (const segment of normalizeFolderPath(folderPath).split("/").filter(Boolean)) {
      current = joinRel(current, segment);
      let id = this.state.folderIdAtPath(current);
      if (!id) {
        const folder = await this.remote.createFolder({
          folder_path: current,
          name: segment,
          slug: slugify(segment),
          parent_id: parentId,
        });
        id = folder.id;
        this.state.setFolder(id, { path: current, system: folder.is_system_default === true });
        this.log.info("created folder", { path: current });
      }
      parentId = id;
    }
    return parentId;
  }

  /** Files at the vault root have no folder: they are moved into the inbox. */
  private async moveRootFileToInbox(rel: string): Promise<string> {
    const stem = stemOf(rel);
    let target = joinRel(INBOX_FOLDER, `${stem}.md`);
    for (let n = 1; await exists(toAbs(this.vaultPath, target)); n++) {
      target = joinRel(INBOX_FOLDER, `${stem}-${n}.md`);
    }
    this.echo.lockRemoval(rel);
    this.echo.lockWrite(target, null);
    await moveFile(toAbs(this.vaultPath, rel), toAbs(this.vaultPath, target));
    this.log.info("moved root file into inbox", { from: rel, to: target });
    return target;
  }

  // ===========================================================================
  // cloud -> local
  // ===========================================================================

  private async onRemoteChange(change: RemoteChange): Promise<void> {
    if (change.table === "folders") return this.onRemoteFolderChange(change);
    if (change.table === "action_items") {
      // Task edited elsewhere: re-render the note's task section; the note update then syncs as usual.
      // Rendering is a fixed point, so the echo of a vault edit changes nothing (no loop).
      const source = change.sourceItemId;
      if (source && this.state.getItem(source)) await this.remote.refreshTaskSection?.(source);
      return;
    }

    const tracked = this.state.getItem(change.id);
    const remote = change.op === "delete" ? null : await this.remote.getItem(change.id);
    if (!tracked && (!remote || remote.status === "archived")) return; // not ours / never materialised
    // Echo of our own push (or nothing that touched the row since our last sync).
    if (tracked && remote && remote.updated_at === tracked.remoteUpdatedAt) return;

    let local: LocalVersion | null = null;
    try {
      if (tracked) {
        local = await this.loadLocalVersionFor(tracked.path, change.id);
      } else if (remote) {
        local = await this.loadLocalVersionFor(await this.targetPathFor(remote, null), change.id);
      }
    } catch (error) {
      if (error instanceof FrontmatterError) {
        // Can't compare with a half-edited file; the next change/reconcile will resolve it.
        this.reportError(error, "remote change skipped, local file unreadable", {
          id: change.id,
          path: tracked?.path,
        });
        return;
      }
      throw error;
    }
    await this.syncItem(change.id, local, remote, {
      deferLocalDelete: this.pendingDeletes.has(change.id),
    });
  }

  private async onRemoteFolderChange(change: RemoteChange): Promise<void> {
    const previous = this.state.getFolder(change.id);
    if (change.op === "delete") {
      if (!previous) return;
      this.state.deleteFolder(change.id);
      const dir = localFolderPath(previous.path);
      if (dir) {
        this.echo.lockRemoval(dir);
        await removeDirIfEmpty(toAbs(this.vaultPath, dir)); // never deletes files
      }
      return;
    }
    const folder = await this.remote.getFolder(change.id);
    if (!folder) return;
    const folderPath = normalizeFolderPath(folder.folder_path);
    this.state.setFolder(folder.id, {
      path: folderPath,
      system: folder.is_system_default === true,
    });
    const dir = localFolderPath(folderPath);
    if (dir) await mkdir(toAbs(this.vaultPath, dir), { recursive: true });
    if (previous && previous.path !== folderPath) {
      // Renamed in the app: items follow via their own updates; drop the old dir once empty.
      const oldDir = localFolderPath(previous.path);
      this.echo.lockRemoval(oldDir);
      await removeDirIfEmpty(toAbs(this.vaultPath, oldDir));
    }
  }

  private async pull(
    id: string,
    remote: SyncItem,
    oldRel: string | null,
    stats?: ReconcileStats,
  ): Promise<void> {
    const doc = canonicalFromItem(remote);
    const hash = checksumOf(doc);
    const rel = await this.targetPathFor(remote, oldRel);
    await this.writeLocal(rel, doc, remote.updated_at, hash);
    if (oldRel && !samePath(oldRel, rel)) {
      await this.removeOwnFile(oldRel);
      const oldDir = dirnameRel(oldRel);
      if (oldDir && !this.state.folderIdAtPath(oldDir)) {
        this.echo.lockRemoval(oldDir);
        await removeDirIfEmpty(toAbs(this.vaultPath, oldDir));
      }
    }
    this.state.setItem(id, { path: rel, hash, remoteUpdatedAt: remote.updated_at });
    if (stats) stats.pulled++;
    this.log.info("pulled item", { id, path: rel });
    this.emit("pulled", { id, path: rel });
  }

  /**
   * File location for a row: `<folder_path>/<slug>.md`, or `<slug>-<id8>.md` when another
   * item/file already owns that name. Keeps `prefer` if it is one of those two forms.
   */
  private async targetPathFor(remote: SyncItem, prefer: string | null): Promise<string> {
    const folder = localFolderPath(canonicalFolderPath(remote.folder_path));
    const stem = sanitizeName(remote.slug || remote.title);
    const primary = joinRel(folder, `${stem}.md`);
    const alternate = joinRel(folder, `${stem}-${remote.id.slice(0, 8)}.md`);
    const tracked = this.state.getItem(remote.id)?.path ?? null;
    for (const candidate of [prefer, tracked]) {
      if (candidate && (samePath(candidate, primary) || samePath(candidate, alternate))) {
        return candidate;
      }
    }
    return (await this.isPathFreeFor(primary, remote.id)) ? primary : alternate;
  }

  private async isPathFreeFor(rel: string, id: string): Promise<boolean> {
    const owner = this.state.itemIdAtPath(rel);
    if (owner && owner !== id) return false;
    const onDisk = await this.loadLocal(rel).catch(() => "unreadable" as const);
    if (onDisk === null) return true;
    return onDisk !== "unreadable" && onDisk.declaredId === id;
  }

  // ===========================================================================
  // the 3-way decision
  // ===========================================================================

  private async syncItem(
    id: string,
    local: LocalVersion | null,
    remoteRow: SyncItem | null,
    o: SyncOptions,
  ): Promise<void> {
    const tracked = this.state.getItem(id);
    const remote = remoteRow && remoteRow.status !== "archived" ? remoteRow : null;
    const base = tracked
      ? { hash: tracked.hash, path: tracked.path }
      : local?.declaredChecksum
        ? { hash: local.declaredChecksum, path: local.rel }
        : null;

    // --- gone on both sides
    if (!local && !remote) {
      if (tracked) this.state.deleteItem(id);
      return;
    }

    // --- only local: remote deleted/archived, or never pushed
    if (local && !remote) {
      const localUnchanged =
        base !== null && local.hash === base.hash && samePath(local.rel, base.path);
      if (localUnchanged && (tracked || remoteRow)) {
        if (o.suppressDestructive) return;
        this.state.deleteItem(id);
        this.echo.lockRemoval(local.rel);
        const trashPath = await moveToTrash(
          this.vaultPath,
          toAbs(this.vaultPath, local.rel),
          this.now(),
        );
        if (o.stats) o.stats.removedLocal++;
        this.log.info("remote item gone, local file moved to trash", { id, path: local.rel });
        this.emit("local-removed", { id, path: local.rel, trashPath });
        return;
      }
      // Local edits (or a file with no sync history) win over a remote delete: (re)create.
      await this.push(id, local, remoteRow, o.stats);
      return;
    }

    // --- only remote: new in the cloud, or the local file was deleted
    if (!local && remote) {
      const remoteHash = checksumOf(canonicalFromItem(remote));
      if (tracked && remoteHash === tracked.hash) {
        if (o.deferLocalDelete || o.suppressDestructive) return;
        await this.propagateLocalDelete(id, tracked.path, o.stats);
        return;
      }
      // New remote item, or the remote changed after the local delete (remote edit wins).
      await this.pull(id, remote, null, o.stats);
      return;
    }

    // --- both sides present
    if (!local || !remote) return; // (narrowing only)
    const remoteDoc = canonicalFromItem(remote);
    const remoteHash = checksumOf(remoteDoc);
    const remotePath = await this.targetPathFor(remote, local.rel);

    if (local.hash === remoteHash && samePath(local.rel, remotePath)) {
      this.state.setItem(id, {
        path: local.rel,
        hash: local.hash,
        remoteUpdatedAt: remote.updated_at,
      });
      if (local.needsRewrite)
        await this.writeLocal(local.rel, local.doc, remote.updated_at, local.hash);
      if (o.stats) o.stats.unchanged++;
      return;
    }

    const localChanged = !base || local.hash !== base.hash || !samePath(local.rel, base.path);
    const remoteChanged = !base || remoteHash !== base.hash || !samePath(remotePath, base.path);

    if (localChanged && !remoteChanged) {
      await this.push(id, local, remote, o.stats);
    } else if (!localChanged && remoteChanged) {
      await this.pull(id, remote, local.rel, o.stats);
    } else {
      await this.resolveConflict(id, local, remote, remoteDoc, remoteHash, o.stats);
    }
  }

  private async propagateLocalDelete(
    id: string,
    rel: string,
    stats?: ReconcileStats,
  ): Promise<void> {
    const mode = this.opts.localDeleteMode;
    if (mode === "delete") await this.remote.deleteItem(id);
    else await this.remote.archiveItem(id);
    this.state.deleteItem(id);
    if (stats) stats.removedRemote++;
    this.log.info(mode === "delete" ? "deleted remote item" : "archived remote item", {
      id,
      path: rel,
    });
    this.emit("remote-removed", { id, path: rel, mode });
  }

  /** Newest `updated_at` wins; the loser is kept next to it as `<slug>.conflict-<ts>.md`. */
  private async resolveConflict(
    id: string,
    local: LocalVersion,
    remote: SyncItem,
    remoteDoc: CanonicalDoc,
    remoteHash: string,
    stats?: ReconcileStats,
  ): Promise<void> {
    // The local side's change time is the file's mtime (editors don't bump `updated_at`).
    const remoteTime = Date.parse(remote.updated_at);
    const remoteWins = !(local.mtimeMs > remoteTime);
    const conflictPath = await this.conflictPathFor(local.rel);
    const loserText = remoteWins
      ? local.raw
      : renderMarkdown(remoteDoc, remote.updated_at, remoteHash);
    await writeFileAtomic(toAbs(this.vaultPath, conflictPath), loserText);

    if (remoteWins) await this.pull(id, remote, local.rel, stats);
    else await this.push(id, local, remote, stats);

    if (stats) stats.conflicts++;
    const winnerPath = this.state.getItem(id)?.path ?? local.rel;
    this.log.warn("conflict resolved", {
      id,
      winner: remoteWins ? "remote" : "local",
      conflictPath,
    });
    this.emit("conflict", {
      id,
      winner: remoteWins ? "remote" : "local",
      path: winnerPath,
      conflictPath,
    });
  }

  private async keepDuplicate(rel: string, id: string, reason: string): Promise<void> {
    const keptAs = await this.conflictPathFor(rel);
    await moveFile(toAbs(this.vaultPath, rel), toAbs(this.vaultPath, keptAs));
    this.log.warn("duplicate file merged into existing item", { id, reason, path: rel, keptAs });
    this.emit("duplicate", { id, reason, path: rel, keptAs });
  }

  private async conflictPathFor(rel: string): Promise<string> {
    const base = joinRel(
      dirnameRel(rel),
      `${stemOf(rel)}.conflict-${compactTimestamp(this.now())}`,
    );
    let candidate = `${base}.md`;
    for (let n = 1; await exists(toAbs(this.vaultPath, candidate)); n++) {
      candidate = `${base}-${n}.md`;
    }
    return candidate;
  }

  // ===========================================================================
  // full reconcile (startup, Realtime reconnect, interval)
  // ===========================================================================

  private async doReconcile(): Promise<ReconcileStats> {
    const stats = emptyStats();
    // Folder trouble (e.g. EPERM on a folder deleted while the watcher still holds it) is
    // reported per folder; it must not abort the whole reconcile, which then failed every
    // 10 minutes for good (found live, see the e8-live hand-over).
    const folderError = (rel: string, error: unknown) => {
      stats.errors++;
      this.folderError(rel, error);
    };
    await bootstrapVault(this.vaultPath, { onError: folderError });

    // Folders: remote rows are the truth for ids; make sure every one exists on disk.
    const remoteFolders = await this.remote.listFolders();
    this.state.replaceFolders(
      remoteFolders.map((f) => [
        f.id,
        { path: normalizeFolderPath(f.folder_path), system: f.is_system_default === true },
      ]),
    );
    for (const f of remoteFolders) {
      const dir = localFolderPath(f.folder_path);
      if (!dir) continue;
      try {
        await mkdir(toAbs(this.vaultPath, dir), { recursive: true });
      } catch (error) {
        folderError(dir, error);
      }
    }

    const scan = await scanVault(this.vaultPath);
    for (const { rel, error } of scan.unreadable) folderError(rel, error);
    for (const dir of scan.dirs) {
      if (!this.state.folderIdAtPath(dir)) await this.ensureFolderPath(dir);
    }

    // Local files, keyed by id.
    const localById = new Map<string, LocalVersion>();
    const fresh: LoadedFile[] = [];
    const unreadableIds = new Set<string>();
    // Items tracked inside a folder we could not read are unknown, not deleted.
    for (const { rel } of scan.unreadable) {
      for (const id of this.state.itemIds()) {
        const tracked = this.state.getItem(id)?.path;
        if (tracked && isUnderDir(tracked, rel)) unreadableIds.add(id);
      }
    }
    for (const scanned of scan.files) {
      try {
        const rel = scanned.includes("/") ? scanned : await this.moveRootFileToInbox(scanned);
        const loaded = await this.loadLocal(rel);
        if (!loaded) continue;
        let id = loaded.declaredId ?? this.state.itemIdAtPath(rel) ?? null;
        if (id && localById.has(id)) {
          // Two files with one id (a copy): the tracked path keeps it, the other becomes new.
          const first = localById.get(id) as LocalVersion;
          if (samePath(this.state.getItem(id)?.path, rel)) {
            localById.delete(id);
            fresh.push(first);
          } else {
            id = null;
          }
        }
        if (id) localById.set(id, this.toLocalVersion(loaded, id));
        else fresh.push(loaded);
      } catch (error) {
        stats.errors++;
        const owner = this.state.itemIdAtPath(scanned);
        if (owner) unreadableIds.add(owner); // don't mistake it for a deletion
        this.reportError(error, "read local file", { path: scanned });
      }
    }

    const versions = new Map((await this.remote.listItemVersions()).map((v) => [v.id, v]));
    const ids = new Set([...localById.keys(), ...versions.keys(), ...this.state.itemIds()]);
    for (const id of unreadableIds) ids.delete(id);

    // Fast path: neither side moved since the last sync -> no row fetch, no work.
    const needRows: string[] = [];
    for (const id of [...ids]) {
      const tracked = this.state.getItem(id);
      const version = versions.get(id);
      const local = localById.get(id);
      if (
        tracked &&
        version &&
        local &&
        version.updated_at === tracked.remoteUpdatedAt &&
        local.hash === tracked.hash &&
        samePath(local.rel, tracked.path) &&
        !local.needsRewrite
      ) {
        ids.delete(id);
        stats.unchanged++;
      } else if (version) {
        needRows.push(id);
      }
    }
    const rows = new Map((await this.remote.getItems(needRows)).map((r) => [r.id, r]));

    // Mass-delete guard (wiped vault, broken listing, ...): hold back destructive actions.
    let destructive = 0;
    for (const id of ids) {
      if (!this.state.getItem(id)) continue;
      const remoteLive = rows.get(id)?.status !== "archived" && rows.has(id);
      const localPresent = localById.has(id);
      if (localPresent !== remoteLive) destructive++;
    }
    const suppressDestructive =
      destructive > this.opts.massDeleteThreshold && !this.opts.allowMassDelete;
    if (suppressDestructive) {
      this.reportError(
        new Error(`${destructive} items would be deleted on one side - held back`),
        "mass delete guard",
      );
    }

    for (const id of ids) {
      try {
        await this.syncItem(id, localById.get(id) ?? null, rows.get(id) ?? null, {
          suppressDestructive,
          stats,
        });
      } catch (error) {
        stats.errors++;
        this.reportError(error, "reconcile item", { id, path: localById.get(id)?.rel });
      }
    }
    for (const loaded of fresh) {
      try {
        await this.createFromLocal(loaded, stats);
      } catch (error) {
        stats.errors++;
        this.reportError(error, "create item from file", { path: loaded.rel });
      }
    }

    await this.state.save();
    this.log.info("reconciled", { ...stats });
    this.emit("reconciled", stats);
    return stats;
  }

  // ===========================================================================
  // file helpers
  // ===========================================================================

  /** Reads + parses a vault file. null = missing. Throws FrontmatterError on broken YAML. */
  private async loadLocal(rel: string): Promise<LoadedFile | null> {
    const abs = toAbs(this.vaultPath, rel);
    const raw = await readTextIfExists(abs);
    if (raw === null) return null;
    const st = await statIfExists(abs);
    const parsed = parseMarkdown(raw);
    const d = parsed.data;
    const birth = st && st.birthtimeMs > 0 ? st.birthtimeMs : (st?.mtimeMs ?? this.now().getTime());
    return {
      rel,
      raw,
      parsed,
      declaredId: isUuid(d.id) ? d.id.toLowerCase() : null,
      declaredChecksum: typeof d.checksum === "string" ? d.checksum : null,
      declaredFolderPath:
        typeof d.folder_path === "string" ? normalizeFolderPath(d.folder_path) : null,
      mtimeMs: st?.mtimeMs ?? this.now().getTime(),
      createdAt: normalizeTimestamp(birth) ?? this.now().toISOString(),
    };
  }

  private async loadLocalReported(rel: string): Promise<LoadedFile | null> {
    try {
      return await this.loadLocal(rel);
    } catch (error) {
      if (error instanceof FrontmatterError) {
        this.reportError(error, "local file skipped", { path: rel });
        return null;
      }
      throw error;
    }
  }

  /** The file at `rel` if it is this item (same id, or no id at all). */
  private async loadLocalVersionFor(rel: string, id: string): Promise<LocalVersion | null> {
    const loaded = await this.loadLocal(rel);
    if (!loaded || (loaded.declaredId && loaded.declaredId !== id)) return null;
    return this.toLocalVersion(loaded, id);
  }

  private toLocalVersion(loaded: LoadedFile, id: string): LocalVersion {
    const folderPath = dirnameRel(loaded.rel);
    const doc = canonicalFromFile(loaded.parsed, {
      id,
      folderPath,
      stem: stemOf(loaded.rel),
      defaultType: inferTypeFromFolder(folderPath),
      createdAt: loaded.createdAt,
    });
    return {
      ...loaded,
      id,
      doc,
      hash: checksumOf(doc),
      needsRewrite: loaded.declaredId !== id || loaded.declaredFolderPath !== doc.folder_path,
    };
  }

  private async writeLocal(
    rel: string,
    doc: CanonicalDoc,
    updatedAt: string,
    hash: string,
  ): Promise<void> {
    this.echo.lockWrite(rel, hash);
    await writeFileAtomic(toAbs(this.vaultPath, rel), renderMarkdown(doc, updatedAt, hash));
    this.emit("local-write", { path: rel });
  }

  private async removeOwnFile(rel: string): Promise<void> {
    this.echo.lockRemoval(rel);
    await rm(toAbs(this.vaultPath, rel), { force: true });
  }

  /** For diagnostics/tests. */
  trackedPath(id: string): string | undefined {
    return this.state?.getItem(id)?.path;
  }

  /** Every item currently mirrored in the vault (id + vault-relative path). */
  trackedItems(): { id: string; path: string }[] {
    if (!this.state) return [];
    return this.state.itemIds().flatMap((id) => {
      const path = this.state.getItem(id)?.path;
      return path ? [{ id, path }] : [];
    });
  }
}
