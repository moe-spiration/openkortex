import { t } from "@/i18n";
import { insertTaskOnce } from "@kortex/db";
import type { AuthContext } from "../auth";
import { createNoteFor } from "../notes/service";
import { getItem, updateItem } from "../repo";

/*
 * Thin adapter: every call the cleanup makes into existing item/task creation lives here, so a
 * signature change in those modules (e.g. the central dedup) only needs adapting in this file.
 */

type Ctx = Pick<AuthContext, "client" | "userId">;

/** The scratchpad document is identified by metadata.scratchpad and must never be merged by dedup. */
export const isScratchpadItem = (row: { metadata?: unknown } | null | undefined): boolean =>
  (row?.metadata as { scratchpad?: unknown } | null | undefined)?.scratchpad === true;

/**
 * Creates a note through the central dedup: the same content already stored is merged into that
 * entry (its id is returned), never inserted twice. The scratchpad itself (`scratchpadId`) is excluded.
 */
export async function createNoteTarget(
  ctx: Ctx,
  title: string,
  contentMd: string,
  scratchpadId?: string,
): Promise<string> {
  return (
    await createNoteFor(ctx, {
      title,
      contentMd,
      dedup: { platform: "scratchpad", ...(scratchpadId ? { excludeId: scratchpadId } : {}) },
    })
  ).id;
}

/** Creates a task unless an open task with the same title exists (then that one's id is returned). */
export async function createTaskTarget(
  ctx: Ctx,
  task: { title: string; description: string | null; sourceItemId: string },
): Promise<string> {
  const res = await insertTaskOnce(ctx.client, ctx.userId, {
    user_id: ctx.userId,
    title: task.title,
    description: task.description,
    status: "open",
    source_item_id: task.sourceItemId,
  });
  return res.id;
}

/** Appends text to an existing object item; returns its id. */
export async function appendToObjectTarget(ctx: Ctx, targetId: string, text: string): Promise<string> {
  const target = await getItem(ctx.client, ctx.userId, targetId, ["id", "content_md"] as const);
  if (!target) throw new Error(t("Target not found"));
  const body = (target.content_md ?? "").replace(/\s+$/, "");
  await updateItem(ctx.client, ctx.userId, target.id, { content_md: `${body}${body ? "\n\n" : ""}${text}\n` });
  return target.id;
}
