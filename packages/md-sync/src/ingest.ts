import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IngestContext, IngestResult, RawIngestInput, UsageLedger } from "@kortex/ai-core";
import {
  connectorForType,
  isConnectorEnabled,
  placementDecision,
  placementOf,
  thresholdOf,
  type Json,
  type KnowledgeItemType,
  type UserSettings,
} from "@kortex/db";
import type { SyncEngine } from "./engine";
import { canonicalFromItem, checksumOf, normalizeBody } from "./frontmatter";
import { silentLogger, type Logger } from "./logger";
import { dirnameRel, joinRel, normalizeFolderPath, slugify } from "./paths";
import { SerialQueue } from "./queue";
import type { EnrichmentStore, ItemEnrichmentPatch } from "./remote/enrichment-store";
import type { RemoteStore } from "./remote/store";
import type { SyncItem } from "./types";
import { AI_MEMORIES_FOLDER, isInFolder } from "./vault-layout";

/** What md-sync needs from `@kortex/ai-core` (its `IngestionPipeline` satisfies this). */
export interface IngestPipelinePort {
  ingest(input: RawIngestInput, context: IngestContext): Promise<IngestResult>;
}

export interface VaultIngestorOptions {
  engine: SyncEngine;
  store: RemoteStore & EnrichmentStore;
  pipeline: IngestPipelinePort;
  /** Vault folders (incl. sub-folders) whose local files are enriched. Default `40_AI_Memories`. */
  folders?: readonly string[];
  /** Quiet period after the last push before an item is processed (editors save often). */
  debounceMs?: number;
  /** Whether the organizer's extracted tasks become action_items. Default: not for ai_chat. */
  persistActionItems?: (item: SyncItem) => boolean;
  maxAttempts?: number;
  retryDelayMs?: number;
  /**
   * Daily AI budget (kortex.ai_usage vs. user_settings.daily_ai_budget_eur), checked before every
   * pipeline run. Exceeded: the item is skipped, logged and checked again after `budgetRetryMs`.
   * The usage itself is recorded by the metered router (see ai-routing.ts).
   */
  ledger?: UsageLedger;
  /** Re-check interval for items held back by the budget. Default 1 h. */
  budgetRetryMs?: number;
  logger?: Logger;
  now?: () => Date;
}

export interface IngestorEvents {
  ingested: [
    {
      id: string;
      chunks: number;
      tags: string[];
      folderPath: string;
      degraded: boolean;
      /** Organizer target held back for review (confidence below auto_place_threshold). */
      proposedFolder?: string;
    },
  ];
  "ingest-skipped": [{ id: string; reason: string }];
  "ingest-failed": [{ id: string; error: unknown; attempt: number; willRetry: boolean }];
}

interface IngestState {
  state?: "done" | "degraded" | "error";
  content_checksum?: string;
  attempts?: number;
}

/** Placeholder folder id for manual placements without a folder row (ai-core needs an id). */
const NO_FOLDER_ID = "00000000-0000-4000-8000-000000000000";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Idempotency key: only the Markdown body drives (re-)enrichment, not frontmatter edits. */
export const contentChecksum = (contentMd: string) =>
  `sha256:${createHash("sha256").update(normalizeBody(contentMd)).digest("hex")}`;

const ingestStateOf = (item: SyncItem): IngestState => {
  const meta = isRecord(item.metadata) ? item.metadata : {};
  return isRecord(meta.ingest) ? (meta.ingest as IngestState) : {};
};

/**
 * Feeds files the user (or an agent) writes into the vault through the ai-core pipeline:
 * adapter (e.g. `ai-chat` for agent memories) -> organizer -> chunker -> embeddings, then
 * persists summary/tags/entities/cluster/metadata, chunks, tasks and tag usage via the store.
 *
 * - Trigger: the engine's `pushed` event for files in `folders`, debounced per item.
 * - Idempotent: a body checksum in `metadata.ingest.content_checksum`; frontmatter-only edits
 *   and the engine pulling the enriched row back never re-trigger it.
 * - Race-safe: the write is a compare-and-set on `local_file_hash`, so a newer edit wins.
 * - Never rewrites title, slug or body (the file stays the user's Markdown); the AI title goes
 *   to `metadata.ai_title`. Folder and cluster are only changed when `is_manual_placement` is false.
 */
export class VaultIngestor extends EventEmitter<IngestorEvents> {
  private readonly folders: string[];
  private readonly debounceMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly budgetRetryMs: number;
  private readonly log: Logger;
  private readonly now: () => Date;
  private readonly queue = new SerialQueue();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Items held back by the daily budget: re-checked later, not counted as pending work. */
  private readonly deferred = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly attempts = new Map<string, number>();
  private readonly onPushed = (e: { id: string; path: string }) => this.onPush(e.id, e.path);
  private stopped = false;

  /** Files waiting for (or in) AI enrichment, for the heartbeat. */
  get pending(): number {
    return this.timers.size;
  }

  constructor(private readonly opts: VaultIngestorOptions) {
    super();
    this.folders = (opts.folders ?? [AI_MEMORIES_FOLDER]).map(normalizeFolderPath);
    this.debounceMs = opts.debounceMs ?? 3000;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.retryDelayMs = opts.retryDelayMs ?? 30_000;
    this.budgetRetryMs = opts.budgetRetryMs ?? 60 * 60_000;
    this.log = opts.logger ?? silentLogger;
    this.now = opts.now ?? (() => new Date());
  }

  /** Starts listening to the engine. Call before `engine.start()` to also catch the startup reconcile. */
  start(): this {
    this.opts.engine.on("pushed", this.onPushed);
    return this;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.opts.engine.off("pushed", this.onPushed);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const t of this.deferred.values()) clearTimeout(t);
    this.deferred.clear();
    await this.queue.idle();
  }

  /** Resolves when nothing is scheduled or running. */
  async idle(): Promise<void> {
    for (;;) {
      await this.queue.idle();
      if (this.timers.size === 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  inScope(folderPath: string): boolean {
    return this.folders.some((f) => isInFolder(folderPath, f));
  }

  /** Re-checks every tracked item in scope (never processed, edited offline, failed earlier). */
  async backfill(): Promise<number> {
    const ids = this.opts.engine
      .trackedItems()
      .filter((t) => this.inScope(dirnameRel(t.path)))
      .map((t) => t.id);
    const rows = await this.opts.store.getItems(ids);
    let scheduled = 0;
    for (const row of rows) {
      if (this.needsIngest(row, { retryFailed: true })) {
        this.schedule(row.id, 0);
        scheduled++;
      }
    }
    return scheduled;
  }

  private onPush(id: string, path: string): void {
    if (this.stopped || !this.inScope(dirnameRel(path))) return;
    this.attempts.delete(id); // new content: fresh retry budget
    this.schedule(id, this.debounceMs);
  }

  private schedule(id: string, delayMs: number): void {
    clearTimeout(this.deferred.get(id));
    this.deferred.delete(id);
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.queue.run(() => this.process(id));
      }, delayMs),
    );
  }

  needsIngest(row: SyncItem, { retryFailed = false } = {}): boolean {
    if (row.status === "archived" || !this.inScope(normalizeFolderPath(row.folder_path))) {
      return false;
    }
    if (!row.local_file_hash || !normalizeBody(row.content_md ?? "")) return false;
    const st = ingestStateOf(row);
    if (st.content_checksum !== contentChecksum(row.content_md)) return true;
    return retryFailed && (st.state === "error" || st.state === "degraded");
  }

  private skip(id: string, reason: string): void {
    this.log.debug("ingest skipped", { id, reason });
    this.emit("ingest-skipped", { id, reason });
  }

  private async process(id: string): Promise<void> {
    if (this.stopped) return;
    const { store, pipeline } = this.opts;
    const row = await store.getItem(id);
    if (!row) return this.skip(id, "item gone");
    if (!this.needsIngest(row, { retryFailed: true })) {
      return this.skip(id, "already enriched for this content");
    }
    const expectedHash = row.local_file_hash as string;
    // The retry budget is per daemon run, so items that failed during an outage get retried
    // on the next start (backfill) instead of staying stuck.
    const attempt = (this.attempts.get(id) ?? 0) + 1;
    const manual = row.is_manual_placement === true;

    let result: IngestResult;
    let threshold: number;
    try {
      const settings = await store.getUserSettings();
      const blocked = await this.gate(row, settings);
      if (blocked) return this.skip(id, blocked);
      this.attempts.set(id, attempt);
      threshold = thresholdOf(settings?.auto_place_threshold);
      const context = await store.loadIngestContext(settings);
      result = await pipeline.ingest(
        {
          userId: store.userId,
          itemId: row.id,
          rawText: row.content_md,
          typeHint: row.type as KnowledgeItemType,
          manualTags: row.tags ?? [],
          ...(manual
            ? {
                targetFolderId: row.folder_id ?? NO_FOLDER_ID,
                targetFolderPath: normalizeFolderPath(row.folder_path),
              }
            : {}),
        },
        context,
      );
    } catch (error) {
      this.attempts.set(id, attempt);
      await this.recordFailure(row, expectedHash, attempt, error);
      return;
    }

    const updated = await this.apply(row, expectedHash, result, manual, attempt, threshold);
    if (!updated) return this.skip(id, "file changed while enriching; the new version is queued");
    this.attempts.delete(id);
  }

  /**
   * Same gates as the web ingest route, before any AI call: the connector must be switched on
   * (user_settings.enabled_connectors) and the daily budget not used up. Returns why the item is
   * skipped, or null. A budget stop re-checks later; a switched-off connector waits for the next
   * edit or daemon start.
   */
  private async gate(row: SyncItem, settings: UserSettings | null): Promise<string | null> {
    const connector = connectorForType(row.type);
    if (!isConnectorEnabled(connector, settings?.enabled_connectors)) {
      this.log.info("ai ingest skipped: connector switched off", { id: row.id, connector });
      return `connector ${connector} is switched off`;
    }
    const budget = await this.opts.ledger?.status();
    if (budget?.exceeded) {
      this.log.warn("ai ingest postponed: daily AI budget reached", {
        id: row.id,
        spent_eur: Math.round(budget.spentEur * 100) / 100,
        budget_eur: budget.budgetEur,
        retry_in_min: Math.round(this.budgetRetryMs / 60_000),
      });
      if (!this.stopped) this.defer(row.id);
      return "daily AI budget reached";
    }
    return null;
  }

  /** Re-check after `budgetRetryMs`; a new edit (schedule) replaces it. */
  private defer(id: string): void {
    clearTimeout(this.deferred.get(id));
    this.deferred.set(
      id,
      setTimeout(() => {
        this.deferred.delete(id);
        this.schedule(id, 0);
      }, this.budgetRetryMs),
    );
  }

  private async apply(
    row: SyncItem,
    expectedHash: string,
    result: IngestResult,
    manual: boolean,
    attempt: number,
    threshold: number,
  ): Promise<SyncItem | null> {
    const { store } = this.opts;
    const out = result.item;
    const pipelineMeta = isRecord(out.metadata) ? out.metadata : {};
    const { ingest: pipelineIngest, ...rawExtracted } = pipelineMeta;
    // The pipeline only sees the body, so adapter facts like ai-chat `agent_name` come back null;
    // they must not clobber what the file's frontmatter already says.
    const rowMeta = isRecord(row.metadata) ? row.metadata : {};
    const extracted = Object.fromEntries(
      Object.entries(rawExtracted).filter(([k, v]) => v != null || rowMeta[k] == null),
    );
    const degraded = out.status !== "processed";
    const tagsBefore = row.tags ?? [];
    const tags = [...new Set([...tagsBefore, ...result.tags])];

    const patch: ItemEnrichmentPatch = {
      summary: out.summary ?? null,
      tags,
      entities: out.entities ?? [],
      related_item_ids: out.related_item_ids ?? [],
      status: out.status,
      metadata: JSON.parse(
        JSON.stringify({
          ...rowMeta,
          ...extracted,
          ai_title: out.title,
          ingest: {
            ...(isRecord(pipelineIngest) ? pipelineIngest : {}),
            source: "md-sync",
            state: degraded ? "degraded" : "done",
            content_checksum: contentChecksum(row.content_md),
            attempts: attempt,
            finished_at: this.now().toISOString(),
          },
        }),
      ) as Json,
    };

    // Rule 3: a manual placement keeps its folder and cluster.
    let proposedFolder: string | undefined;
    if (!manual) {
      if (out.cluster_name) patch.cluster_name = out.cluster_name;
      const target = normalizeFolderPath(result.folderToCreate ?? out.folder_path ?? "");
      if (target && target !== normalizeFolderPath(row.folder_path)) {
        // Zero-setup auto-placement (as in the web inbox): below the user's threshold the file
        // stays where it is and the target is only proposed (metadata.placement.folder_path);
        // the web Inbox shows it under "Zur Prüfung" until the user confirms.
        if (placementDecision(placementOf(pipelineMeta), false, threshold) === "review") {
          proposedFolder = target;
          const meta = patch.metadata as Record<string, unknown>;
          meta.placement = {
            ...(isRecord(meta.placement) ? meta.placement : {}),
            folder_path: target,
            held: true,
          };
        } else {
          patch.folder_path = target;
          patch.folder_id = await this.ensureFolder(target);
        }
      }
    }

    // Keep DB `local_file_hash` == the checksum the engine will write into the pulled file.
    patch.local_file_hash = checksumOf(canonicalFromItem({ ...row, ...patch } as SyncItem));
    const updated = await store.applyEnrichment(row.id, patch, expectedHash);
    if (!updated) return null;

    await store.replaceChunks(row.id, result.chunks);
    if ((this.opts.persistActionItems ?? ((i) => i.type !== "ai_chat"))(row)) {
      await store.replaceOpenActionItems(row.id, result.actionItems);
    }
    const added = tags.filter((t) => !tagsBefore.includes(t));
    await store.bumpTags(added);

    this.log.info("ingested vault item", {
      id: row.id,
      chunks: result.chunks.length,
      tags: added,
      degraded,
      ...(proposedFolder ? { proposed_folder: proposedFolder } : {}),
    });
    this.emit("ingested", {
      id: row.id,
      chunks: result.chunks.length,
      tags,
      folderPath: patch.folder_path ?? normalizeFolderPath(row.folder_path),
      degraded,
      ...(proposedFolder ? { proposedFolder } : {}),
    });
    return updated;
  }

  private async ensureFolder(folderPath: string): Promise<string | null> {
    let parentId: string | null = null;
    let current = "";
    for (const segment of folderPath.split("/").filter(Boolean)) {
      current = joinRel(current, segment);
      const folder = await this.opts.store.createFolder({
        folder_path: current,
        name: segment,
        slug: slugify(segment),
        parent_id: parentId,
      });
      parentId = folder.id;
    }
    return parentId;
  }

  private async recordFailure(
    row: SyncItem,
    expectedHash: string,
    attempt: number,
    error: unknown,
  ): Promise<void> {
    const willRetry = attempt < this.maxAttempts && !this.stopped;
    const message = error instanceof Error ? error.message : String(error);
    this.log.warn("ingest failed", { id: row.id, attempt, willRetry, error: message });
    this.emit("ingest-failed", { id: row.id, error, attempt, willRetry });
    if (willRetry) {
      this.schedule(row.id, this.retryDelayMs * 2 ** (attempt - 1));
      return;
    }
    // Out of retries: leave a visible trace (like apps/web), retried on the next daemon start.
    const patch: ItemEnrichmentPatch = {
      status: "error",
      metadata: JSON.parse(
        JSON.stringify({
          ...(isRecord(row.metadata) ? row.metadata : {}),
          ingest: {
            source: "md-sync",
            state: "error",
            error: message.slice(0, 500),
            content_checksum: contentChecksum(row.content_md),
            attempts: attempt,
            failed_at: this.now().toISOString(),
          },
        }),
      ) as Json,
    };
    patch.local_file_hash = checksumOf(canonicalFromItem({ ...row, ...patch } as SyncItem));
    await this.opts.store.applyEnrichment(row.id, patch, expectedHash).catch(() => null);
    this.attempts.delete(row.id);
  }
}
