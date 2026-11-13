import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  cardsFromSection,
  normalizeCards,
  parseFlashcardsSection,
  type ActionItemInsert,
  type IngestContext,
  type ItemChunkInsert,
} from "@kortex/ai-core";
import {
  bootstrapUser,
  createKortexClient,
  DOMAIN_OBJECT_TYPES,
  KORTEX_SCHEMA,
  dedupColumns,
  dedupKeys,
  findDuplicate,
  isSourceUrlConflict,
  mergeInto,
  syncSourceTasks,
  applyTaskSection,
  refreshTaskSection,
  type DomainObjectType,
  type Json,
  type KortexClient,
  type UserSettings,
} from "@kortex/db";
import type { EnrichmentStore, ItemEnrichmentPatch } from "./enrichment-store";
import {
  FOLDER_COLUMNS,
  ITEM_COLUMNS,
  type FolderWrite,
  type ItemVersion,
  type ItemWrite,
  type RemoteListener,
  type SyncFolder,
  type SyncItem,
  type Unsubscribe,
} from "../types";
import {
  candidateFromWrite,
  DuplicateItemError,
  type DuplicateMatch,
  type RemoteStore,
} from "./store";

const ITEM_SELECT = ITEM_COLUMNS.join(",");
/** Select list for a database that does not have the `remind_at` migration yet. */
const ITEM_SELECT_LEGACY = ITEM_COLUMNS.filter((c) => c !== "remind_at").join(",");
const FOLDER_SELECT = FOLDER_COLUMNS.join(",");
const PAGE_SIZE = 1000; // PostgREST default max-rows
const ID_CHUNK = 100;

/** The id in a file belongs to a row this user can't see (e.g. a file copied from another vault). */
export class RemoteIdConflictError extends Error {
  override name = "RemoteIdConflictError";
  constructor(readonly id: string) {
    super(`item id ${id} already exists for another owner`);
  }
}

interface PgError {
  code?: string;
  message: string;
}
function check<T>({ data, error }: { data: T; error: PgError | null }): T {
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

export interface SupabaseRemoteStoreOptions {
  /** Base delay for Realtime resubscribe backoff (doubles up to `maxReconnectDelayMs`). */
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  /** A connection must stay up this long before the backoff starts over (default 30 s). */
  stableConnectionMs?: number;
  /**
   * The client acts as the user (token mode, RLS) instead of the service role: bootstrap goes
   * through `kortex.bootstrap_user()` (auth.uid()), the service-only `_bootstrap_user` is not callable.
   */
  userScoped?: boolean;
}

/**
 * `RemoteStore` on the self-hosted Supabase (`kortex` schema).
 * Runs with the service-role key (a headless daemon has no user session), which bypasses RLS:
 * every query is therefore explicitly scoped to `userId`.
 */
export class SupabaseRemoteStore implements RemoteStore, EnrichmentStore {
  private readonly client: KortexClient;

  constructor(
    clientOrUrl: KortexClient | string,
    serviceRoleKey: string | null,
    readonly userId: string,
    private readonly options: SupabaseRemoteStoreOptions = {},
  ) {
    this.client =
      typeof clientOrUrl === "string"
        ? createKortexClient(clientOrUrl, serviceRoleKey ?? "", {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          })
        : clientOrUrl;
  }

  async bootstrapUser(): Promise<void> {
    if (this.options.userScoped) return bootstrapUser(this.client);
    check(await this.client.rpc("_bootstrap_user", { p_user_id: this.userId }));
  }

  // --- EnrichmentStore (same semantics as apps/web/src/server/repo.ts) -----------------

  async getUserSettings(): Promise<UserSettings | null> {
    return check(
      await this.client.from("user_settings").select("*").eq("user_id", this.userId).maybeSingle(),
    );
  }

  async loadIngestContext(settings: UserSettings | null): Promise<IngestContext> {
    const [tags, clusters, objects, folders] = await Promise.all([
      this.client
        .from("tags")
        .select("name")
        .eq("user_id", this.userId)
        .order("usage_count", { ascending: false })
        .limit(500),
      this.client
        .from("knowledge_items")
        .select("cluster_name")
        .eq("user_id", this.userId)
        .order("updated_at", { ascending: false })
        .limit(500),
      this.client
        .from("knowledge_items")
        .select("id,title,type")
        .eq("user_id", this.userId)
        .in("type", [...DOMAIN_OBJECT_TYPES])
        .limit(1000),
      this.listFolders(),
    ]);
    const clusterNames = (check(clusters) ?? [])
      .map((r) => r.cluster_name)
      .filter((n): n is string => !!n && n !== "General");
    return {
      existingTags: (check(tags) ?? []).map((t) => t.name),
      existingClusters: [...new Set(clusterNames)],
      existingObjects: (check(objects) ?? []).map((o) => ({
        id: o.id,
        title: o.title,
        type: o.type as DomainObjectType,
      })),
      folders: folders.map((f) => ({ id: f.id, folder_path: f.folder_path })),
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
    const row = check(
      await this.client
        .from("knowledge_items")
        .update(patch)
        .eq("id", id)
        .eq("user_id", this.userId)
        .eq("local_file_hash", expectedHash)
        .select(await this.itemSelect())
        .maybeSingle(),
    );
    return row as unknown as SyncItem | null;
  }

  async replaceChunks(itemId: string, chunks: readonly ItemChunkInsert[]): Promise<void> {
    check(
      await this.client
        .from("item_chunks")
        .delete()
        .eq("user_id", this.userId)
        .eq("item_id", itemId),
    );
    for (let i = 0; i < chunks.length; i += ID_CHUNK) {
      const rows = chunks
        .slice(i, i + ID_CHUNK)
        .map((c) => ({ ...c, user_id: this.userId, item_id: itemId }));
      check(await this.client.from("item_chunks").insert(rows));
    }
  }

  /** Stable task identity on re-extraction (same rule as apps/web, see @kortex/db dedup.ts). */
  async replaceOpenActionItems(itemId: string, rows: readonly ActionItemInsert[]): Promise<void> {
    await syncSourceTasks(this.client, this.userId, itemId, rows);
  }

  /** No RPC for an atomic increment exists; read-then-write like apps/web (fine for one user). */
  async bumpTags(names: readonly string[]): Promise<void> {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    if (unique.length === 0) return;
    const existing = check(
      await this.client
        .from("tags")
        .select("id,name,usage_count")
        .eq("user_id", this.userId)
        .in("name", unique),
    );
    const found = new Map((existing ?? []).map((t) => [t.name, t]));
    for (const name of unique) {
      const tag = found.get(name);
      if (tag) {
        check(
          await this.client
            .from("tags")
            .update({ usage_count: (tag.usage_count ?? 0) + 1 })
            .eq("user_id", this.userId)
            .eq("id", tag.id),
        );
      } else {
        check(
          await this.client
            .from("tags")
            .upsert(
              { user_id: this.userId, name, usage_count: 1, is_manual: false },
              { onConflict: "user_id,name" },
            ),
        );
      }
    }
  }

  async listItemVersions(): Promise<ItemVersion[]> {
    const out: ItemVersion[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = check(
        await this.client
          .from("knowledge_items")
          .select("id,updated_at,status")
          .eq("user_id", this.userId)
          .order("id")
          .range(from, from + PAGE_SIZE - 1),
      );
      out.push(...(page ?? []));
      if ((page?.length ?? 0) < PAGE_SIZE) return out;
    }
  }

  async getItems(ids: readonly string[]): Promise<SyncItem[]> {
    const out: SyncItem[] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const rows = check(
        await this.client
          .from("knowledge_items")
          .select(await this.itemSelect())
          .eq("user_id", this.userId)
          .in("id", ids.slice(i, i + ID_CHUNK)),
      );
      out.push(...(rows as unknown as SyncItem[]));
    }
    return out;
  }

  async getItem(id: string): Promise<SyncItem | null> {
    const row = check(
      await this.client
        .from("knowledge_items")
        .select(await this.itemSelect())
        .eq("user_id", this.userId)
        .eq("id", id)
        .maybeSingle(),
    );
    return row as unknown as SyncItem | null;
  }

  async mergeIfDuplicate(write: ItemWrite): Promise<DuplicateMatch | null> {
    const candidate = candidateFromWrite(write);
    const keys = await dedupKeys(candidate);
    const hit = await findDuplicate(this.client, this.userId, candidate, keys);
    if (!hit) return null;
    await mergeInto(this.client, this.userId, hit.item, candidate, keys);
    return { id: hit.item.id, reason: hit.reason };
  }

  /**
   * A "## Karteikarten" section edited in the vault is the source of the deck's questions/answers:
   * the JSON deck follows it, review state kept for unchanged questions (Portable Markdown).
   */
  private async flashcardsFromSection(write: ItemWrite): Promise<{ flashcards?: Json }> {
    const section = parseFlashcardsSection(write.content_md);
    if (!section) return {};
    const row = check(
      await this.client
        .from("knowledge_items")
        .select("flashcards")
        .eq("id", write.id)
        .eq("user_id", this.userId)
        .maybeSingle(),
    );
    const now = new Date();
    const cards = cardsFromSection(normalizeCards(row?.flashcards ?? null, now), section, now);
    return { flashcards: cards as unknown as Json };
  }

  private remindAtSupport?: Promise<boolean>;

  /**
   * Whether `knowledge_items.remind_at` exists. A daemon deployed before the type-registry
   * migration keeps syncing (without reminders) instead of failing on the missing column.
   */
  private hasRemindAt(): Promise<boolean> {
    this.remindAtSupport ??= (async () => {
      const { error } = await this.client.from("knowledge_items").select("remind_at").limit(0);
      if (!error) return true;
      if (error.code === "42703" || /remind_at/.test(error.message)) return false;
      this.remindAtSupport = undefined; // transient error: probe again next time
      throw Object.assign(new Error(error.message), { code: error.code });
    })();
    return this.remindAtSupport;
  }

  private async itemSelect(): Promise<string> {
    return (await this.hasRemindAt()) ? ITEM_SELECT : ITEM_SELECT_LEGACY;
  }

  async upsertItem(write: ItemWrite): Promise<SyncItem> {
    if (!(await this.hasRemindAt())) {
      write = { ...write };
      delete (write as Partial<ItemWrite>).remind_at;
    }
    const dedup = await dedupColumns(candidateFromWrite(write));
    const flashcards = await this.flashcardsFromSection(write);
    // Update-then-insert instead of upsert(onConflict: id): with the service role an upsert
    // would happily take over another user's row whose id ended up in a local file.
    const updated = check(
      await this.client
        .from("knowledge_items")
        .update({ ...write, content_hash: dedup.content_hash, ...flashcards })
        .eq("id", write.id)
        .eq("user_id", this.userId)
        .select(await this.itemSelect())
        .maybeSingle(),
    );
    if (updated) {
      await this.tasksFromSection(write);
      return updated as unknown as SyncItem;
    }

    const { data, error } = await this.client
      .from("knowledge_items")
      .insert({ ...write, ...dedup, user_id: this.userId })
      .select(await this.itemSelect())
      .single();
    if (error && isSourceUrlConflict(error)) {
      const hit = await this.mergeIfDuplicate(write);
      if (hit) throw new DuplicateItemError(hit.id, hit.reason);
    }
    if (error?.code === "23505") throw new RemoteIdConflictError(write.id);
    const inserted = check({ data, error }) as unknown as SyncItem;
    await this.tasksFromSection(write);
    return inserted;
  }

  /** Task id -> source item, so a Realtime DELETE (only carries the id) finds the note to re-render. */
  private readonly taskSource = new Map<string, string>();

  /**
   * A "## Aufgaben" section edited in the vault updates the note's tasks (ticked, renamed, new lines;
   * @kortex/db task-section.ts). The resulting task events re-render the section, which is then
   * unchanged (fixed point), so nothing is written back.
   */
  private async tasksFromSection(write: ItemWrite): Promise<void> {
    await applyTaskSection(this.client, this.userId, write.id, write.content_md);
  }

  async refreshTaskSection(itemId: string): Promise<boolean> {
    const { changed, taskIds } = await refreshTaskSection(this.client, this.userId, itemId);
    for (const id of taskIds) this.taskSource.set(id, itemId);
    return changed;
  }

  async archiveItem(id: string): Promise<void> {
    check(
      await this.client
        .from("knowledge_items")
        .update({ status: "archived" })
        .eq("id", id)
        .eq("user_id", this.userId),
    );
  }

  async deleteItem(id: string): Promise<void> {
    check(
      await this.client.from("knowledge_items").delete().eq("id", id).eq("user_id", this.userId),
    );
  }

  async listFolders(): Promise<SyncFolder[]> {
    const out: SyncFolder[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = check(
        await this.client
          .from("folders")
          .select(FOLDER_SELECT)
          .eq("user_id", this.userId)
          .order("folder_path")
          .range(from, from + PAGE_SIZE - 1),
      ) as unknown as SyncFolder[];
      out.push(...page);
      if (page.length < PAGE_SIZE) return out;
    }
  }

  async getFolder(id: string): Promise<SyncFolder | null> {
    const row = check(
      await this.client
        .from("folders")
        .select(FOLDER_SELECT)
        .eq("user_id", this.userId)
        .eq("id", id)
        .maybeSingle(),
    );
    return row as unknown as SyncFolder | null;
  }

  private async folderByPath(folderPath: string): Promise<SyncFolder | null> {
    const row = check(
      await this.client
        .from("folders")
        .select(FOLDER_SELECT)
        .eq("user_id", this.userId)
        .eq("folder_path", folderPath)
        .maybeSingle(),
    );
    return row as unknown as SyncFolder | null;
  }

  async createFolder(write: FolderWrite): Promise<SyncFolder> {
    const existing = await this.folderByPath(write.folder_path);
    if (existing) return existing;
    const { data, error } = await this.client
      .from("folders")
      .insert({ ...write, user_id: this.userId, icon: "folder" })
      .select(FOLDER_SELECT)
      .single();
    if (error?.code === "23505") {
      const raced = await this.folderByPath(write.folder_path);
      if (raced) return raced;
    }
    return check({ data, error }) as unknown as SyncFolder;
  }

  async deleteFolder(id: string): Promise<void> {
    check(await this.client.from("folders").delete().eq("id", id).eq("user_id", this.userId));
  }

  /**
   * Realtime `postgres_changes` on `kortex.knowledge_items` and `kortex.folders`.
   * INSERT/UPDATE are filtered server-side by user_id; DELETE events cannot be filtered
   * (and only carry the primary key), so they arrive for all users and the engine ignores
   * ids it doesn't track. On CHANNEL_ERROR / TIMED_OUT / CLOSED the channel is recreated
   * with exponential backoff; every (re)connect is reported so the engine can reconcile
   * whatever it missed while disconnected.
   */
  subscribe(listener: RemoteListener): Unsubscribe {
    const base = this.options.reconnectDelayMs ?? 1000;
    const max = this.options.maxReconnectDelayMs ?? 60_000;
    let stopped = false;
    let attempt = 0;
    let generation = 0;
    let channel: RealtimeChannel | null = null;
    let connectedAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const userFilter = `user_id=eq.${this.userId}`;
    const stableMs = this.options.stableConnectionMs ?? 30_000;

    const scheduleReconnect = () => {
      if (stopped || timer) return;
      // Only a connection that stayed up resets the backoff; a flapping server keeps backing off.
      if (connectedAt !== null && Date.now() - connectedAt >= stableMs) attempt = 0;
      connectedAt = null;
      const delay = Math.min(base * 2 ** attempt++, max);
      timer = setTimeout(() => {
        timer = undefined;
        const old = channel;
        // Detach first: removing a channel fires its own CLOSED status, which must not count as a
        // new drop (that re-scheduled a reconnect every ~0.5 s forever; found in the live run).
        channel = null;
        void (old ? this.client.removeChannel(old) : Promise.resolve()).finally(() => {
          if (!stopped) connect();
        });
      }, delay);
    };

    const connect = () => {
      const gen = ++generation;
      const ch = this.client.channel(`kortex-md-sync:${this.userId}:${gen}`);
      for (const table of ["knowledge_items", "folders"] as const) {
        for (const event of ["INSERT", "UPDATE"] as const) {
          ch.on(
            "postgres_changes",
            { event, schema: KORTEX_SCHEMA, table, filter: userFilter },
            (payload) => {
              const id = (payload.new as { id?: string }).id;
              if (id) listener.onChange({ table, op: "upsert", id });
            },
          );
        }
        ch.on("postgres_changes", { event: "DELETE", schema: KORTEX_SCHEMA, table }, (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (id) listener.onChange({ table, op: "delete", id });
        });
      }
      // Tasks: the note that shows them re-renders its "## Aufgaben" section. DELETE events carry only
      // the id (and are not user-filtered), so the note comes from the ids seen before.
      for (const event of ["INSERT", "UPDATE"] as const) {
        ch.on(
          "postgres_changes",
          { event, schema: KORTEX_SCHEMA, table: "action_items", filter: userFilter },
          (payload) => {
            const row = payload.new as { id?: string; source_item_id?: string | null };
            if (!row.id) return;
            const before = this.taskSource.get(row.id);
            const source = row.source_item_id ?? null;
            if (source) this.taskSource.set(row.id, source);
            else this.taskSource.delete(row.id);
            if (before && before !== source)
              listener.onChange({ table: "action_items", op: "upsert", id: row.id, sourceItemId: before });
            listener.onChange({ table: "action_items", op: "upsert", id: row.id, sourceItemId: source });
          },
        );
      }
      ch.on(
        "postgres_changes",
        { event: "DELETE", schema: KORTEX_SCHEMA, table: "action_items" },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          const source = id ? this.taskSource.get(id) : undefined;
          if (!id || !source) return;
          this.taskSource.delete(id);
          listener.onChange({ table: "action_items", op: "delete", id, sourceItemId: source });
        },
      );
      channel = ch;
      ch.subscribe((status, err) => {
        // Stale or detached channel (being removed by us): ignore its status changes.
        if (gen !== generation || stopped || channel !== ch) return;
        if (status === "SUBSCRIBED") {
          connectedAt = Date.now();
          listener.onStatus?.("connected");
        } else {
          listener.onStatus?.("disconnected", err?.message ?? status);
          scheduleReconnect();
        }
      });
    };

    connect();
    return async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (channel) await this.client.removeChannel(channel);
      channel = null;
    };
  }
}
