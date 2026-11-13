import { randomUUID } from "node:crypto";
import { SYSTEM_FOLDER_PATHS } from "@kortex/db";
import { slugify } from "../paths";
import type {
  FolderWrite,
  ItemVersion,
  ItemWrite,
  RemoteChange,
  RemoteListener,
  RemoteStatus,
  SyncFolder,
  SyncItem,
  Unsubscribe,
} from "../types";
import type { ActionItemInsert, IngestContext, ItemChunkInsert } from "@kortex/ai-core";
import {
  DOMAIN_OBJECT_TYPES,
  dedupColumns,
  dedupKeys,
  findDuplicateIn,
  planMerge,
  planTaskSync,
  parseTaskSection,
  planTaskSectionSync,
  taskInsertFromLine,
  withTaskSection,
  type SectionTask,
  type DedupItem,
  type DomainObjectType,
  type UserSettings,
} from "@kortex/db";
import type { EnrichmentStore, ItemEnrichmentPatch } from "./enrichment-store";
import { candidateFromWrite, type DuplicateMatch, type RemoteStore } from "./store";

const clone = <T>(v: T): T => structuredClone(v);

/**
 * In-memory `RemoteStore` for tests and offline development. Mirrors the DB behaviour md-sync
 * relies on: column defaults, `updated_at` trigger, unique `(user_id, folder_path)`,
 * folder delete cascade, and an async Realtime-like change feed.
 */
export class InMemoryRemoteStore implements RemoteStore, EnrichmentStore {
  readonly items = new Map<string, SyncItem>();
  readonly folders = new Map<string, SyncFolder>();
  /** item_chunks by item id. */
  readonly chunks = new Map<string, ItemChunkInsert[]>();
  readonly actionItems: ActionItemInsert[] = [];
  /** kortex.tags: name -> usage_count. */
  readonly tags = new Map<string, number>();
  userSettings: UserSettings | null = null;
  /** Call counters for assertions (e.g. "no echo loop" = no extra upserts). */
  readonly calls = {
    upsertItem: 0,
    archiveItem: 0,
    deleteItem: 0,
    createFolder: 0,
    deleteFolder: 0,
    applyEnrichment: 0,
    refreshTaskSection: 0,
  };
  private listeners = new Set<RemoteListener>();
  private lastTs = 0;

  constructor(
    readonly userId: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Strictly increasing timestamps, like the DB trigger's now() across transactions. */
  private nextTimestamp(): string {
    const t = Math.max(this.clock().getTime(), this.lastTs + 1);
    this.lastTs = t;
    return new Date(t).toISOString();
  }

  private emit(change: RemoteChange): void {
    for (const l of this.listeners) setTimeout(() => l.onChange(change), 0);
  }

  /** Simulates a Realtime connection state change. */
  setStatus(status: RemoteStatus, detail?: string): void {
    for (const l of this.listeners) l.onStatus?.(status, detail);
  }

  async bootstrapUser(): Promise<void> {
    const parents = new Map<string, string>();
    for (const folderPath of SYSTEM_FOLDER_PATHS) {
      const segs = folderPath.split("/");
      const name = segs[segs.length - 1] ?? folderPath;
      const parentPath = segs.slice(0, -1).join("/");
      const existing = [...this.folders.values()].find((f) => f.folder_path === folderPath);
      if (existing) {
        parents.set(folderPath, existing.id);
        continue;
      }
      const folder: SyncFolder = {
        id: randomUUID(),
        user_id: this.userId,
        parent_id: parentPath ? (parents.get(parentPath) ?? null) : null,
        name,
        slug: slugify(name),
        folder_path: folderPath,
        is_system_default: true,
      };
      this.folders.set(folder.id, folder);
      parents.set(folderPath, folder.id);
    }
  }

  async listItemVersions(): Promise<ItemVersion[]> {
    return [...this.items.values()].map(({ id, updated_at, status }) => ({
      id,
      updated_at,
      status,
    }));
  }

  async getItems(ids: readonly string[]): Promise<SyncItem[]> {
    return ids.flatMap((id) => {
      const item = this.items.get(id);
      return item ? [clone(item)] : [];
    });
  }

  async getItem(id: string): Promise<SyncItem | null> {
    const item = this.items.get(id);
    return item ? clone(item) : null;
  }

  /** Dedup columns per item (SyncItem does not carry them). */
  private readonly dedup = new Map<
    string,
    { source_url_norm: string | null; content_hash: string | null }
  >();

  async mergeIfDuplicate(write: ItemWrite): Promise<DuplicateMatch | null> {
    const candidate = candidateFromWrite(write);
    const keys = await dedupKeys(candidate);
    const rows: DedupItem[] = [...this.items.values()].map((i) => ({
      ...i,
      summary: null,
      source_url_norm: this.dedup.get(i.id)?.source_url_norm ?? null,
      content_hash: this.dedup.get(i.id)?.content_hash ?? null,
    }));
    const hit = findDuplicateIn(rows, candidate, keys);
    if (!hit) return null;
    const patch = planMerge(hit.item, candidate, keys);
    const item = this.items.get(hit.item.id);
    if (item && Object.keys(patch).length) {
      if (patch.tags) item.tags = patch.tags;
      if (patch.metadata) item.metadata = patch.metadata as SyncItem["metadata"];
      if (patch.content_md !== undefined) item.content_md = patch.content_md;
      if (patch.source_url) item.source_url = patch.source_url;
      item.updated_at = this.nextTimestamp();
      this.dedup.set(
        item.id,
        await dedupColumns(candidateFromWrite({ ...write, ...item } as ItemWrite)),
      );
      this.emit({ table: "knowledge_items", op: "upsert", id: item.id });
    }
    return { id: hit.item.id, reason: hit.reason };
  }

  async upsertItem(write: ItemWrite): Promise<SyncItem> {
    this.calls.upsertItem++;
    this.dedup.set(write.id, await dedupColumns(candidateFromWrite(write)));
    const prev = this.items.get(write.id);
    const now = this.nextTimestamp();
    const item: SyncItem = {
      ...(prev ?? {
        user_id: this.userId,
        is_manual_placement: false,
        created_at: now,
      }),
      ...clone(write),
      is_manual_placement: write.is_manual_placement ?? prev?.is_manual_placement ?? false,
      user_id: this.userId,
      updated_at: now,
    } as SyncItem;
    this.items.set(item.id, item);
    this.emit({ table: "knowledge_items", op: "upsert", id: item.id });
    this.tasksFromSection(item.id, write.content_md);
    return clone(item);
  }

  // --- "## Aufgaben" section <-> action_items (same rules as SupabaseRemoteStore) ------------

  private sectionTasks(itemId: string): SectionTask[] {
    return this.actionItems
      .filter((a) => a.source_item_id === itemId)
      .map((a) => {
        a.id ??= randomUUID();
        return {
          id: a.id,
          title: a.title,
          status: a.status ?? "open",
          due_date: a.due_date ?? null,
          timeframe: a.timeframe ?? null,
          context: a.context ?? null,
        };
      });
  }

  private tasksFromSection(itemId: string, md: string): void {
    const lines = parseTaskSection(md);
    if (!lines) return;
    const now = this.clock().toISOString();
    const plan = planTaskSectionSync(this.sectionTasks(itemId), lines, now);
    for (const u of plan.update) {
      const a = this.actionItems.find((x) => x.id === u.id);
      if (!a) continue;
      Object.assign(a, u.patch);
      this.emit({ table: "action_items", op: "upsert", id: u.id, sourceItemId: itemId });
    }
    for (const p of plan.insert) {
      const row = { ...taskInsertFromLine(this.userId, itemId, p, now), id: randomUUID() };
      this.actionItems.push(row);
      this.emit({ table: "action_items", op: "upsert", id: row.id, sourceItemId: itemId });
    }
  }

  async refreshTaskSection(itemId: string): Promise<boolean> {
    this.calls.refreshTaskSection++;
    const item = this.items.get(itemId);
    if (!item) return false;
    const next = withTaskSection(item.content_md ?? "", this.sectionTasks(itemId));
    if (next.trimEnd() === (item.content_md ?? "").trimEnd()) return false;
    this.editItem(itemId, { content_md: next });
    return true;
  }

  /** Creates a task as the web app / mobile / MCP would (emits a Realtime-like change). */
  seedTask(row: Omit<ActionItemInsert, "user_id"> & { source_item_id: string }): string {
    const id = row.id ?? randomUUID();
    this.actionItems.push({ status: "open", ...clone(row), id, user_id: this.userId });
    this.emit({ table: "action_items", op: "upsert", id, sourceItemId: row.source_item_id });
    return id;
  }

  editTask(id: string, patch: Partial<ActionItemInsert>): void {
    const a = this.actionItems.find((x) => x.id === id);
    if (!a) throw new Error(`no task ${id}`);
    Object.assign(a, patch);
    this.emit({ table: "action_items", op: "upsert", id, sourceItemId: a.source_item_id ?? null });
  }

  removeTask(id: string): void {
    const i = this.actionItems.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [a] = this.actionItems.splice(i, 1);
    this.emit({ table: "action_items", op: "delete", id, sourceItemId: a?.source_item_id ?? null });
  }

  async archiveItem(id: string): Promise<void> {
    this.calls.archiveItem++;
    const item = this.items.get(id);
    if (!item) return;
    item.status = "archived";
    item.updated_at = this.nextTimestamp();
    this.emit({ table: "knowledge_items", op: "upsert", id });
  }

  async deleteItem(id: string): Promise<void> {
    this.calls.deleteItem++;
    if (this.items.delete(id)) this.emit({ table: "knowledge_items", op: "delete", id });
  }

  async listFolders(): Promise<SyncFolder[]> {
    return [...this.folders.values()].map(clone);
  }

  async getFolder(id: string): Promise<SyncFolder | null> {
    const f = this.folders.get(id);
    return f ? clone(f) : null;
  }

  async createFolder(write: FolderWrite): Promise<SyncFolder> {
    this.calls.createFolder++;
    const existing = [...this.folders.values()].find((f) => f.folder_path === write.folder_path);
    if (existing) return clone(existing);
    const folder: SyncFolder = {
      id: randomUUID(),
      user_id: this.userId,
      parent_id: write.parent_id,
      name: write.name,
      slug: write.slug,
      folder_path: write.folder_path,
      is_system_default: false,
    };
    this.folders.set(folder.id, folder);
    this.emit({ table: "folders", op: "upsert", id: folder.id });
    return clone(folder);
  }

  async deleteFolder(id: string): Promise<void> {
    this.calls.deleteFolder++;
    // ON DELETE CASCADE on parent_id; items keep folder_path but lose folder_id (SET NULL).
    const doomed = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of this.folders.values()) {
        if (f.parent_id && doomed.has(f.parent_id) && !doomed.has(f.id)) {
          doomed.add(f.id);
          grew = true;
        }
      }
    }
    for (const fid of doomed) {
      if (this.folders.delete(fid)) this.emit({ table: "folders", op: "delete", id: fid });
    }
    for (const item of this.items.values()) {
      if (item.folder_id && doomed.has(item.folder_id)) item.folder_id = null;
    }
  }

  subscribe(listener: RemoteListener): Unsubscribe {
    this.listeners.add(listener);
    setTimeout(() => listener.onStatus?.("connected"), 0);
    return async () => {
      this.listeners.delete(listener);
    };
  }

  // --- EnrichmentStore ---------------------------------------------------------------

  async getUserSettings(): Promise<UserSettings | null> {
    return this.userSettings ? clone(this.userSettings) : null;
  }

  async loadIngestContext(settings: UserSettings | null): Promise<IngestContext> {
    const items = [...this.items.values()];
    const folders = [...this.folders.values()].map(({ id, folder_path }) => ({ id, folder_path }));
    return {
      existingTags: [...this.tags.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
      existingClusters: [
        ...new Set(
          items.map((i) => i.cluster_name).filter((c): c is string => !!c && c !== "General"),
        ),
      ],
      existingObjects: items
        .filter((i) => (DOMAIN_OBJECT_TYPES as readonly string[]).includes(i.type))
        .map((i) => ({ id: i.id, title: i.title, type: i.type as DomainObjectType })),
      folders,
      folderPaths: folders.map((f) => f.folder_path),
      userSettings: settings
        ? {
            auto_tag_enabled: settings.auto_tag_enabled,
            auto_cluster_enabled: settings.auto_cluster_enabled,
          }
        : null,
    };
  }

  async applyEnrichment(
    id: string,
    patch: ItemEnrichmentPatch,
    expectedHash: string,
  ): Promise<SyncItem | null> {
    this.calls.applyEnrichment++;
    const item = this.items.get(id);
    if (!item || item.local_file_hash !== expectedHash) return null;
    Object.assign(item, clone(patch), { updated_at: this.nextTimestamp() });
    this.emit({ table: "knowledge_items", op: "upsert", id });
    return clone(item);
  }

  async replaceChunks(itemId: string, chunks: readonly ItemChunkInsert[]): Promise<void> {
    this.chunks.set(itemId, clone([...chunks]));
  }

  async replaceOpenActionItems(itemId: string, rows: readonly ActionItemInsert[]): Promise<void> {
    const own = this.actionItems.filter((a) => a.source_item_id === itemId);
    const plan = planTaskSync(
      own.map((a, i) => ({
        ...a,
        id: a.id ?? `mem-${itemId}-${i}`,
        status: a.status ?? "open",
        due_date: a.due_date ?? null,
      })),
      rows,
    );
    own.forEach((a, i) => (a.id ??= `mem-${itemId}-${i}`));
    for (let i = this.actionItems.length - 1; i >= 0; i--) {
      const id = this.actionItems[i]?.id;
      if (id && plan.deleteIds.includes(id)) this.actionItems.splice(i, 1);
    }
    for (const u of plan.update) {
      const a = this.actionItems.find((x) => x.id === u.id);
      if (a) a.due_date = u.due_date;
    }
    this.actionItems.push(...clone(plan.insert.map((r) => ({ ...r, source_item_id: itemId }))));
  }

  async bumpTags(names: readonly string[]): Promise<void> {
    for (const name of new Set(names.map((n) => n.trim()).filter(Boolean))) {
      this.tags.set(name, (this.tags.get(name) ?? 0) + 1);
    }
  }

  // --- test helpers: simulate edits made by the web app / AI pipeline -------------

  /** Creates an item as another client would (defaults like the DB). */
  seedItem(partial: Partial<SyncItem> & { title: string }): SyncItem {
    const now = this.nextTimestamp();
    const id = partial.id ?? randomUUID();
    const item: SyncItem = {
      id,
      user_id: this.userId,
      parent_item_id: null,
      folder_id: null,
      type: "note",
      source_platform: "manual",
      slug: slugify(partial.title),
      content_md: "",
      source_url: null,
      cover_image_url: null,
      icon: "file-text",
      cluster_name: "General",
      folder_path: "00_Inbox",
      is_manual_placement: false,
      tags: [],
      entities: [],
      metadata: {},
      status: "inbox",
      local_file_hash: null,
      created_at: now,
      updated_at: now,
      ...partial,
    };
    this.items.set(id, item);
    this.emit({ table: "knowledge_items", op: "upsert", id });
    return clone(item);
  }

  /** Updates an item as another client would (bumps updated_at, emits a change). */
  editItem(id: string, patch: Partial<SyncItem>): SyncItem {
    const item = this.items.get(id);
    if (!item) throw new Error(`no item ${id}`);
    Object.assign(item, patch, { updated_at: this.nextTimestamp() });
    this.emit({ table: "knowledge_items", op: "upsert", id });
    return clone(item);
  }

  removeItem(id: string): void {
    if (this.items.delete(id)) this.emit({ table: "knowledge_items", op: "delete", id });
  }

  seedFolder(folderPath: string, parentId: string | null = null): SyncFolder {
    const name = folderPath.split("/").pop() ?? folderPath;
    const folder: SyncFolder = {
      id: randomUUID(),
      user_id: this.userId,
      parent_id: parentId,
      name,
      slug: slugify(name),
      folder_path: folderPath,
      is_system_default: false,
    };
    this.folders.set(folder.id, folder);
    this.emit({ table: "folders", op: "upsert", id: folder.id });
    return clone(folder);
  }

  itemByTitle(title: string): SyncItem | undefined {
    return [...this.items.values()].find((i) => i.title === title);
  }

  folderByPath(folderPath: string): SyncFolder | undefined {
    return [...this.folders.values()].find((f) => f.folder_path === folderPath);
  }
}
