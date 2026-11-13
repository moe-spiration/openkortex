import {
  contentHash,
  dedupKeys,
  DOMAIN_OBJECT_TYPES,
  findDuplicate,
  findOpenTaskByTitle,
  isSourceUrlConflict,
  mergeInto,
  snapTags,
  urlKey,
  type DedupKeys,
  matchKnowledgeHybrid,
  matchKnowledgeHybridForUser,
  toPgVector,
  type ActionItemStatus,
  type DomainObjectType,
  type KnowledgeItemType,
  type KortexClient,
  type Priority,
} from "@kortex/db";
import type {
  BrainHighlight,
  BrainItem,
  BrainTask,
  EnrichableRepository,
  EnrichmentPatch,
  ItemPatch,
  NewChunk,
  NewItem,
  NewTask,
  OrganizerSnapshot,
  SaveResult,
  SearchHit,
  SearchParams,
  TaskFilter,
  TaskPatch,
} from "./repository";
import { candidateOf } from "./repository";
import {
  applyMetadataPatch,
  BrainError,
  folderChain,
  isDue,
  metadataMatches,
  slugify,
  tagMatches,
} from "./util";

const ITEM_COLUMNS =
  "id,type,title,slug,summary,content_md,source_url,source_platform,folder_path,is_manual_placement,cluster_name,tags,metadata,status,remind_at,created_at,updated_at";
const TASK_COLUMNS =
  "id,title,status,priority,due_date,source_item_id,project_item_id,timeframe,context,exported_at,external_ref,created_at,completed_at";

interface ItemRow {
  id: string;
  type: string;
  title: string;
  slug: string;
  summary: string | null;
  content_md: string;
  source_url: string | null;
  source_platform: string;
  folder_path: string;
  is_manual_placement: boolean | null;
  cluster_name: string | null;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  status: string;
  remind_at?: string | null;
  created_at: string;
  updated_at: string;
}

const toItem = (r: ItemRow): BrainItem => ({
  id: r.id,
  type: r.type as KnowledgeItemType,
  title: r.title,
  slug: r.slug,
  summary: r.summary,
  content_md: r.content_md,
  source_url: r.source_url,
  source_platform: r.source_platform,
  folder_path: r.folder_path,
  is_manual_placement: r.is_manual_placement ?? false,
  cluster_name: r.cluster_name ?? "General",
  tags: r.tags ?? [],
  metadata: r.metadata ?? {},
  status: r.status,
  remind_at: r.remind_at ?? null,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const toTask = (r: {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  source_item_id: string | null;
  project_item_id: string | null;
  timeframe: string | null;
  context: string | null;
  exported_at: string | null;
  external_ref: string | null;
  created_at: string;
  completed_at: string | null;
}): BrainTask => ({
  ...r,
  status: r.status as ActionItemStatus,
  priority: r.priority as Priority,
});

/** PostgREST errors are plain objects, not Errors: normalise so the tool layer can report them. */
function unwrap<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error)
    throw Object.assign(new Error(`Supabase: ${res.error.message}`), { code: res.error.code });
  return res.data;
}

const must = <T>(v: T | null | undefined, what: string): T => {
  if (v == null) throw new Error(`Supabase returned no row for ${what}`);
  return v;
};

export interface SupabaseBrainOptions {
  client: KortexClient;
  userId: string;
  /**
   * True when the client acts as the user (JWT carrying `sub = userId`): RLS applies and search
   * uses the `match_knowledge_hybrid` RPC (scoped by `auth.uid()`). False for the service-role
   * key, which bypasses RLS: every query is then scoped by `user_id` here and search uses
   * `match_knowledge_hybrid_for_user` (service role only).
   */
  userScoped: boolean;
}

/**
 * Supabase-backed repository (schema `kortex`). Every query filters on `user_id` explicitly, so
 * it is safe with the service-role key (which bypasses RLS) as well as with a user-scoped client.
 * Written against the generated types and the migration; not exercised against a live database.
 */
export class SupabaseBrainRepository implements EnrichableRepository {
  private readonly db: KortexClient;
  private readonly uid: string;
  private readonly userScoped: boolean;

  constructor(opts: SupabaseBrainOptions) {
    this.db = opts.client;
    this.uid = opts.userId;
    this.userScoped = opts.userScoped;
  }

  async search(p: SearchParams): Promise<SearchHit[]> {
    const types = [...(p.type ? [p.type] : []), ...(p.types ?? [])];
    if (!p.query.trim()) return this.listMatching(p, types);
    const filtered = !!p.tags?.length || !!p.metadata || types.length > 1 || !!p.remindDueBy;
    const overfetch = filtered ? Math.min(p.limit * 4, 200) : p.limit;
    const hits = await this.hybrid(
      { ...p, type: types.length === 1 ? types[0] : undefined },
      overfetch,
    );
    // Metadata (status, rating, ...) for the hits: the filter and the agent's choice need it.
    const meta = new Map<string, Record<string, unknown>>();
    const remind = new Map<string, string | null>();
    if (hits.length) {
      const rows = unwrap(
        await this.db
          .from("knowledge_items")
          .select("id,metadata,remind_at")
          .eq("user_id", this.uid)
          .in(
            "id",
            hits.map((h) => h.item_id),
          ),
      );
      for (const r of rows ?? []) {
        meta.set(r.id, (r.metadata ?? {}) as Record<string, unknown>);
        remind.set(r.id, r.remind_at ?? null);
      }
    }
    return hits
      .map((h) => ({
        ...h,
        metadata: meta.get(h.item_id) ?? {},
        remind_at: remind.get(h.item_id) ?? null,
      }))
      .filter(
        (h) =>
          (types.length === 0 || types.includes(h.type)) &&
          isDue(h.remind_at, p.remindDueBy) &&
          metadataMatches(h.metadata, p.metadata) &&
          !p.tags?.some((t) => !tagMatches(h.tags, t)),
      )
      .slice(0, p.limit);
  }

  /** Filter-only search (no query): the newest matching items. */
  private async listMatching(p: SearchParams, types: KnowledgeItemType[]): Promise<SearchHit[]> {
    let q = this.db
      .from("knowledge_items")
      .select("id,title,type,summary,content_md,folder_path,tags,source_url,metadata,remind_at")
      .eq("user_id", this.uid)
      .neq("status", "archived");
    if (p.remindDueBy) q = q.not("remind_at", "is", null).lte("remind_at", p.remindDueBy);
    if (types.length) q = q.in("type", types);
    if (p.metadata) q = q.contains("metadata", p.metadata as never);
    if (p.folderPath)
      q = q.or(`folder_path.eq."${p.folderPath}",folder_path.like."${p.folderPath}/*"`);
    const rows = unwrap(
      await q
        .order(p.remindDueBy ? "remind_at" : "updated_at", { ascending: !!p.remindDueBy })
        .limit(p.tags?.length ? 200 : p.limit),
    );
    return (rows ?? [])
      .filter((r) => !p.tags?.some((t) => !tagMatches(r.tags ?? [], t)))
      .slice(0, p.limit)
      .map((r) => ({
        item_id: r.id,
        title: r.title,
        type: r.type as KnowledgeItemType,
        summary: r.summary,
        snippet: r.content_md.slice(0, 300),
        folder_path: r.folder_path,
        tags: r.tags ?? [],
        source_url: r.source_url,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
        remind_at: r.remind_at ?? null,
        score: 1,
      }));
  }

  private async hybrid(p: SearchParams, matchCount: number): Promise<SearchHit[]> {
    const params = {
      queryText: p.query,
      queryEmbedding: p.embedding,
      matchCount,
      filterType: p.type,
      filterFolderPath: p.folderPath,
      filterEmbeddingModel: p.embeddingModel ?? null,
    };
    const rows = await (
      this.userScoped
        ? matchKnowledgeHybrid(this.db, params)
        : matchKnowledgeHybridForUser(this.db, this.uid, params)
    ).catch((e: unknown) => {
      throw new Error(`Supabase: ${(e as { message?: string }).message ?? String(e)}`);
    });
    return rows.map((r) => ({
      item_id: r.item_id,
      title: r.title,
      type: r.type as KnowledgeItemType,
      summary: r.summary,
      snippet: r.chunk_text,
      folder_path: r.folder_path,
      tags: r.tags ?? [],
      source_url: r.source_url,
      score: r.combined_score,
    }));
  }

  async getItem(id: string) {
    const row = unwrap(
      await this.db
        .from("knowledge_items")
        .select(ITEM_COLUMNS)
        .eq("id", id)
        .eq("user_id", this.uid)
        .maybeSingle(),
    );
    return row ? toItem(row as unknown as ItemRow) : null;
  }

  async getHighlights(itemId: string): Promise<BrainHighlight[]> {
    const rows = unwrap(
      await this.db
        .from("item_highlights")
        .select("id,item_id,quote_text,note_text,color,locator,created_at")
        .eq("item_id", itemId)
        .eq("user_id", this.uid)
        .order("created_at", { ascending: true }),
    );
    return rows ?? [];
  }

  async saveItem(input: NewItem): Promise<SaveResult> {
    const known = unwrap(
      await this.db.from("tags").select("name").eq("user_id", this.uid).limit(2000),
    );
    const snapped = {
      ...input,
      tags: snapTags(
        input.tags ?? [],
        (known ?? []).map((t) => t.name),
      ),
    };
    const candidate = candidateOf(snapped);
    const keys = await dedupKeys(candidate);
    const merge = async (): Promise<SaveResult | null> => {
      const hit = await findDuplicate(this.db, this.uid, candidate, keys);
      if (!hit) return null;
      const patch = await mergeInto(this.db, this.uid, hit.item, candidate, keys);
      if (patch.tags)
        await this.touchTags(patch.tags.filter((t) => !(hit.item.tags ?? []).includes(t)));
      return {
        item: must(await this.getItem(hit.item.id), "merged item"),
        duplicate: { reason: hit.reason },
      };
    };
    const existing = await merge();
    if (existing) return existing;
    try {
      return { item: await this.createItem(snapped, keys), duplicate: null };
    } catch (e) {
      // Lost a race on uq_items_user_source_url_norm: the other insert won, merge into it.
      if (isSourceUrlConflict(e)) {
        const raced = await merge();
        if (raced) return raced;
      }
      throw e;
    }
  }

  async createItem(input: NewItem, keys?: DedupKeys) {
    const folder = await this.ensureFolderId(input.folder_path);
    const slug = await this.uniqueSlug(input.folder_path, input.slug);
    const tags = [...new Set(input.tags ?? [])];
    const row = unwrap(
      await this.db
        .from("knowledge_items")
        .insert({
          user_id: this.uid,
          type: input.type,
          title: input.title,
          slug,
          content_md: input.content_md,
          source_url: input.source_url ?? null,
          source_platform: input.source_platform ?? "mcp",
          folder_path: input.folder_path,
          folder_id: folder.id,
          is_manual_placement: input.is_manual_placement ?? false,
          cluster_name: input.cluster_name ?? "General",
          tags,
          metadata: (input.metadata ?? {}) as never,
          status: "inbox",
          remind_at: input.remind_at ?? null,
          source_url_norm: keys?.source_url_norm ?? null,
          content_hash: keys?.content_hash ?? null,
        })
        .select(ITEM_COLUMNS)
        .single(),
    );
    await this.touchTags(tags);
    return toItem(row as unknown as ItemRow);
  }

  private async uniqueSlug(folderPath: string, slug: string): Promise<string> {
    const rows = unwrap(
      await this.db
        .from("knowledge_items")
        .select("slug")
        .eq("user_id", this.uid)
        .eq("folder_path", folderPath)
        .like("slug", `${slug}%`),
    );
    const taken = new Set((rows ?? []).map((r) => r.slug));
    let candidate = slug;
    for (let n = 2; taken.has(candidate); n++) candidate = `${slug}-${n}`;
    return candidate;
  }

  async updateItem(id: string, patch: ItemPatch) {
    const existing = await this.getItem(id);
    if (!existing) return null;
    const folderId =
      patch.folder_path !== undefined ? (await this.ensureFolderId(patch.folder_path)).id : undefined;
    const row = unwrap(
      await this.db
        .from("knowledge_items")
        .update({
          ...(patch.type !== undefined && { type: patch.type }),
          ...(patch.title !== undefined && { title: patch.title }),
          ...(patch.content_md !== undefined && {
            content_md: patch.content_md,
            content_hash: await contentHash(patch.content_md),
          }),
          ...(patch.source_url !== undefined && {
            source_url: patch.source_url,
            source_url_norm: urlKey(patch.source_url),
          }),
          ...(patch.tags !== undefined && { tags: [...new Set(patch.tags)] }),
          ...(patch.remind_at !== undefined && { remind_at: patch.remind_at }),
          ...(patch.folder_path !== undefined && { folder_path: patch.folder_path, folder_id: folderId }),
          ...(patch.is_manual_placement !== undefined && {
            is_manual_placement: patch.is_manual_placement,
          }),
          ...(patch.metadata !== undefined && {
            metadata: applyMetadataPatch(existing.metadata, patch.metadata) as never,
          }),
        })
        .eq("id", id)
        .eq("user_id", this.uid)
        .select(ITEM_COLUMNS)
        .maybeSingle(),
    );
    return row ? toItem(row as unknown as ItemRow) : null;
  }

  async addTags(id: string, tags: string[]) {
    const existing = await this.getItem(id);
    if (!existing) return null;
    const merged = [...new Set([...existing.tags, ...tags])];
    const row = unwrap(
      await this.db
        .from("knowledge_items")
        .update({ tags: merged })
        .eq("id", id)
        .eq("user_id", this.uid)
        .select(ITEM_COLUMNS)
        .maybeSingle(),
    );
    await this.touchTags(tags.filter((t) => !existing.tags.includes(t)));
    return row ? toItem(row as unknown as ItemRow) : null;
  }

  // --- enrichment (organizer flag) --------------------------------------------------

  async getOrganizerContext(): Promise<OrganizerSnapshot> {
    const [tags, clusters, objects, folders] = await Promise.all([
      this.db
        .from("tags")
        .select("name")
        .eq("user_id", this.uid)
        .order("usage_count", { ascending: false })
        .limit(500),
      this.db
        .from("knowledge_items")
        .select("cluster_name")
        .eq("user_id", this.uid)
        .order("updated_at", { ascending: false })
        .limit(500),
      this.db
        .from("knowledge_items")
        .select("id,title,type")
        .eq("user_id", this.uid)
        .in("type", [...DOMAIN_OBJECT_TYPES])
        .limit(1000),
      this.db.from("folders").select("folder_path").eq("user_id", this.uid).limit(2000),
    ]);
    return {
      existingTags: (unwrap(tags) ?? []).map((t) => t.name),
      existingClusters: [
        ...new Set(
          (unwrap(clusters) ?? [])
            .map((r) => r.cluster_name)
            .filter((n): n is string => !!n && n !== "General"),
        ),
      ],
      existingObjects: (unwrap(objects) ?? []).map((o) => ({
        id: o.id,
        title: o.title,
        type: o.type as DomainObjectType,
      })),
      folderPaths: (unwrap(folders) ?? []).map((f) => f.folder_path),
    };
  }

  async applyEnrichment(id: string, patch: EnrichmentPatch) {
    const existing = await this.getItem(id);
    if (!existing) return null;
    const folderId =
      patch.folder_path !== undefined ? (await this.ensureFolderId(patch.folder_path)).id : undefined;
    const row = unwrap(
      await this.db
        .from("knowledge_items")
        .update({
          ...(patch.summary !== undefined && { summary: patch.summary }),
          ...(patch.tags !== undefined && { tags: [...new Set(patch.tags)] }),
          ...(patch.entities !== undefined && { entities: patch.entities }),
          ...(patch.cluster_name !== undefined && { cluster_name: patch.cluster_name }),
          ...(patch.folder_path !== undefined && { folder_path: patch.folder_path, folder_id: folderId }),
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.metadata !== undefined && {
            metadata: { ...existing.metadata, ...patch.metadata } as never,
          }),
        })
        .eq("id", id)
        .eq("user_id", this.uid)
        .select(ITEM_COLUMNS)
        .maybeSingle(),
    );
    if (patch.tags) await this.touchTags(patch.tags.filter((t) => !existing.tags.includes(t)));
    return row ? toItem(row as unknown as ItemRow) : null;
  }

  async replaceChunks(itemId: string, chunks: NewChunk[]): Promise<void> {
    unwrap(
      await this.db.from("item_chunks").delete().eq("user_id", this.uid).eq("item_id", itemId),
    );
    for (let i = 0; i < chunks.length; i += 100) {
      unwrap(
        await this.db.from("item_chunks").insert(
          chunks.slice(i, i + 100).map((c) => ({
            user_id: this.uid,
            item_id: itemId,
            chunk_index: c.chunk_index,
            chunk_heading: c.chunk_heading,
            page_or_timestamp: c.page_or_timestamp,
            chunk_text: c.chunk_text,
            embedding: c.embedding ? toPgVector(c.embedding) : null,
            metadata: (c.metadata ?? {}) as never,
          })),
        ),
      );
    }
  }

  /** Keeps the tag taxonomy table in step (usage counts feed the AI tagger's "reuse existing tags"). */
  private async touchTags(tags: string[]) {
    if (tags.length === 0) return;
    const existing = unwrap(
      await this.db
        .from("tags")
        .select("name,usage_count")
        .eq("user_id", this.uid)
        .in("name", tags),
    );
    const known = new Map((existing ?? []).map((t) => [t.name, t.usage_count ?? 0]));
    const fresh = tags.filter((t) => !known.has(t));
    if (fresh.length) {
      unwrap(
        await this.db.from("tags").upsert(
          fresh.map((name) => ({ user_id: this.uid, name, is_manual: false, usage_count: 1 })),
          { onConflict: "user_id,name", ignoreDuplicates: true },
        ),
      );
    }
    for (const [name, count] of known) {
      unwrap(
        await this.db
          .from("tags")
          .update({ usage_count: count + 1 })
          .eq("user_id", this.uid)
          .eq("name", name),
      );
    }
  }

  async ensureFolder(folderPath: string) {
    const { created } = await this.ensureFolderId(folderPath);
    return { folder_path: folderPath, created };
  }

  /** Creates the folder chain if needed and returns the leaf's id: items carry it as `folder_id`, like web and md-sync. */
  private async ensureFolderId(folderPath: string): Promise<{ id: string; created: boolean }> {
    let parentId: string | null = null;
    let created = false;
    for (const path of folderChain(folderPath)) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      let id = await this.findFolderId(path);
      created = false;
      if (!id) {
        const res: {
          data: { id: string } | null;
          error: { message: string; code?: string } | null;
        } = await this.db
          .from("folders")
          .insert({
            user_id: this.uid,
            parent_id: parentId,
            name,
            slug: slugify(name, "folder"),
            folder_path: path,
            is_system_default: false,
          })
          .select("id")
          .single();
        if (res.error?.code === "23505") {
          id = await this.findFolderId(path); // lost a race with md-sync / the web app
        } else {
          id = must(unwrap(res), "created folder").id;
          created = true;
        }
      }
      if (!id) throw new BrainError(`Could not create folder "${path}"`);
      parentId = id;
    }
    if (!parentId) throw new BrainError(`Invalid folder "${folderPath}"`);
    return { id: parentId, created };
  }

  private async findFolderId(path: string): Promise<string | null> {
    const row = unwrap(
      await this.db
        .from("folders")
        .select("id")
        .eq("user_id", this.uid)
        .eq("folder_path", path)
        .maybeSingle(),
    );
    return row?.id ?? null;
  }

  /** Folder rows plus item counts (non-archived), paged past PostgREST's 1,000-row limit. */
  async folderIndex() {
    const PAGE = 1000;
    const MAX_ROWS = 50_000;
    const counts = new Map<string, number>();
    const folders = unwrap(
      await this.db.from("folders").select("folder_path").eq("user_id", this.uid).limit(5000),
    );
    for (const f of folders ?? []) counts.set(f.folder_path, 0);
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const rows = unwrap(
        await this.db
          .from("knowledge_items")
          .select("folder_path")
          .eq("user_id", this.uid)
          .neq("status", "archived")
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1),
      );
      for (const r of rows ?? []) counts.set(r.folder_path, (counts.get(r.folder_path) ?? 0) + 1);
      if (!rows || rows.length < PAGE) break;
    }
    return [...counts].map(([folder_path, items]) => ({ folder_path, items }));
  }

  async listTasks({ includeDone, project_item_id, timeframe, exported }: TaskFilter) {
    let q = this.db.from("action_items").select(TASK_COLUMNS).eq("user_id", this.uid);
    q = includeDone ? q : q.in("status", ["open", "in_progress"]);
    if (project_item_id) q = q.eq("project_item_id", project_item_id);
    if (timeframe) q = q.eq("timeframe", timeframe);
    if (exported !== undefined)
      q = exported ? q.not("exported_at", "is", null) : q.is("exported_at", null);
    const rows = unwrap(
      await q
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
    );
    return (rows ?? []).map(toTask);
  }

  async createTask(input: NewTask) {
    // Dedup (@kortex/db): an open task with the same title (`matchKey`) is returned, not duplicated.
    const existing = await findOpenTaskByTitle(this.db, this.uid, input.title);
    if (existing) {
      const row = unwrap(
        await this.db
          .from("action_items")
          .select(TASK_COLUMNS)
          .eq("id", existing.id)
          .eq("user_id", this.uid)
          .single(),
      );
      return { task: toTask(must(row, "existing task")), duplicate: true };
    }
    const row = unwrap(
      await this.db
        .from("action_items")
        .insert({
          user_id: this.uid,
          title: input.title,
          priority: input.priority,
          due_date: input.due_date,
          timeframe: input.timeframe ?? null,
          context: input.context ?? null,
          project_item_id: input.project_item_id ?? null,
          assignee: "Me",
        })
        .select(TASK_COLUMNS)
        .single(),
    );
    return { task: toTask(must(row, "created task")), duplicate: false };
  }

  async updateTask(id: string, patch: TaskPatch) {
    const { exported, ...fields } = patch;
    const update = {
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
      ...(exported !== undefined && { exported_at: exported ? new Date().toISOString() : null }),
    };
    const row = unwrap(
      await this.db
        .from("action_items")
        .update(update)
        .eq("id", id)
        .eq("user_id", this.uid)
        .select(TASK_COLUMNS)
        .maybeSingle(),
    );
    return row ? toTask(row) : null;
  }

  async completeTask(id: string) {
    const existing = unwrap(
      await this.db
        .from("action_items")
        .select(TASK_COLUMNS)
        .eq("id", id)
        .eq("user_id", this.uid)
        .maybeSingle(),
    );
    if (!existing) return null;
    if (existing.status === "done") return toTask(existing);
    const row = unwrap(
      await this.db
        .from("action_items")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", this.uid)
        .select(TASK_COLUMNS)
        .single(),
    );
    return toTask(must(row, "completed task"));
  }
}
