import { cache } from "react";
import { noteById } from "@/lib/workspace-data";
import { dataSource } from "./config";
import { getSession } from "./server";

/**
 * Title of one knowledge item for page metadata (fx2-perf). The full note page needs nothing else on the server: the
 * sheet renders from the client store. Before, the page and its metadata ran `loadWorkspace()`, i.e. the whole
 * snapshot (up to 1,500 items with their Markdown, plus tasks, folders and counts) on every client-side navigation to a
 * note. Now it is one row. Auth stays with the middleware (and the workspace layout on a full load).
 */
export const itemTitle = cache(async (id: string): Promise<string | null> => {
  if (dataSource() === "mock") return noteById(id)?.title ?? null;
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await session.client
    .from("knowledge_items")
    .select("title")
    .eq("user_id", session.user.id)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { title: string }).title;
});
