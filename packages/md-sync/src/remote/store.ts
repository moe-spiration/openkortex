import type { DedupCandidate, DuplicateReason } from "@kortex/db";
import type {
  FolderWrite,
  ItemVersion,
  ItemWrite,
  RemoteListener,
  SyncFolder,
  SyncItem,
  Unsubscribe,
} from "../types";

/** Dedup candidate of a vault file (@kortex/db dedup.ts). */
export const candidateFromWrite = (w: ItemWrite): DedupCandidate => ({
  type: w.type,
  title: w.title,
  sourceUrl: w.source_url,
  contentMd: w.content_md,
  metadata: w.metadata as Record<string, unknown>,
  tags: w.tags,
  platform: "vault",
  excludeId: w.id,
});

export interface DuplicateMatch {
  /** The existing item the file was merged into. */
  id: string;
  reason: DuplicateReason;
}

/** An insert hit the unique URL index: the file was merged into `existingId` instead. */
export class DuplicateItemError extends Error {
  override name = "DuplicateItemError";
  constructor(
    readonly existingId: string,
    readonly reason: DuplicateReason,
  ) {
    super(`duplicate of item ${existingId} (${reason})`);
  }
}

/**
 * The cloud side of the sync, scoped to exactly one user.
 * `SupabaseRemoteStore` talks to `kortex.*`; `InMemoryRemoteStore` backs the tests.
 */
export interface RemoteStore {
  readonly userId: string;

  /** Idempotently creates the user's settings row + system folders on the server. */
  bootstrapUser(): Promise<void>;

  /** All of the user's items (including archived), without content. */
  listItemVersions(): Promise<ItemVersion[]>;
  getItems(ids: readonly string[]): Promise<SyncItem[]>;
  getItem(id: string): Promise<SyncItem | null>;
  /**
   * New vault file: merges it into an existing duplicate (URL, external id, content hash, title;
   * see @kortex/db dedup.ts) and returns that item, or null when it is new.
   */
  mergeIfDuplicate?(item: ItemWrite): Promise<DuplicateMatch | null>;
  /**
   * Insert or update by id. Returns the stored row (with server-set `updated_at`).
   * Throws `DuplicateItemError` when an insert collides with the unique URL index (merged instead).
   */
  upsertItem(item: ItemWrite): Promise<SyncItem>;
  /**
   * Re-renders the item's "## Aufgaben" section from its tasks (@kortex/db task-section.ts) after a
   * task changed elsewhere (web, mobile, MCP). Returns whether the item changed; the change then
   * arrives as a normal `knowledge_items` update. `upsertItem` applies the section the other way.
   */
  refreshTaskSection?(itemId: string): Promise<boolean>;
  /** Soft delete: `status = 'archived'`. */
  archiveItem(id: string): Promise<void>;
  deleteItem(id: string): Promise<void>;

  listFolders(): Promise<SyncFolder[]>;
  getFolder(id: string): Promise<SyncFolder | null>;
  /** Idempotent by `(user_id, folder_path)`: returns the existing row if there is one. */
  createFolder(folder: FolderWrite): Promise<SyncFolder>;
  deleteFolder(id: string): Promise<void>;

  /** Live change feed (Supabase Realtime `postgres_changes`). */
  subscribe(listener: RemoteListener): Unsubscribe;
}
