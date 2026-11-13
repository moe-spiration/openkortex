import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from "@supabase/supabase-js";
import type {
  DomainObjectMetadata,
  DomainObjectType,
  ItemStatus,
  KnowledgeItemType,
} from "./domain";
import type { Database } from "./types.gen";

export const KORTEX_SCHEMA = "kortex";

type KortexSchema = Database["kortex"];
type TableName = keyof KortexSchema["Tables"];

export type Row<T extends TableName> = KortexSchema["Tables"][T]["Row"];
export type Insert<T extends TableName> = KortexSchema["Tables"][T]["Insert"];
export type Update<T extends TableName> = KortexSchema["Tables"][T]["Update"];

export type KnowledgeItem = Omit<Row<"knowledge_items">, "type" | "status"> & {
  type: KnowledgeItemType;
  status: ItemStatus;
};
export type DomainObject<T extends DomainObjectType = DomainObjectType> = Omit<
  KnowledgeItem,
  "type" | "metadata"
> & { type: T; metadata: DomainObjectMetadata<T> };
export type Folder = Row<"folders">;
export type Tag = Row<"tags">;
export type ItemHighlight = Row<"item_highlights">;
export type ItemChunk = Row<"item_chunks">;
export type ActionItem = Row<"action_items">;
export type UserSettings = Row<"user_settings">;

export type KortexClient = SupabaseClient<Database, "kortex">;

/**
 * Typed Supabase client bound to the `kortex` schema.
 * Browser/app: pass the anon key (RLS applies to the signed-in user).
 * Server-side daemons: pass the service role key (bypasses RLS — always filter by user_id).
 */
export function createKortexClient(
  supabaseUrl: string,
  supabaseKey: string,
  options: Omit<SupabaseClientOptions<"kortex">, "db"> = {},
): KortexClient {
  return createClient<Database, "kortex">(supabaseUrl, supabaseKey, {
    ...options,
    db: { schema: KORTEX_SCHEMA },
  });
}

const unwrap = <T>({ data, error }: { data: T; error: unknown }): T => {
  if (error) throw error;
  return data;
};

/** Serialise an embedding for a pgvector column / RPC argument. */
export const toPgVector = (embedding: readonly number[]): string => `[${embedding.join(",")}]`;

/** Idempotently creates the caller's settings row and system default folders. Call on login. */
export async function bootstrapUser(client: KortexClient): Promise<void> {
  unwrap(await client.rpc("bootstrap_user"));
}

export interface HybridSearchParams {
  /** Full-text query (websearch syntax). Empty/null skips the FTS side. */
  queryText?: string | null;
  /** 1536-dim query embedding. Null skips the vector side. */
  queryEmbedding?: readonly number[] | null;
  matchCount?: number;
  filterType?: KnowledgeItemType;
  /** Folder plus all its sub-folders, e.g. "70_Objects". */
  filterFolderPath?: string;
  rrfK?: number;
  /**
   * Model key of `queryEmbedding` ("<provider>:<model_id>", see `embeddingModelKey`). When set,
   * the vector side only compares chunks embedded with that model. Always pass it with an embedding.
   */
  filterEmbeddingModel?: string | null;
}

export type HybridSearchResult =
  KortexSchema["Functions"]["match_knowledge_hybrid"]["Returns"][number];

const hybridArgs = (params: HybridSearchParams) => ({
  // The RPC accepts nulls for both inputs; generated arg types are non-null.
  query_text: (params.queryText ?? null) as string,
  query_embedding: (params.queryEmbedding ? toPgVector(params.queryEmbedding) : null) as string,
  match_count: params.matchCount,
  filter_type: params.filterType,
  filter_folder_path: params.filterFolderPath,
  rrf_k: params.rrfK,
  ...(params.queryEmbedding && params.filterEmbeddingModel
    ? { filter_embedding_model: params.filterEmbeddingModel }
    : {}),
});

/** Hybrid search (vector + weighted FTS, fused with Reciprocal Rank Fusion), as the signed-in user. */
export async function matchKnowledgeHybrid(
  client: KortexClient,
  params: HybridSearchParams,
): Promise<HybridSearchResult[]> {
  return unwrap(await client.rpc("match_knowledge_hybrid", hybridArgs(params))) ?? [];
}

/**
 * Same search for an explicit user. Service role only (md-sync, MCP server without a user JWT):
 * the RPC is not executable for `authenticated`.
 */
export async function matchKnowledgeHybridForUser(
  client: KortexClient,
  userId: string,
  params: HybridSearchParams,
): Promise<HybridSearchResult[]> {
  return (
    unwrap(
      await client.rpc("match_knowledge_hybrid_for_user", { p_user_id: userId, ...hybridArgs(params) }),
    ) ?? []
  );
}

export async function getItem(client: KortexClient, id: string): Promise<KnowledgeItem | null> {
  const data = unwrap(await client.from("knowledge_items").select("*").eq("id", id).maybeSingle());
  return data as KnowledgeItem | null;
}

export async function listFolders(client: KortexClient): Promise<Folder[]> {
  return (
    unwrap(await client.from("folders").select("*").order("folder_path", { ascending: true })) ?? []
  );
}

export async function getUserSettings(client: KortexClient): Promise<UserSettings | null> {
  return unwrap(await client.from("user_settings").select("*").maybeSingle());
}
