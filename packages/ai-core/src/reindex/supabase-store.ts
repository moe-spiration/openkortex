import { embeddingModelKey, getEmbeddingLock, type KortexClient } from "@kortex/db";
import type { ItemChunkInsert } from "../pipeline/ingest";
import type { ChunkRef, ReindexItem, ReindexStore } from "./reindex";

const PAGE = 500;
const ITEM_COLUMNS =
  "id,type,title,content_md,entities,related_item_ids,metadata,status,source_url,is_manual_placement,folder_path" as const;

async function paged<T>(
  load: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await load(from, from + PAGE - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Re-index store over Supabase (service role or the user's session); every query filters by user. */
export function createSupabaseReindexStore(client: KortexClient, userId: string): ReindexStore {
  return {
    listItems: () =>
      paged<ReindexItem>(
        (a, b) =>
          client
            .from("knowledge_items")
            .select(ITEM_COLUMNS)
            .eq("user_id", userId)
            .order("id")
            .range(a, b),
        "load knowledge_items",
      ),
    listChunks: () =>
      paged<ChunkRef>(
        (a, b) =>
          client
            .from("item_chunks")
            .select("id,item_id,chunk_text,metadata")
            .eq("user_id", userId)
            .order("id")
            .range(a, b),
        "load item_chunks",
      ),
    async embeddingKey() {
      const lock = await getEmbeddingLock(client, userId);
      return lock ? embeddingModelKey(lock) : null;
    },
    async folderId(path) {
      const { data, error } = await client
        .from("folders")
        .select("id")
        .eq("user_id", userId)
        .eq("folder_path", path)
        .limit(1);
      if (error) throw new Error(`folder ${path}: ${error.message}`);
      return (data as { id: string }[] | null)?.[0]?.id ?? null;
    },
    async updateItem(id, patch) {
      const { error } = await client
        .from("knowledge_items")
        .update(patch as never)
        .eq("user_id", userId)
        .eq("id", id);
      if (error) throw new Error(`update ${id}: ${error.message}`);
    },
    async saveVectors(rows) {
      for (const r of rows) {
        const { error } = await client
          .from("item_chunks")
          .update({ embedding: r.embedding, metadata: r.metadata } as never)
          .eq("user_id", userId)
          .eq("id", r.id);
        if (error) throw new Error(`save chunk ${r.id}: ${error.message}`);
      }
    },
    async insertChunks(rows: ItemChunkInsert[]) {
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await client.from("item_chunks").insert(rows.slice(i, i + 100));
        if (error) throw new Error(`insert chunks: ${error.message}`);
      }
    },
  };
}
