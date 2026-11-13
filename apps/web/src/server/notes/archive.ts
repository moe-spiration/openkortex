import { isDomainObjectType, type KortexClient } from "@kortex/db";
import type { KnowledgeItem } from "@/lib/mock/types";
import { toKnowledgeItem, type ItemRow } from "@/lib/supabase/mapping";
import { ITEM_COLUMNS } from "@/lib/supabase/snapshot";

/*
 * G4 (feedback round 3): the Archiv category. The workspace snapshot leaves archived items out (status `archived`
 * hides them everywhere), so the archive page loads them on its own. Runs as the signed-in user (RLS) and filters
 * by user_id. Newest archive first (updated_at moves when setArchived writes the status).
 */

export const ARCHIVE_LIMIT = 500;

export interface ArchivedItems {
  notes: KnowledgeItem[];
  objects: KnowledgeItem[];
}

export async function loadArchivedItems(client: KortexClient, userId: string, timeZone: string, limit = ARCHIVE_LIMIT): Promise<ArchivedItems> {
  const { data, error } = await client
    .from("knowledge_items")
    .select(ITEM_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`kortex archive: ${error.message}`);
  const rows = (data ?? []) as unknown as ItemRow[];
  const ctx = {
    timeZone,
    idByTitle: new Map(rows.map((r) => [r.title.toLowerCase(), r.id])),
    ids: new Set(rows.map((r) => r.id)),
    actionsBySource: new Map(),
  };
  const out: ArchivedItems = { notes: [], objects: [] };
  for (const r of rows) (isDomainObjectType(r.type) ? out.objects : out.notes).push(toKnowledgeItem(r, ctx));
  return out;
}
