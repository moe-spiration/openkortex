import {
  findDuplicate,
  mergeInto,
  type DedupCandidate,
  type KortexClient,
} from "@kortex/db";

// S16: enrichment can resolve an IMDb id / ISBN only after the optimistic row was written. If the
// user already has that film or book, the new row is merged into it (central dedup.ts: adds, never
// overwrites) and removed, so the same imdb_id/isbn never exists twice.

interface PipelineRow {
  type: string;
  title: string;
  source_url?: string | null;
  source_platform?: string | null;
  content_md?: string | null;
  metadata?: unknown;
  tags?: readonly string[] | null;
}

/** Dedup candidate of a freshly enriched film/book; null when nothing was enriched. */
export function enrichedCandidate(row: PipelineRow, itemId: string): DedupCandidate | null {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const source = (meta.enrichment as { source?: unknown } | undefined)?.source;
  if ((row.type !== "movie" && row.type !== "book") || !source) return null;
  return {
    type: row.type,
    title: row.title,
    sourceUrl: row.source_url ?? null,
    contentMd: row.content_md ?? null,
    metadata: meta,
    tags: row.tags ?? [],
    platform: row.source_platform ?? "web",
    excludeId: itemId,
  };
}

/** Merges the item into an existing one with the same external id. Returns that item's id, or null. */
export async function mergeEnrichedDuplicate(
  c: KortexClient,
  userId: string,
  itemId: string,
  row: PipelineRow,
): Promise<string | null> {
  const candidate = enrichedCandidate(row, itemId);
  if (!candidate) return null;
  const hit = await findDuplicate(c, userId, candidate);
  if (!hit || hit.reason !== "external_id") return null;
  await mergeInto(c, userId, hit.item, candidate);
  const { error } = await c.from("knowledge_items").delete().eq("user_id", userId).eq("id", itemId);
  if (error) throw new Error(`delete merged duplicate: ${error.message}`);
  return hit.item.id;
}
