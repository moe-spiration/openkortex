import type { KortexClient } from "@kortex/db";
import { uiType } from "@/lib/supabase/mapping";
import { MOCK_TODAY, NOTES, OBJECT_ITEMS } from "@/lib/workspace-data";
import { buildGraph, type ExtraEdges, type ItemLite } from "@/server/graph/build";
import { createTtlCache, fingerprint } from "@/server/graph/cache";
import { layoutGraph } from "@/server/graph/layout";
import { graphQueryString } from "@/server/graph/query";
import { GRAPH_LIMIT_MAX, type GraphData, type GraphQuery, type SemanticState } from "@/server/graph/types";

/*
 * Data access of the knowledge graph. Everything heavy happens here, on the server:
 * - light item columns only (no bodies), paged, at most GRAPH_LIMIT_MAX rows;
 * - [[wiki-links]] and semantic neighbours come from SQL functions (graph_wiki_edges,
 *   graph_semantic_edges), never from client-side N+1 requests;
 * - the vault-wide parts (rows, wiki edges, semantic edges) are cached per vault fingerprint, the
 *   finished graph (filters, cap, layout) per query.
 */

const PAGE = 1000;
const ITEM_COLUMNS = "id,title,type,tags,entities,related_item_ids,updated_at" as const;
const SEMANTIC = { k: 3, minSimilarity: 0.75, itemLimit: 2000 } as const;

interface Vault {
  items: ItemLite[];
  total: number;
  wiki: [string, string][];
  /** Computed on first use. */
  semantic?: Promise<{ pairs: ExtraEdges["semantic"]; state: SemanticState }>;
}

const vaults = createTtlCache<Vault>(8);
const graphs = createTtlCache<GraphData>(32);

/** Ideal edge length: small graphs get room for label pills, big ones stay compact. */
const edgeLength = (nodes: number): number => (nodes <= 40 ? 150 : nodes <= 150 ? 80 : 46);

const fail = (what: string, e: { message: string }): never => {
  throw new Error(`graph: ${what}: ${e.message}`);
};

/** Vault fingerprint (count + newest change) in one request. */
async function vaultFingerprint(client: KortexClient, userId: string): Promise<string> {
  const { data, count, error } = await client
    .from("knowledge_items")
    .select("updated_at", { count: "exact" })
    .eq("user_id", userId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) fail("fingerprint", error);
  return fingerprint(count, data?.[0]?.updated_at ?? null);
}

async function loadItems(client: KortexClient, userId: string): Promise<ItemLite[]> {
  const items: ItemLite[] = [];
  for (let from = 0; from < GRAPH_LIMIT_MAX; from += PAGE) {
    const to = Math.min(from + PAGE, GRAPH_LIMIT_MAX) - 1;
    const { data, error } = await client
      .from("knowledge_items")
      .select(ITEM_COLUMNS)
      .eq("user_id", userId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) fail("items", error);
    for (const r of data ?? [])
      items.push({
        id: r.id,
        title: r.title,
        type: uiType(r.type),
        tags: r.tags ?? [],
        entities: r.entities ?? [],
        related: r.related_item_ids ?? [],
        updatedAt: r.updated_at,
      });
    if ((data?.length ?? 0) < to - from + 1) break;
  }
  return items;
}

async function loadWiki(client: KortexClient, userId: string): Promise<[string, string][]> {
  const pairs: [string, string][] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.rpc("graph_wiki_edges", { p_user_id: userId, p_item_limit: GRAPH_LIMIT_MAX }).range(from, from + PAGE - 1);
    if (error) fail("wiki edges", error);
    for (const r of data ?? []) pairs.push([r.source_id, r.target_id]);
    if ((data?.length ?? 0) < PAGE) break;
  }
  return pairs;
}

async function loadSemantic(client: KortexClient, userId: string): Promise<{ pairs: ExtraEdges["semantic"]; state: SemanticState }> {
  try {
    const lock = await client.from("user_settings").select("embedding_lock").eq("user_id", userId).maybeSingle();
    const l = lock.data?.embedding_lock as { provider?: string; model_id?: string } | null | undefined;
    const model = l?.provider && l.model_id ? `${l.provider}:${l.model_id}` : undefined;
    const pairs: ExtraEdges["semantic"] = [];
    for (let from = 0; from < 20000; from += PAGE) {
      const { data, error } = await client
        .rpc("graph_semantic_edges", {
          p_user_id: userId,
          p_k: SEMANTIC.k,
          p_min_similarity: SEMANTIC.minSimilarity,
          p_item_limit: SEMANTIC.itemLimit,
          p_embedding_model: model,
        })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) pairs.push({ a: r.item_a, b: r.item_b, sim: r.similarity });
      if ((data?.length ?? 0) < PAGE) break;
    }
    return { pairs, state: pairs.length ? "ok" : "empty" };
  } catch (e) {
    console.error("[kortex] graph semantic edges failed:", e instanceof Error ? e.message : e);
    return { pairs: [], state: "error" };
  }
}

/** The signed-in user's graph (`client` is bound to their session, RLS applies; user_id is filtered anyway). */
export async function loadGraph(client: KortexClient, userId: string, query: GraphQuery): Promise<GraphData> {
  const fp = await vaultFingerprint(client, userId);
  const vaultKey = `${userId}|${fp}`;
  const graphKey = `${vaultKey}|${graphQueryString(query)}`;
  const hit = graphs.get(graphKey);
  if (hit) return hit;

  let vault = vaults.get(vaultKey);
  if (!vault) {
    const [items, wiki] = await Promise.all([loadItems(client, userId), loadWiki(client, userId)]);
    vault = { items, total: items.length, wiki };
    vaults.set(vaultKey, vault);
  }
  let semantic: { pairs: ExtraEdges["semantic"]; state: SemanticState } = { pairs: [], state: "off" };
  if (query.semantic) {
    vault.semantic ??= loadSemantic(client, userId);
    semantic = await vault.semantic;
    if (semantic.state === "error") vault.semantic = undefined; // retry on the next request
  }

  const data = buildGraph(vault.items, { wiki: vault.wiki, semantic: semantic.pairs }, query, { semantic: semantic.state, total: vault.total });
  layoutGraph(data, { length: edgeLength(data.nodes.length) });
  if (semantic.state !== "error") graphs.set(graphKey, data);
  return data;
}

/** Test hook: forget everything cached. */
export function clearGraphCache(): void {
  vaults.clear();
  graphs.clear();
}

// --- mock mode ---------------------------------------------------------------------------------

const mockGraphs = createTtlCache<GraphData>(16, 60 * 60_000);

/** Graph of the prototype data (`KORTEX_DATA_SOURCE=mock`): links and tags of the mock notes and objects. */
export function mockGraph(query: GraphQuery): GraphData {
  const key = graphQueryString(query);
  const hit = mockGraphs.get(key);
  if (hit) return hit;
  const items: ItemLite[] = [...NOTES, ...OBJECT_ITEMS].map((n) => ({
    id: n.id,
    title: n.title,
    type: n.type,
    tags: n.tags,
    entities: [],
    related: n.links,
    updatedAt: `${n.date}T${n.time}:00.000Z`,
  }));
  // No embeddings in the mock: unlinked items that share two tags count as "semantically close".
  const linked = new Set(items.flatMap((i) => i.related.map((r) => (i.id < r ? `${i.id}|${r}` : `${r}|${i.id}`))));
  const semantic: ExtraEdges["semantic"] = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      const shared = a.tags.filter((t) => b.tags.includes(t)).length;
      if (shared >= 2 && !linked.has(a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`)) semantic.push({ a: a.id, b: b.id, sim: 0.7 + 0.04 * shared });
    }
  const data = buildGraph(items, { wiki: [], semantic: query.semantic ? semantic : [] }, query, { now: new Date(`${MOCK_TODAY}T12:00:00Z`), semantic: query.semantic ? "ok" : "off" });
  layoutGraph(data, { length: edgeLength(data.nodes.length) });
  mockGraphs.set(key, data);
  return data;
}

const BENCH_TYPES: ItemLite["type"][] = ["note", "note", "meeting", "article", "book", "video", "ai", "project", "person", "concept"];
const BENCH_DOMAINS = ["ai", "automotive", "health", "food", "finance", "strategy"];
const BENCH_WORDS = ["Pricing", "Retention", "Sync", "Onboarding", "Roadmap", "Hyrox", "Vault", "Embeddings", "Coaching", "Architektur", "Quartal", "Freemium", "Kunde", "Rezept", "Investment"];

/**
 * Synthetic vault of `n` items for performance checks (A-14: pan / zoom with 500 nodes), mock mode
 * only (`/graph?bench=500`). Deterministic: a few hubs with many links, tags per theme, titles of
 * mixed length (also over the 28-character label limit).
 */
export function benchGraph(n: number): GraphData {
  const count = Math.max(10, Math.min(GRAPH_LIMIT_MAX, Math.floor(n)));
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const id = (i: number) => `bench-${i}`;
  const items: ItemLite[] = Array.from({ length: count }, (_, i) => {
    const domain = BENCH_DOMAINS[i % BENCH_DOMAINS.length]!;
    const words = Array.from({ length: 1 + (i % 5) }, (_, k) => BENCH_WORDS[(i * 7 + k * 3) % BENCH_WORDS.length]);
    const related = new Set<string>();
    if (i > 0) related.add(id(Math.floor(rnd() * Math.min(i, 24)))); // hubs: the first items
    if (i > 2 && rnd() < 0.6) related.add(id(Math.floor(rnd() * i)));
    return {
      id: id(i),
      title: `${words.join(" ")} ${i}`,
      type: BENCH_TYPES[i % BENCH_TYPES.length]!,
      tags: [`${domain}/thema-${i % 9}`],
      entities: [],
      related: [...related],
      updatedAt: new Date(Date.parse(`${MOCK_TODAY}T12:00:00Z`) - Math.floor(rnd() * 120) * 864e5).toISOString(),
    };
  });
  const query: GraphQuery = { types: null, domains: null, sinceDays: null, semantic: false, limit: count };
  const data = buildGraph(items, { wiki: [], semantic: [] }, query, { now: new Date(`${MOCK_TODAY}T12:00:00Z`), semantic: "off" });
  layoutGraph(data, { length: edgeLength(data.nodes.length) });
  return data;
}
