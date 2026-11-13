import type { AuthContext } from "../auth";
import type { ServerDeps } from "../deps";
import { budgetStatus } from "../limits/usage";
import { mergeJson, updateItem } from "../repo";
import type { IngestQueue } from "./queue";

/*
 * Items saved by an agent over MCP (brain_save_item, brain_log_agent_memory) land with status
 * `inbox` and no ingest job: the remote MCP server runs no organizer. Without this sweep they stay
 * "In Bearbeitung" forever. The web worker picks them up here and runs the normal pipeline in
 * `enrichOnly` mode (summary, tags, chunks; the agent's Markdown, title, type and a manual folder
 * stay). Skipped for users whose daily AI budget is used up; the next sweep tries again.
 */

/** Never-queued agent saves (no metadata.ingest). md-sync and the web routes queue their own. */
const SWEEP_PLATFORMS = ["mcp"];

export interface SweepOptions {
  /** Grace period after the save (an MCP organizer, if switched on, gets there first). */
  minAgeMs?: number;
  limit?: number;
}

interface OrphanRow {
  id: string;
  user_id: string;
  type: string;
  content_md: string | null;
  tags: string[] | null;
  folder_id: string | null;
  folder_path: string | null;
  is_manual_placement: boolean | null;
  metadata: unknown;
}

const hasIngest = (m: unknown) => !!m && typeof m === "object" && "ingest" in m && !!(m as { ingest?: unknown }).ingest;

/** Queues orphaned agent saves; returns how many were queued. */
export async function sweepOrphanItems(
  deps: Pick<ServerDeps, "clients" | "env" | "log" | "now">,
  queue: IngestQueue,
  o: SweepOptions = {},
): Promise<number> {
  const service = deps.clients.service();
  const cutoff = new Date(deps.now().getTime() - (o.minAgeMs ?? 2 * 60_000)).toISOString();
  const { data, error } = await service
    .from("knowledge_items")
    .select("id, user_id, type, content_md, tags, folder_id, folder_path, is_manual_placement, metadata")
    .eq("status", "inbox")
    .in("source_platform", SWEEP_PLATFORMS)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(o.limit ?? 50);
  if (error) throw new Error(`sweep: ${error.message}`);
  const rows = ((data ?? []) as unknown as OrphanRow[]).filter((r) => !hasIngest(r.metadata) && r.content_md?.trim());

  const overBudget = new Map<string, boolean>();
  let queued = 0;
  for (const r of rows) {
    if (!overBudget.has(r.user_id)) {
      const b = await budgetStatus(deps, r.user_id).catch(() => null);
      overBudget.set(r.user_id, !!b?.exceeded);
    }
    if (overBudget.get(r.user_id)) continue;
    const ctx: AuthContext = { userId: r.user_id, mode: "api_token", client: service };
    // Marked first: the next sweep skips it even while the job waits in the queue.
    await updateItem(service, r.user_id, r.id, {
      metadata: mergeJson(r.metadata as never, { ingest: { state: "queued", source: "sweep" } }),
    });
    const manual = !!r.is_manual_placement && !!r.folder_id;
    await queue.enqueue(ctx, {
      itemId: r.id,
      kind: "enrich",
      input: {
        rawText: r.content_md ?? "",
        typeHint: r.type as never,
        manualTags: r.tags ?? [],
        ...(manual ? { targetFolderId: r.folder_id!, targetFolderPath: r.folder_path ?? undefined } : {}),
      },
      options: { enrichOnly: true },
    });
    queued++;
  }
  return queued;
}
