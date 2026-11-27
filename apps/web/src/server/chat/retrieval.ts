import { t } from "@/i18n";
import { embed } from "ai";
import { embeddingModelKeyFor, type ModelRouter } from "@kortex/ai-core";
import {
  matchKnowledgeHybrid,
  matchKnowledgeHybridForUser,
  type HybridSearchParams,
  type HybridSearchResult,
} from "@kortex/db";
import { ApiError, notFound } from "../api-error";
import type { AuthContext } from "../auth";
import type { Logger } from "../deps";
import { getItem } from "../repo";
import { LINKED_MAX_ITEMS, extractLinkedTitles } from "../../lib/shell/linked-context";
import type { ChatRequest } from "./contract";
import { parseTypedFilter, type TypedFilter } from "./typed-filter";

/** A retrieved passage before numbering. */
export interface ContextSource {
  item_id: string;
  title: string;
  type: string;
  page_or_timestamp: string | null;
  folder_path: string | null;
  source_url: string | null;
  text: string;
}

/** Whole notes up to this size go to the model as-is in note mode. */
const WHOLE_NOTE_CHARS = 20_000;
const PASSAGE_CHARS = 2_500;

const terms = (s: string) => [
  ...new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2),
  ),
];

/** Filler of spoken and typed questions; never a useful full-text term. */
const STOPWORDS = new Set(
  (
    "aber alle allem allen aller alles also auch auf aus bei beim bin bis bist dann das dass dem den der des dich die dies diese diesem diesen dieser dieses dir doch dort durch ein eine einem einen einer eines etwas euch für gab gibt hab habe haben hast hat hatte hätte hier ihr ihre ich ihm ihn im in ist jetzt kann kannst kein keine mal man mehr mein meine meinem meinen meiner mich mir mit muss nach nicht noch nun nur oder ohne schon sehr sein seine sich sie sind soll sollte über um und uns unser vom von vor war waren was weil welche welcher welches wenn wer werde werden wie wieder will wir wird wo zu zum zur zwischen bitte sag sage sagen zeig zeige zeigen erzähl erzähle gerne einfach eigentlich ähm äh okay hey kortex " +
    "the and are was were you your yours what which who whom this that these those have has had can could would should will with from for about into over please tell show give find did does doing been being there their them they then than just some any all also"
  ).split(" "),
);

/**
 * The full-text side of a hybrid search. websearch_to_tsquery joins every word with AND, so a
 * spoken or chatty question ("kannst du mir sagen, was ich über Hyrox notiert habe") finds
 * nothing at all. A sentence (five words or more) is cut to its content words, joined with OR;
 * ts_rank_cd still puts entries with more of them first. Short keyword queries stay as typed.
 */
export function ftsQueryOf(query: string): string {
  const q = query.trim();
  if (q.split(/\s+/).length < 5 || /["]|\bor\b|\s-\S/i.test(q)) return q;
  const words = terms(q).filter((w) => !STOPWORDS.has(w));
  return words.length ? words.slice(0, 12).join(" or ") : q;
}

/** Cheap lexical relevance for ranking a note's own chunks. */
export function overlapScore(query: string, text: string): number {
  const hay = text.toLowerCase();
  return terms(query).reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
}

export async function queryEmbedding(
  models: ModelRouter,
  query: string,
  log: Logger,
): Promise<number[] | null> {
  try {
    const { embedding } = await embed({ model: models.embedding(), value: query });
    return embedding;
  } catch (err) {
    // Full-text search alone still works; better a weaker answer than none.
    log.error("query embedding failed, falling back to full-text search", err);
    return null;
  }
}

const fromHybrid = (r: HybridSearchResult): ContextSource => ({
  item_id: r.item_id,
  title: r.title,
  type: r.type,
  page_or_timestamp: r.page_or_timestamp,
  folder_path: r.folder_path,
  source_url: r.source_url,
  text: (r.chunk_text || r.summary || "").slice(0, PASSAGE_CHARS),
});

/** Ghost context (note mode): linked items go along as background, within a small budget. */
export const LINKED_CHARS_EACH = 1_500;
export const LINKED_CHARS_TOTAL = 6_000;
const LINKED_CANDIDATES = 25;

interface LinkedRow {
  id: string;
  title: string;
  type: string;
  summary: string | null;
  content_md: string;
  folder_path: string | null;
  source_url: string | null;
}

/** Ranks linked items by relevance to the question (document order breaks ties) and cuts them to the budget. */
export function pickLinkedSources(rows: readonly LinkedRow[], order: readonly string[], query: string): ContextSource[] {
  const pos = (t: string) => {
    const i = order.findIndex((o) => o.toLowerCase() === t.toLowerCase());
    return i < 0 ? order.length : i;
  };
  const ranked = rows
    .map((r) => ({ r, score: overlapScore(query, `${r.title} ${r.summary ?? ""} ${r.content_md.slice(0, 2_000)}`) }))
    .sort((a, b) => b.score - a.score || pos(a.r.title) - pos(b.r.title))
    .slice(0, LINKED_MAX_ITEMS);
  const out: ContextSource[] = [];
  let budget = LINKED_CHARS_TOTAL;
  for (const { r } of ranked) {
    if (budget <= 0) break;
    const body = ((r.summary ? `${r.summary}\n\n` : "") + r.content_md).trim();
    const text = `${t("[Linked from the open note]")} ${body}`.slice(0, Math.min(LINKED_CHARS_EACH, budget));
    budget -= text.length;
    out.push({
      item_id: r.id,
      title: r.title,
      type: r.type,
      page_or_timestamp: null,
      folder_path: r.folder_path,
      source_url: r.source_url,
      text,
    });
  }
  return out;
}

async function linkedSources(
  ctx: AuthContext,
  itemId: string,
  contentMd: string,
  query: string,
): Promise<ContextSource[]> {
  const titles = extractLinkedTitles(contentMd).slice(0, LINKED_CANDIDATES);
  if (!titles.length) return [];
  const { data, error } = await ctx.client
    .from("knowledge_items")
    .select("id,title,type,summary,content_md,folder_path,source_url")
    .eq("user_id", ctx.userId)
    .in("title", titles)
    .neq("id", itemId)
    .limit(LINKED_CANDIDATES * 2);
  // Background only: a failed lookup must never break the answer.
  if (error || !data?.length) return [];
  return pickLinkedSources(data as LinkedRow[], titles, query);
}

async function noteSources(
  ctx: AuthContext,
  itemId: string,
  query: string,
  limit: number,
): Promise<ContextSource[]> {
  const item = await getItem(ctx.client, ctx.userId, itemId, [
    "id",
    "title",
    "type",
    "content_md",
    "summary",
    "folder_path",
    "source_url",
  ]);
  if (!item) throw notFound(t("Note not found"));
  const base = {
    item_id: item.id,
    title: item.title,
    type: item.type,
    folder_path: item.folder_path,
    source_url: item.source_url,
  };
  const linked = await linkedSources(ctx, item.id, item.content_md, query);
  if (item.content_md.length <= WHOLE_NOTE_CHARS) {
    return [{ ...base, page_or_timestamp: null, text: item.content_md || item.summary || "" }, ...linked];
  }
  // Long documents (books, PDFs): pick the most relevant chunks so citations keep page/time.
  const { data, error } = await ctx.client
    .from("item_chunks")
    .select("chunk_index,chunk_heading,page_or_timestamp,chunk_text")
    .eq("user_id", ctx.userId)
    .eq("item_id", itemId)
    .order("chunk_index", { ascending: true })
    .limit(2000);
  if (error || !data?.length) {
    return [{ ...base, page_or_timestamp: null, text: item.content_md.slice(0, WHOLE_NOTE_CHARS) }, ...linked];
  }
  const own = data
    .map((c) => ({ c, score: overlapScore(query, `${c.chunk_heading ?? ""} ${c.chunk_text}`) }))
    .sort((a, b) => b.score - a.score || a.c.chunk_index - b.c.chunk_index)
    .slice(0, limit)
    .sort((a, b) => a.c.chunk_index - b.c.chunk_index)
    .map(({ c }) => ({
      ...base,
      page_or_timestamp: c.page_or_timestamp,
      text: c.chunk_text.slice(0, PASSAGE_CHARS),
    }));
  return [...own, ...linked];
}

async function clusterFallback(
  ctx: AuthContext,
  cluster: string,
  limit: number,
): Promise<ContextSource[]> {
  const { data, error } = await ctx.client
    .from("knowledge_items")
    .select("id,title,type,summary,content_md,folder_path,source_url")
    .eq("user_id", ctx.userId)
    .eq("cluster_name", cluster)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((r) => ({
    item_id: r.id,
    title: r.title,
    type: r.type,
    page_or_timestamp: null,
    folder_path: r.folder_path,
    source_url: r.source_url,
    text: (r.summary ? `${r.summary}\n\n` : "") + r.content_md.slice(0, PASSAGE_CHARS),
  }));
}

/**
 * Type + status question ("welche Filme will ich sehen"): the items themselves, newest first,
 * same filter as brain_search (type, metadata.status). Empty/failed: the caller falls back to hybrid.
 */
export async function filteredSources(
  ctx: AuthContext,
  filter: TypedFilter,
  limit: number,
): Promise<ContextSource[]> {
  let q = ctx.client
    .from("knowledge_items")
    .select("id,title,type,summary,content_md,folder_path,source_url,metadata")
    .eq("user_id", ctx.userId)
    .eq("type", filter.type)
    .neq("status", "archived");
  if (filter.status) q = q.contains("metadata", { status: filter.status } as never);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(Math.max(limit, 20));
  if (error || !data?.length) return [];
  return data.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const facts = Object.entries(meta)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .slice(0, 8)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");
    return {
      item_id: r.id,
      title: r.title,
      type: r.type,
      page_or_timestamp: null,
      folder_path: r.folder_path,
      source_url: r.source_url,
      text: [facts, r.summary ?? r.content_md.slice(0, 400)].filter(Boolean).join("\n").slice(0, PASSAGE_CHARS),
    };
  });
}

/** Retrieves context for the three copilot modes. */
export async function retrieveSources(
  ctx: AuthContext,
  req: ChatRequest,
  query: string,
  models: ModelRouter,
  log: Logger,
): Promise<ContextSource[]> {
  if (req.mode === "note") return noteSources(ctx, req.item_id as string, query, req.match_count);

  if (req.mode === "brain") {
    // "Welche Filme will ich sehen": a filter (type + metadata.status), not a similarity search.
    const filter = parseTypedFilter(query);
    if (filter) {
      const hits = await filteredSources(ctx, filter, req.match_count);
      if (hits.length) return hits;
    }
  }

  const embedding = await queryEmbedding(models, query, log);
  // The vector side only compares chunks of the query's model (the user's embedding lock).
  const filterEmbeddingModel = embedding ? embeddingModelKeyFor(models) : null;
  const search = (params: HybridSearchParams) => hybridForCaller(ctx, params);

  if (req.mode === "folder" && req.cluster && !req.folder_path) {
    // The RPC has no cluster filter: over-fetch and filter, then fall back to recent cluster items.
    const rows = await search({
      queryText: ftsQueryOf(query),
      queryEmbedding: embedding,
      matchCount: 50,
      filterEmbeddingModel,
    });
    const hits = rows
      .filter((r) => r.cluster_name === req.cluster)
      .slice(0, req.match_count)
      .map(fromHybrid);
    return hits.length > 0 ? hits : clusterFallback(ctx, req.cluster, req.match_count);
  }

  const rows = await search({
    queryText: ftsQueryOf(query),
    queryEmbedding: embedding,
    matchCount: req.match_count,
    filterFolderPath: req.mode === "folder" ? req.folder_path : undefined,
    filterEmbeddingModel,
  });
  return rows.map(fromHybrid);
}

/**
 * Hybrid search as the caller. Sessions and JWTs use `match_knowledge_hybrid` (RLS, auth.uid()).
 * API tokens run on the service role, where auth.uid() is empty: the per-user RPC with the token's
 * user_id, and every hit is checked against the owner's items again, so a wrong or missing filter
 * in the RPC can never leak another user's passages into an answer.
 */
async function hybridForCaller(ctx: AuthContext, params: HybridSearchParams): Promise<HybridSearchResult[]> {
  if (ctx.mode !== "api_token") return matchKnowledgeHybrid(ctx.client, params);
  const rows = await matchKnowledgeHybridForUser(ctx.client, ctx.userId, params);
  const ids = [...new Set(rows.map((r) => r.item_id))];
  if (!ids.length) return [];
  const { data, error } = await ctx.client
    .from("knowledge_items")
    .select("id")
    .eq("user_id", ctx.userId)
    .in("id", ids);
  if (error) throw new ApiError("server_error", `check sources: ${error.message}`);
  const own = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
  return rows.filter((r) => own.has(r.item_id));
}
