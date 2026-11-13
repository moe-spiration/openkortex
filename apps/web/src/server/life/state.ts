import type { Json, KortexClient } from "@kortex/db";

/*
 * kortex.user_insights (migration 20261026010000): derived per-user state.
 *   life_vision / <area key>   { text }
 *   impulses    / ""           cached Insights recommendations (see server/insights/impulses.ts)
 * Always filtered by user_id on top of RLS.
 */

export type InsightKind = "life_vision" | "impulses" | "life_reflect" | "briefing";

export interface InsightRow {
  kind: string;
  key: string;
  payload: Record<string, unknown>;
  input_hash: string | null;
  updated_at: string;
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export async function readInsights(
  client: KortexClient,
  userId: string,
  kind: InsightKind,
): Promise<InsightRow[]> {
  const { data, error } = await client
    .from("user_insights")
    .select("kind,key,payload,input_hash,updated_at")
    .eq("user_id", userId)
    .eq("kind", kind);
  if (error) throw new Error(`load user_insights: ${error.message}`);
  return (data ?? []).map((r) => ({ ...r, payload: record(r.payload) }));
}

export async function writeInsight(
  client: KortexClient,
  userId: string,
  row: { kind: InsightKind; key: string; payload: Json; input_hash?: string | null },
): Promise<void> {
  const { error } = await client.from("user_insights").upsert(
    {
      user_id: userId,
      kind: row.kind,
      key: row.key,
      payload: row.payload,
      input_hash: row.input_hash ?? null,
    },
    { onConflict: "user_id,kind,key" },
  );
  if (error) throw new Error(`save user_insights: ${error.message}`);
}

export async function deleteInsight(
  client: KortexClient,
  userId: string,
  kind: InsightKind,
  key: string,
): Promise<void> {
  const { error } = await client
    .from("user_insights")
    .delete()
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("key", key);
  if (error) throw new Error(`delete user_insights: ${error.message}`);
}
