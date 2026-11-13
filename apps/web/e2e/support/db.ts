import { expect } from "@playwright/test";
import { adminClient } from "./admin";

/* DB-side assertions for the flows (service role, scoped to the temp user). */

export interface ItemRow {
  id: string;
  title: string;
  type: string;
  status: string;
  folder_path: string;
  content_md: string;
  summary: string | null;
  source_url: string | null;
}

const COLUMNS = "id,title,type,status,folder_path,content_md,summary,source_url";

/** Polls until an item of the user matches `filter` (a PostgREST `ilike` on content_md or title). */
export async function waitForItem(
  userId: string,
  match: { contentLike?: string; titleLike?: string; urlLike?: string },
  accept: (row: ItemRow) => boolean = () => true,
  timeout = 120_000,
): Promise<ItemRow> {
  let found: ItemRow | undefined;
  await expect
    .poll(
      async () => {
        let q = adminClient().from("knowledge_items").select(COLUMNS).eq("user_id", userId);
        if (match.contentLike) q = q.ilike("content_md", `%${match.contentLike}%`);
        if (match.titleLike) q = q.ilike("title", `%${match.titleLike}%`);
        if (match.urlLike) q = q.ilike("source_url", `%${match.urlLike}%`);
        const { data, error } = await q.order("created_at", { ascending: false }).limit(5);
        if (error) throw new Error(error.message);
        found = (data as ItemRow[]).find(accept);
        return found ? "found" : "pending";
      },
      { timeout, intervals: [1000, 2000, 3000] },
    )
    .toBe("found");
  return found!;
}

export async function getItem(userId: string, id: string): Promise<ItemRow> {
  const { data, error } = await adminClient().from("knowledge_items").select(COLUMNS).eq("user_id", userId).eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as ItemRow;
}
