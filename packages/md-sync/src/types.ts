import type { Folder, ItemStatus, Json, KnowledgeItem, KnowledgeItemType } from "@kortex/db";

/** Columns md-sync reads from `kortex.knowledge_items` (never `fts`, embeddings or other heavy columns). */
export const ITEM_COLUMNS = [
  "id",
  "user_id",
  "parent_item_id",
  "folder_id",
  "type",
  "source_platform",
  "title",
  "slug",
  "content_md",
  "source_url",
  "cover_image_url",
  "icon",
  "cluster_name",
  "folder_path",
  "is_manual_placement",
  "tags",
  "entities",
  "metadata",
  "status",
  "local_file_hash",
  "remind_at",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof KnowledgeItem)[];

/** `remind_at` is optional so rows from before the column existed still type-check. */
export type SyncItem = Omit<Pick<KnowledgeItem, (typeof ITEM_COLUMNS)[number]>, "remind_at"> & {
  remind_at?: string | null;
};

/** What the daemon writes for an item. `user_id` and `updated_at` are set by the store / DB trigger. */
export interface ItemWrite {
  id: string;
  parent_item_id: string | null;
  folder_id: string | null;
  type: KnowledgeItemType;
  source_platform: string;
  title: string;
  slug: string;
  content_md: string;
  source_url: string | null;
  cover_image_url: string | null;
  icon: string;
  cluster_name: string;
  folder_path: string;
  /** Omitted = keep the stored value (content edits must not reset a manual placement). */
  is_manual_placement?: boolean;
  tags: string[];
  entities: string[];
  metadata: { [key: string]: Json | undefined };
  status: ItemStatus;
  local_file_hash: string;
  /** ISO timestamp or null (clears the reminder). */
  remind_at: string | null;
  created_at: string;
}

/** Cheap listing used by reconcile to skip unchanged rows. */
export interface ItemVersion {
  id: string;
  updated_at: string;
  status: string;
}

export const FOLDER_COLUMNS = [
  "id",
  "user_id",
  "parent_id",
  "name",
  "slug",
  "folder_path",
  "is_system_default",
] as const satisfies readonly (keyof Folder)[];

export type SyncFolder = Pick<Folder, (typeof FOLDER_COLUMNS)[number]>;

export interface FolderWrite {
  folder_path: string;
  name: string;
  slug: string;
  parent_id: string | null;
}

/** Realtime notifications only carry ids; the engine re-fetches rows (payloads can be truncated/TOASTed). */
export type RemoteChange =
  | { table: "knowledge_items"; op: "upsert" | "delete"; id: string }
  | { table: "folders"; op: "upsert" | "delete"; id: string }
  /** A task changed; `sourceItemId` is the note whose "## Aufgaben" section shows it (null: none / unknown). */
  | { table: "action_items"; op: "upsert" | "delete"; id: string; sourceItemId: string | null };

export type RemoteStatus = "connected" | "disconnected";

export interface RemoteListener {
  onChange(change: RemoteChange): void;
  onStatus?(status: RemoteStatus, detail?: string): void;
}

export type Unsubscribe = () => Promise<void>;
