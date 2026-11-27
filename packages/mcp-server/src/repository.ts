import type { FolderCount } from "./agents-guide";
import type {
  ActionItemStatus,
  DedupCandidate,
  DomainObjectType,
  DuplicateReason,
  KnowledgeItemType,
  Priority,
} from "@kortex/db";

/** The item shape exposed to tools. A subset of kortex.knowledge_items. */
export interface BrainItem {
  id: string;
  type: KnowledgeItemType;
  title: string;
  slug: string;
  summary: string | null;
  content_md: string;
  source_url: string | null;
  source_platform: string;
  folder_path: string;
  is_manual_placement: boolean;
  cluster_name: string;
  tags: string[];
  metadata: Record<string, unknown>;
  status: string;
  remind_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrainHighlight {
  id: string;
  item_id: string;
  quote_text: string;
  note_text: string | null;
  color: string | null;
  locator: unknown;
  created_at: string;
}

export interface BrainTask {
  id: string;
  title: string;
  status: ActionItemStatus;
  priority: Priority;
  due_date: string | null;
  source_item_id: string | null;
  project_item_id: string | null;
  timeframe: string | null;
  context: string | null;
  exported_at: string | null;
  external_ref: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface SearchParams {
  /** Empty = no ranking: list the newest items matching the filters. */
  query: string;
  /** Query embedding for the vector side of hybrid search; null = full-text only. */
  embedding: readonly number[] | null;
  /**
   * Model of `embedding` ("<provider>:<model_id>"): the vector side only compares chunks
   * embedded with the same model (item_chunks.metadata.embedding_model).
   */
  embeddingModel?: string | null;
  type?: KnowledgeItemType;
  /** Any of these types (combined with `type`). */
  types?: KnowledgeItemType[];
  /** Every key must match `metadata` (arrays: contains), e.g. `{ status: "want_to_read" }`. */
  metadata?: Record<string, unknown>;
  /** Folder plus all sub-folders. */
  folderPath?: string;
  /** Hierarchical match: "ai" also matches "ai/mcp". All tags must match. */
  tags?: string[];
  /** Only items with a reminder (`remind_at`) at or before this ISO instant (due reminders). */
  remindDueBy?: string;
  /**
   * Reading queue: only items unread at this ISO instant (no `metadata.read_status` read/skipped,
   * not snoozed past it; see reading.ts `isUnread`).
   */
  unreadAt?: string;
  limit: number;
}

export interface SearchHit {
  item_id: string;
  title: string;
  type: KnowledgeItemType;
  summary: string | null;
  snippet: string;
  folder_path: string;
  tags: string[];
  source_url: string | null;
  /** Lifecycle and type fields (status, rating, ...), so an agent can pick the right entry. */
  metadata?: Record<string, unknown>;
  /** Reminder instant (ISO) when the item is snoozed / has a due date. */
  remind_at?: string | null;
  score: number;
}

export interface NewItem {
  type: KnowledgeItemType;
  title: string;
  /** Callers pass a human slug; the repository makes it unique within the folder. */
  slug: string;
  content_md: string;
  source_url?: string | null;
  source_platform?: string;
  folder_path: string;
  is_manual_placement?: boolean;
  cluster_name?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  remind_at?: string | null;
}

export interface ItemPatch {
  type?: KnowledgeItemType;
  title?: string;
  content_md?: string;
  source_url?: string | null;
  /** Replaces the tag list (callers pass the union for "add"). */
  tags?: string[];
  remind_at?: string | null;
  folder_path?: string;
  is_manual_placement?: boolean;
  /** Merged key-wise into the existing metadata; a `null` value removes the key. */
  metadata?: Record<string, unknown>;
}

/** Result of a deduplicating save: the stored item and, if it already existed, why. */
export interface SaveResult {
  item: BrainItem;
  duplicate: { reason: DuplicateReason } | null;
}

export interface NewTask {
  title: string;
  priority: Priority;
  due_date: string | null;
  timeframe?: string | null;
  context?: string | null;
  project_item_id?: string | null;
}

/** Filters of `listTasks`; `timeframe` is already normalised, `exported` true/false = has/has no `exported_at`. */
export interface TaskFilter {
  includeDone: boolean;
  project_item_id?: string;
  timeframe?: string;
  exported?: boolean;
}

/** Task update; `null` clears a field. `exported` sets/clears `exported_at`. */
export interface TaskPatch {
  title?: string;
  priority?: Priority;
  due_date?: string | null;
  timeframe?: string | null;
  context?: string | null;
  project_item_id?: string | null;
  exported?: boolean;
}

/**
 * All data access of the MCP tools. Implementations are scoped to a single user
 * (the caller never passes a user id) and throw `BrainError` for expected failures.
 */
export interface BrainRepository {
  search(params: SearchParams): Promise<SearchHit[]>;
  getItem(id: string): Promise<BrainItem | null>;
  getHighlights(itemId: string): Promise<BrainHighlight[]>;
  /** Creates the item's folder (and ancestors) if missing. No dedup (agent memories are always new). */
  createItem(input: NewItem): Promise<BrainItem>;
  /**
   * Creates the item unless it already exists (URL, external id, content hash, object title; see
   * @kortex/db dedup.ts): then the input is merged into the existing item (adds, never overwrites).
   */
  saveItem(input: NewItem): Promise<SaveResult>;
  /** Applies a patch (creating the target folder if needed). Null when the item does not exist. */
  updateItem(id: string, patch: ItemPatch): Promise<BrainItem | null>;
  /** Union of the existing and the given (already normalised) tags. Null when the item does not exist. */
  addTags(id: string, tags: string[]): Promise<BrainItem | null>;
  /** Creates the folder and all missing ancestors. `created` is false when it already existed. */
  ensureFolder(folderPath: string): Promise<{ folder_path: string; created: boolean }>;
  listTasks(opts: TaskFilter): Promise<BrainTask[]>;
  /**
   * Dedup: when an open task (open/in_progress) with the same title (`matchKey`, @kortex/db) exists,
   * that task is returned with `duplicate: true` and nothing is created.
   */
  createTask(input: NewTask): Promise<{ task: BrainTask; duplicate: boolean }>;
  /** Null when the task does not exist. Completing a done task is a no-op returning it unchanged. */
  completeTask(id: string): Promise<BrainTask | null>;
  /** Null when the task does not exist. */
  updateTask(id: string, patch: TaskPatch): Promise<BrainTask | null>;
  /**
   * Every folder with its number of non-archived items (direct, not counting sub-folders), for
   * the agents guide's folder index. Optional: without it the guide has no index.
   */
  folderIndex?(): Promise<FolderCount[]>;
  /** The daily note of a date (type daily_note, slug = YYYY-MM-DD), or null. */
  findDailyNote?(date: string): Promise<BrainItem | null>;
}

/** Dedup candidate of an MCP save (@kortex/db dedup.ts). */
export const candidateOf = (input: NewItem): DedupCandidate => ({
  type: input.type,
  title: input.title,
  sourceUrl: input.source_url ?? null,
  contentMd: input.content_md,
  metadata: input.metadata ?? null,
  tags: input.tags ?? [],
  platform: input.source_platform ?? "mcp",
});

/** Produces the query embedding for hybrid search (the real one comes from @kortex/ai-core). */
export interface Embedder {
  embed(text: string): Promise<number[]>;
  /** "<provider>:<model_id>" of the vectors this embedder makes (the search filter). */
  modelKey?: string | null;
}

/** The user's taxonomy, so the organizer reuses existing tags/clusters/objects/folders. */
export interface OrganizerSnapshot {
  existingTags: string[];
  existingClusters: string[];
  existingObjects: { id: string; title: string; type: DomainObjectType }[];
  folderPaths: string[];
}

/** AI enrichment of an item. Never touches title, slug or content_md. */
export interface EnrichmentPatch {
  summary?: string | null;
  /** Replaces the tag list (callers pass the union with the existing tags). */
  tags?: string[];
  entities?: string[];
  cluster_name?: string;
  /** Created if missing. Callers only set it for items that are not manually placed. */
  folder_path?: string;
  /** Merged key-wise into the existing metadata. */
  metadata?: Record<string, unknown>;
  status?: string;
}

export interface NewChunk {
  chunk_index: number;
  chunk_heading: string | null;
  page_or_timestamp: string | null;
  chunk_text: string;
  /** 1536 dims; null when embedding failed (the chunk still serves full-text). */
  embedding: number[] | null;
  metadata?: Record<string, unknown>;
}

/** Repository capabilities the organizer needs (both shipped repositories implement them). */
export interface EnrichableRepository extends BrainRepository {
  getOrganizerContext(): Promise<OrganizerSnapshot>;
  /** Null when the item does not exist. */
  applyEnrichment(id: string, patch: EnrichmentPatch): Promise<BrainItem | null>;
  /** Replaces all chunks (and embeddings) of the item. */
  replaceChunks(itemId: string, chunks: NewChunk[]): Promise<void>;
}

export const isEnrichable = (repo: BrainRepository): repo is EnrichableRepository => {
  const r = repo as Partial<EnrichableRepository>;
  return (
    typeof r.applyEnrichment === "function" &&
    typeof r.replaceChunks === "function" &&
    typeof r.getOrganizerContext === "function"
  );
};

export interface EnrichmentOutcome {
  /** skipped: no AI call (connector switched off or daily AI budget reached), see `reason`. */
  status: "done" | "degraded" | "skipped";
  chunks: number;
  tags: string[];
  folder_path: string;
  warnings: string[];
  /** Why the organizer did not run (status skipped). */
  reason?: string;
  /** Organizer target held back for review (confidence below auto_place_threshold). */
  proposed_folder?: string;
}

/** Runs the AI organizer + chunker + embeddings on a freshly saved item (wired in `ai.ts`). */
export interface ItemEnricher {
  /** `keepFolder`: folder and cluster stay as they are (manual placement, agent memories). */
  enrich(
    item: BrainItem,
    repo: EnrichableRepository,
    opts?: { keepFolder?: boolean },
  ): Promise<EnrichmentOutcome>;
}
