import { randomUUID } from "node:crypto";
import {
  contentHash,
  dedupKeys,
  DOMAIN_OBJECT_TYPES,
  findDuplicateIn,
  findOpenTaskIn,
  planMerge,
  snapTags,
  SYSTEM_FOLDER_PATHS,
  urlKey,
  type DedupItem,
  type DomainObjectType,
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
import { isUnread } from "./reading";
import {
  applyMetadataPatch,
  folderChain,
  isDue,
  isInFolder,
  metadataMatches,
  tagMatches,
} from "./util";

const tokenize = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Same fusion constant as `kortex.match_knowledge_hybrid`. */
const RRF_K = 60;

/**
 * In-process repository for tests and local experiments. Search is a weighted term match over
 * title/summary/body; with a query embedding and stored chunks it adds a vector side (best chunk
 * cosine per item) fused by Reciprocal Rank Fusion, like the hybrid RPC.
 */
export class InMemoryBrainRepository implements EnrichableRepository {
  readonly items = new Map<string, BrainItem>();
  readonly highlights: BrainHighlight[] = [];
  readonly tasks = new Map<string, BrainTask>();
  readonly folders = new Set<string>();
  /** item_chunks by item id. */
  readonly chunks = new Map<string, NewChunk[]>();
  /** knowledge_items.entities by item id (not part of BrainItem). */
  readonly entities = new Map<string, string[]>();
  /** Embeddings handed to `search`, so tests can assert the hybrid path was used. */
  readonly seenEmbeddings: (readonly number[] | null)[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {
    for (const path of SYSTEM_FOLDER_PATHS) this.folders.add(path);
  }

  private ts() {
    return this.now().toISOString();
  }

  async search(params: SearchParams): Promise<SearchHit[]> {
    this.seenEmbeddings.push(params.embedding);
    const terms = tokenize(params.query);
    const types = [...(params.type ? [params.type] : []), ...(params.types ?? [])];
    const candidates = [...this.items.values()].filter(
      (item) =>
        (types.length === 0 || types.includes(item.type)) &&
        metadataMatches(item.metadata, params.metadata) &&
        isDue(item.remind_at, params.remindDueBy) &&
        (!params.unreadAt || isUnread(item.metadata, item.remind_at, params.unreadAt)) &&
        (!params.folderPath || isInFolder(item.folder_path, params.folderPath)) &&
        !params.tags?.some((t) => !tagMatches(item.tags, t)),
    );
    const hit = (item: BrainItem, score: number, snippet?: string): SearchHit => ({
      item_id: item.id,
      title: item.title,
      type: item.type,
      summary: item.summary,
      snippet: snippet ?? item.content_md.slice(0, 300),
      folder_path: item.folder_path,
      tags: item.tags,
      source_url: item.source_url,
      metadata: item.metadata,
      remind_at: item.remind_at,
      score,
    });
    const byScore = <T extends { score: number; item: BrainItem }>(a: T, b: T) =>
      b.score - a.score || a.item.title.localeCompare(b.item.title);

    // No query: list the newest matching items (filter-only search, e.g. all books to read).
    if (terms.length === 0) {
      return [...candidates]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, params.limit)
        .map((item) => hit(item, 1));
    }

    const textRanked = candidates
      .map((item) => {
        const title = new Set(tokenize(item.title));
        const summary = new Set(tokenize(item.summary ?? ""));
        const body = new Set(tokenize(item.content_md));
        let score = 0;
        for (const term of terms) {
          score +=
            (title.has(term) ? 3 : 0) + (summary.has(term) ? 2 : 0) + (body.has(term) ? 1 : 0);
        }
        return { item, score };
      })
      .filter((r) => r.score > 0)
      .sort(byScore);

    const embedding = params.embedding;
    const vectorRanked = embedding
      ? candidates
          .flatMap((item) => {
            let best: { score: number; text: string } | null = null;
            for (const c of this.chunks.get(item.id) ?? []) {
              if (!c.embedding) continue;
              // Same rule as the RPC: only vectors of the query's embedding model.
              const model = (c.metadata as Record<string, unknown> | undefined)?.embedding_model;
              if (params.embeddingModel && model && model !== params.embeddingModel) continue;
              const score = cosine(embedding, c.embedding);
              if (!best || score > best.score) best = { score, text: c.chunk_text };
            }
            return best && best.score > 0 ? [{ item, score: best.score, text: best.text }] : [];
          })
          .sort(byScore)
      : [];

    // No vector side (no embedder or no chunks): plain term ranking, as before.
    if (vectorRanked.length === 0) {
      return textRanked.slice(0, params.limit).map((r) => hit(r.item, r.score));
    }
    const fused = new Map<string, { item: BrainItem; score: number; snippet?: string }>();
    textRanked.forEach((r, i) =>
      fused.set(r.item.id, { item: r.item, score: 1 / (RRF_K + i + 1) }),
    );
    vectorRanked.forEach((r, i) => {
      const prev = fused.get(r.item.id);
      fused.set(r.item.id, {
        item: r.item,
        score: (prev?.score ?? 0) + 1 / (RRF_K + i + 1),
        snippet: r.text,
      });
    });
    return [...fused.values()]
      .sort(byScore)
      .slice(0, params.limit)
      .map((r) => hit(r.item, r.score, r.snippet));
  }

  // --- enrichment ----------------------------------------------------------------

  async getOrganizerContext(): Promise<OrganizerSnapshot> {
    const items = [...this.items.values()];
    const usage = new Map<string, number>();
    for (const i of items) for (const t of i.tags) usage.set(t, (usage.get(t) ?? 0) + 1);
    return {
      existingTags: [...usage.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
      existingClusters: [
        ...new Set(items.map((i) => i.cluster_name).filter((c) => c && c !== "General")),
      ],
      existingObjects: items
        .filter((i) => (DOMAIN_OBJECT_TYPES as readonly string[]).includes(i.type))
        .map((i) => ({ id: i.id, title: i.title, type: i.type as DomainObjectType })),
      folderPaths: [...this.folders].sort(),
    };
  }

  async applyEnrichment(id: string, patch: EnrichmentPatch): Promise<BrainItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    if (patch.folder_path !== undefined) await this.ensureFolder(patch.folder_path);
    if (patch.entities) this.entities.set(id, [...patch.entities]);
    const next: BrainItem = {
      ...item,
      ...(patch.summary !== undefined && { summary: patch.summary }),
      ...(patch.tags !== undefined && { tags: [...new Set(patch.tags)] }),
      ...(patch.cluster_name !== undefined && { cluster_name: patch.cluster_name }),
      ...(patch.folder_path !== undefined && { folder_path: patch.folder_path }),
      ...(patch.status !== undefined && { status: patch.status }),
      metadata: { ...item.metadata, ...patch.metadata },
      updated_at: this.ts(),
    };
    this.items.set(id, next);
    return next;
  }

  async replaceChunks(itemId: string, chunks: NewChunk[]): Promise<void> {
    this.chunks.set(
      itemId,
      chunks.map((c) => ({ ...c })),
    );
  }

  /** Test helper: put an item from elsewhere (e.g. what md-sync stored) into this brain. */
  importItem(item: BrainItem, chunks: NewChunk[] = []): void {
    this.items.set(item.id, { ...item });
    for (const path of folderChain(item.folder_path)) this.folders.add(path);
    if (chunks.length)
      this.chunks.set(
        item.id,
        chunks.map((c) => ({ ...c })),
      );
  }

  async getItem(id: string) {
    return this.items.get(id) ?? null;
  }

  async findDailyNote(date: string) {
    return [...this.items.values()].find((i) => i.type === "daily_note" && i.slug === date) ?? null;
  }

  async getHighlights(itemId: string) {
    return this.highlights.filter((h) => h.item_id === itemId);
  }

  /** Test helper: highlights are created by the web clipper, not through MCP. */
  addHighlight(itemId: string, quote: string, note: string | null = null): BrainHighlight {
    const h: BrainHighlight = {
      id: randomUUID(),
      item_id: itemId,
      quote_text: quote,
      note_text: note,
      color: "yellow",
      locator: {},
      created_at: this.ts(),
    };
    this.highlights.push(h);
    return h;
  }

  async createItem(input: NewItem) {
    await this.ensureFolder(input.folder_path);
    const ts = this.ts();
    const item: BrainItem = {
      id: randomUUID(),
      type: input.type,
      title: input.title,
      slug: this.uniqueSlug(input.folder_path, input.slug),
      summary: null,
      content_md: input.content_md,
      source_url: input.source_url ?? null,
      source_platform: input.source_platform ?? "mcp",
      folder_path: input.folder_path,
      is_manual_placement: input.is_manual_placement ?? false,
      cluster_name: input.cluster_name ?? "General",
      tags: [...new Set(input.tags ?? [])],
      metadata: { ...input.metadata },
      status: "inbox",
      remind_at: input.remind_at ?? null,
      created_at: ts,
      updated_at: ts,
    };
    this.items.set(item.id, item);
    return item;
  }

  async saveItem(input: NewItem): Promise<SaveResult> {
    const known = [...new Set([...this.items.values()].flatMap((i) => i.tags))];
    const snapped = { ...input, tags: snapTags(input.tags ?? [], known) };
    const candidate = candidateOf(snapped);
    const keys = await dedupKeys(candidate);
    const rows: DedupItem[] = await Promise.all(
      [...this.items.values()].map(async (i) => ({
        ...i,
        folder_id: null,
        source_url_norm: urlKey(i.source_url),
        content_hash: await contentHash(i.content_md),
        metadata: i.metadata as DedupItem["metadata"],
      })),
    );
    const hit = findDuplicateIn(rows, candidate, keys);
    if (!hit) return { item: await this.createItem(snapped), duplicate: null };
    const patch = planMerge(hit.item, candidate, keys, this.now());
    const item = this.items.get(hit.item.id) as BrainItem;
    const next: BrainItem = {
      ...item,
      ...(patch.tags && { tags: patch.tags }),
      ...(patch.metadata && { metadata: patch.metadata }),
      ...(patch.content_md !== undefined && { content_md: patch.content_md }),
      ...(patch.source_url && { source_url: patch.source_url }),
      updated_at: this.ts(),
    };
    this.items.set(item.id, next);
    return { item: next, duplicate: { reason: hit.reason } };
  }

  private uniqueSlug(folderPath: string, slug: string) {
    const taken = new Set(
      [...this.items.values()].filter((i) => i.folder_path === folderPath).map((i) => i.slug),
    );
    let candidate = slug;
    for (let n = 2; taken.has(candidate); n++) candidate = `${slug}-${n}`;
    return candidate;
  }

  async updateItem(id: string, patch: ItemPatch) {
    const item = this.items.get(id);
    if (!item) return null;
    if (patch.folder_path !== undefined) await this.ensureFolder(patch.folder_path);
    const next: BrainItem = {
      ...item,
      ...(patch.type !== undefined && { type: patch.type }),
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.content_md !== undefined && { content_md: patch.content_md }),
      ...(patch.source_url !== undefined && { source_url: patch.source_url }),
      ...(patch.tags !== undefined && { tags: [...new Set(patch.tags)] }),
      ...(patch.remind_at !== undefined && { remind_at: patch.remind_at }),
      ...(patch.folder_path !== undefined && { folder_path: patch.folder_path }),
      ...(patch.is_manual_placement !== undefined && {
        is_manual_placement: patch.is_manual_placement,
      }),
      metadata: applyMetadataPatch(item.metadata, patch.metadata),
      updated_at: this.ts(),
    };
    this.items.set(id, next);
    return next;
  }

  async addTags(id: string, tags: string[]) {
    const item = this.items.get(id);
    if (!item) return null;
    const next = { ...item, tags: [...new Set([...item.tags, ...tags])], updated_at: this.ts() };
    this.items.set(id, next);
    return next;
  }

  async ensureFolder(folderPath: string) {
    const created = !this.folders.has(folderPath);
    for (const path of folderChain(folderPath)) this.folders.add(path);
    return { folder_path: folderPath, created };
  }

  async folderIndex() {
    const counts = new Map<string, number>([...this.folders].map((f) => [f, 0]));
    for (const item of this.items.values()) {
      if (item.status === "archived") continue;
      counts.set(item.folder_path, (counts.get(item.folder_path) ?? 0) + 1);
    }
    return [...counts].map(([folder_path, items]) => ({ folder_path, items }));
  }

  async listTasks({ includeDone, project_item_id, timeframe, exported }: TaskFilter) {
    const open = (t: BrainTask) => t.status === "open" || t.status === "in_progress";
    return [...this.tasks.values()]
      .filter((t) => includeDone || open(t))
      .filter((t) => !project_item_id || t.project_item_id === project_item_id)
      .filter((t) => !timeframe || t.timeframe === timeframe)
      .filter((t) => exported === undefined || (t.exported_at !== null) === exported)
      .sort(
        (a, b) =>
          (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
          a.created_at.localeCompare(b.created_at),
      );
  }

  async createTask(input: NewTask) {
    const existing = findOpenTaskIn(
      [...this.tasks.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      input.title,
    );
    if (existing) return { task: existing, duplicate: true };
    const task: BrainTask = {
      id: randomUUID(),
      title: input.title,
      status: "open",
      priority: input.priority,
      due_date: input.due_date,
      source_item_id: null,
      project_item_id: input.project_item_id ?? null,
      timeframe: input.timeframe ?? null,
      context: input.context ?? null,
      exported_at: null,
      external_ref: null,
      created_at: this.ts(),
      completed_at: null,
    };
    this.tasks.set(task.id, task);
    return { task, duplicate: false };
  }

  async updateTask(id: string, patch: TaskPatch) {
    const task = this.tasks.get(id);
    if (!task) return null;
    const { exported, ...fields } = patch;
    const next: BrainTask = {
      ...task,
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
      ...(exported !== undefined && { exported_at: exported ? this.ts() : null }),
    };
    this.tasks.set(id, next);
    return next;
  }

  async completeTask(id: string) {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (task.status === "done") return task;
    const done: BrainTask = { ...task, status: "done", completed_at: this.ts() };
    this.tasks.set(id, done);
    return done;
  }
}
