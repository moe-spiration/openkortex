import { createClient } from "@supabase/supabase-js";

/* Service-role client for the e2e user lifecycle and DB assertions. Never log its config. */

export const TABLES_WITH_USER = [
  "folders",
  "tags",
  "knowledge_items",
  "item_highlights",
  "item_chunks",
  "action_items",
  "user_settings",
  "user_insights",
  "sync_status",
  "ai_usage",
  "allowed_users",
] as const;

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`e2e: ${name} is not set (apps/web/.env.local or the repo root .env.local)`);
  return v;
}

export function adminClient() {
  return createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "kortex" },
  });
}

export interface E2EUser {
  id: string;
  email: string;
  password: string;
  /** Dedicated staging account (live run): never deleted, only the rows created since `since`. */
  staging?: boolean;
  /** ISO time the run started (live cleanup boundary). */
  since?: string;
}

export async function countRows(userId: string, table: string): Promise<number> {
  const { count, error } = await adminClient()
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

/**
 * Tables whose rows a live run (dedicated staging account) creates and must remove again, in
 * delete order. Chunks and highlights cascade with their knowledge item.
 */
export const LIVE_CLEANUP_TABLES = [
  "knowledge_items",
  "action_items",
  "ingest_jobs",
  "tags",
  "folders",
  "user_insights",
  "api_tokens",
  "ai_usage",
] as const;

/** Deletes every row of `userId` created at or after `since` in LIVE_CLEANUP_TABLES. */
export async function deleteCreatedSince(
  userId: string,
  since: string,
  tables: readonly string[] = LIVE_CLEANUP_TABLES,
): Promise<void> {
  const admin = adminClient();
  for (const table of tables) {
    const { error } = await admin.from(table).delete().eq("user_id", userId).gte("created_at", since);
    if (error) throw new Error(`e2e cleanup ${table}: ${error.message}`);
  }
}

/** Rows of `userId` created at or after `since` that are still there (table=count). */
export async function leftSince(userId: string, since: string): Promise<string[]> {
  const left: string[] = [];
  for (const table of LIVE_CLEANUP_TABLES) {
    const { count, error } = await adminClient()
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);
    if (error) throw new Error(`count ${table}: ${error.message}`);
    if (count) left.push(`${table}=${count}`);
  }
  return left;
}
