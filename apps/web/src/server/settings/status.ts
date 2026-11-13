"use server";

import { participantsOf, type ShellStatusData } from "@/lib/shell/status-core";
import { isFresh, liveMetaOf } from "@/server/meeting/live-core";
import { runAction, type ActionResult } from "./run";

/*
 * Live shell status (sidebar Gardener line, inbox badge, meeting card): counts over the signed-in
 * user's knowledge_items. Polled by lib/shell/status.tsx.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MEETING_WINDOW_MS = 3 * 60 * 60 * 1000;

export async function getShellStatus(): Promise<ActionResult<ShellStatusData>> {
  return runAction("getShellStatus", async ({ client, userId }) => {
    const now = Date.now();
    const since24h = new Date(now - DAY_MS).toISOString();
    const items = () => client.from("knowledge_items");
    const [queued, processing, errors, processed, last, meeting] = await Promise.all([
      items().select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "inbox"),
      items().select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "processing"),
      items().select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "error").gte("updated_at", since24h),
      items().select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "processed").gte("updated_at", since24h),
      items().select("title, updated_at").eq("user_id", userId).eq("status", "processed").order("updated_at", { ascending: false }).limit(1),
      items()
        .select("id, title, status, created_at, summary, metadata")
        .eq("user_id", userId)
        .eq("type", "meeting")
        .gte("created_at", new Date(now - MEETING_WINDOW_MS).toISOString())
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    for (const r of [queued, processing, errors, processed, last, meeting]) if (r.error) throw new Error(r.error.message);
    const lastRow = (last.data?.[0] ?? null) as { title: string; updated_at: string } | null;
    const m = (meeting.data?.[0] ?? null) as {
      id: string;
      title: string;
      status: string;
      created_at: string;
      summary: string | null;
      metadata: Record<string, unknown> | null;
    } | null;
    const coaching = m?.metadata?.coaching;
    const live = m ? liveMetaOf(m.metadata) : null;
    return {
      queued: queued.count ?? 0,
      processing: processing.count ?? 0,
      errors: errors.count ?? 0,
      processed24h: processed.count ?? 0,
      lastProcessed: lastRow ? { title: lastRow.title, at: lastRow.updated_at } : null,
      meeting: m
        ? {
            id: m.id,
            title: m.title,
            status: m.status,
            created_at: m.created_at,
            participants: participantsOf(m.metadata),
            summary: m.summary,
            coaching: typeof coaching === "string" && coaching.trim() ? coaching.trim() : null,
            live_started_at: live && isFresh(live, new Date(now)) ? live.started_at : null,
          }
        : null,
      fetchedAt: new Date(now).toISOString(),
    };
  });
}
