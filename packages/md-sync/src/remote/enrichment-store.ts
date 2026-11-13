import type { ActionItemInsert, IngestContext, ItemChunkInsert } from "@kortex/ai-core";
import type { Json, UserSettings } from "@kortex/db";
import type { SyncItem } from "../types";

/** Fields the ingest step may change on an item. Never title/slug/content: the file stays the user's. */
export interface ItemEnrichmentPatch {
  summary?: string | null;
  tags?: string[];
  entities?: string[];
  related_item_ids?: string[];
  cluster_name?: string;
  folder_path?: string;
  folder_id?: string | null;
  metadata?: Json;
  status?: SyncItem["status"];
  /** Checksum of the row after the patch, so file `checksum` and DB `local_file_hash` agree. */
  local_file_hash?: string;
}

/**
 * Persistence the vault ingest needs on top of `RemoteStore` (same user scope).
 * Mirrors what `apps/web` does after `/api/ingest`: item fields, chunks, open tasks, tag usage.
 */
export interface EnrichmentStore {
  getUserSettings(): Promise<UserSettings | null>;
  /** Existing tags, clusters, domain objects and folders, so the organizer reuses the taxonomy. */
  loadIngestContext(settings: UserSettings | null): Promise<IngestContext>;
  /**
   * Compare-and-set: applies the patch only while `local_file_hash` still equals `expectedHash`
   * (the file content that was ingested). Returns null when the row changed meanwhile.
   */
  applyEnrichment(
    id: string,
    patch: ItemEnrichmentPatch,
    expectedHash: string,
  ): Promise<SyncItem | null>;
  replaceChunks(itemId: string, chunks: readonly ItemChunkInsert[]): Promise<void>;
  /** Replaces the item's still-open extracted tasks; done/in-progress ones stay. */
  replaceOpenActionItems(itemId: string, rows: readonly ActionItemInsert[]): Promise<void>;
  /** Upserts tags and bumps `usage_count`. */
  bumpTags(names: readonly string[]): Promise<void>;
}
