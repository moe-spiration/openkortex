import { embeddingModelKeyFor } from "@kortex/ai-core";
import {
  KNOWLEDGE_ITEM_TYPES,
  matchKnowledgeHybrid,
  matchKnowledgeHybridForUser,
  type HybridSearchParams,
  type HybridSearchResult,
  type KnowledgeItemType,
} from "@kortex/db";
import { z } from "zod";
import { json } from "../api-error";
import type { AuthContext } from "../auth";
import { queryEmbedding } from "../chat/retrieval";
import { enforceLimits } from "../limits";
import { getUserSettings } from "../repo";
import { preflight, route, type DepsProvider } from "../route";

// GET /api/search?q=&limit=&type=&content=1 — hybrid search (vector + full text, RRF) over the
// caller's vault for the desktop launcher (and anything else that needs a quick lookup).
//
// - q:       query text (websearch syntax). Empty → the most recently updated items (with `type`:
//            of that type, e.g. the prompt catalog `type=prompt`).
// - limit:   1..50, default 10.
// - type:    a registered item type (type-registry), optional.
// - content: `1` adds `content_md` (capped) to every result, e.g. for filling a prompt.
//
// Scope: a session or Supabase JWT searches as the user (RLS, the RPC uses auth.uid()); the owner
// token and personal `kx_` tokens with the `search` scope use the service-role variant with an
// explicit user id. Every other query is filtered by user_id as well.

export const SEARCH_MAX_LIMIT = 50;
/** content_md is capped per result so a long book does not bloat a launcher response. */
export const CONTENT_MAX_CHARS = 20_000;
const SNIPPET_CHARS = 280;
/** Shorter queries skip the embedding: full text finds them as well and it saves a model call. */
const MIN_SEMANTIC_CHARS = 3;

const flag = z
  .enum(["1", "0", "true", "false"])
  .optional()
  .transform((v) => v === "1" || v === "true");

export const SearchQuerySchema = z.object({
  q: z.string().trim().max(500).default(""),
  limit: z.coerce.number().int().min(1).max(SEARCH_MAX_LIMIT).default(10),
  type: z.enum(KNOWLEDGE_ITEM_TYPES).optional(),
  content: flag,
  /** `0` = full text only (no query embedding). */
  semantic: z
    .enum(["1", "0", "true", "false"])
    .optional()
    .transform((v) => v !== "0" && v !== "false"),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export interface SearchResult {
  item_id: string;
  title: string;
  type: string;
  folder_path: string | null;
  source_url: string | null;
  tags: string[];
  /** Best matching passage (or the summary), one line, max 280 characters. */
  snippet: string;
  /** "Page 12", "00:05:12" … when the best passage has a locator. */
  page_or_timestamp: string | null;
  /** RRF score; null for the recent listing. */
  score: number | null;
  /** Only with `content=1`. */
  content_md?: string;
}

export interface SearchResponse {
  ok: true;
  query: string;
  /** hybrid = vector + full text, text = full text only, recent = empty query listing. */
  mode: "hybrid" | "text" | "recent";
  results: SearchResult[];
}

/** One line of plain text from a passage: no Markdown noise, whitespace collapsed. */
export function snippetOf(text: string | null | undefined, max = SNIPPET_CHARS): string {
  const plain = (text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*\-+\s]+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** The RPC returns one row per item already; keep the first (best) row per item to be safe. */
function dedupe(rows: readonly HybridSearchResult[]): HybridSearchResult[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.item_id) ? false : (seen.add(r.item_id), true)));
}

async function hybrid(ctx: AuthContext, params: HybridSearchParams): Promise<HybridSearchResult[]> {
  // The public RPC scopes by auth.uid(): only a user session/JWT has one.
  return ctx.mode === "api_token"
    ? matchKnowledgeHybridForUser(ctx.client, ctx.userId, params)
    : matchKnowledgeHybrid(ctx.client, params);
}

interface ItemRow {
  id: string;
  title: string;
  type: string;
  folder_path: string | null;
  source_url: string | null;
  tags: string[] | null;
  summary: string | null;
  content_md?: string | null;
}

async function recent(ctx: AuthContext, q: SearchQuery): Promise<ItemRow[]> {
  const cols = "id,title,type,folder_path,source_url,tags,summary,content_md";
  let query = ctx.client.from("knowledge_items").select(cols).eq("user_id", ctx.userId);
  if (q.type) query = query.eq("type", q.type);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(q.limit);
  if (error) throw error;
  return (data ?? []) as ItemRow[];
}

/** content_md for the hits (one query, scoped to the user). */
async function contentOf(ctx: AuthContext, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await ctx.client
    .from("knowledge_items")
    .select("id,content_md")
    .eq("user_id", ctx.userId)
    .in("id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.id as string, (r.content_md as string | null) ?? ""]));
}

export async function searchVault(
  ctx: AuthContext,
  q: SearchQuery,
  embed: (query: string) => Promise<{ embedding: number[]; model: string | null } | null>,
): Promise<SearchResponse> {
  const cap = (s: string | null | undefined) => (s ?? "").slice(0, CONTENT_MAX_CHARS);
  if (!q.q) {
    const rows = await recent(ctx, q);
    return {
      ok: true,
      query: "",
      mode: "recent",
      results: rows.map((r) => ({
        item_id: r.id,
        title: r.title,
        type: r.type,
        folder_path: r.folder_path,
        source_url: r.source_url,
        tags: r.tags ?? [],
        snippet: snippetOf(r.summary || r.content_md),
        page_or_timestamp: null,
        score: null,
        ...(q.content ? { content_md: cap(r.content_md) } : {}),
      })),
    };
  }

  const vector = q.semantic && q.q.length >= MIN_SEMANTIC_CHARS ? await embed(q.q) : null;
  const rows = dedupe(
    await hybrid(ctx, {
      queryText: q.q,
      queryEmbedding: vector?.embedding ?? null,
      filterEmbeddingModel: vector?.model ?? null,
      matchCount: q.limit,
      filterType: q.type as KnowledgeItemType | undefined,
    }),
  ).slice(0, q.limit);
  const content = q.content
    ? await contentOf(
        ctx,
        rows.map((r) => r.item_id),
      )
    : null;
  return {
    ok: true,
    query: q.q,
    mode: vector ? "hybrid" : "text",
    results: rows.map((r) => ({
      item_id: r.item_id,
      title: r.title,
      type: r.type,
      folder_path: r.folder_path,
      source_url: r.source_url,
      tags: r.tags ?? [],
      snippet: snippetOf(r.chunk_text || r.summary),
      page_or_timestamp: r.page_or_timestamp,
      score: r.combined_score,
      ...(content ? { content_md: cap(content.get(r.item_id)) } : {}),
    })),
  };
}

export function createSearchHandlers(getDeps: DepsProvider) {
  return {
    GET: route(getDeps, async ({ request, auth, deps }) => {
      await enforceLimits({ auth, deps }, "search");
      const params = new URL(request.url).searchParams;
      const q = SearchQuerySchema.parse({
        q: params.get("q") ?? undefined,
        limit: params.get("limit") ?? undefined,
        type: params.get("type") || undefined,
        content: params.get("content") ?? undefined,
        semantic: params.get("semantic") ?? undefined,
      });
      const body = await searchVault(auth, q, async (text) => {
        // Same route and embedding lock as the copilot, so the vector side compares like with like.
        const settings = await getUserSettings(auth.client, auth.userId);
        const models = deps.createModels(settings, await deps.loadCatalog());
        const embedding = await queryEmbedding(models, text, deps.log);
        return embedding ? { embedding, model: embeddingModelKeyFor(models) } : null;
      });
      return json<SearchResponse>(body);
    }),
    OPTIONS: preflight(getDeps),
  };
}
