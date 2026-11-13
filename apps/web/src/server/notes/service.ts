import { t, tx } from "@/i18n";
import { slugify } from "@kortex/ai-core";
import { contentHash, insertOrMerge, type Insert, type KortexClient } from "@kortex/db";
import { checklistChanges } from "@/lib/api/checklist";
import { tagName } from "@/lib/supabase/mapping";
import { bumpTags, ensureFolderPath, getItem, updateItem } from "../repo";

/*
 * Creating and editing notes, shared by the web server actions (lib/api/actions.ts) and the
 * mobile API (server/mobile). Runs as the given user client (RLS) and filters by user_id.
 */

export type NoteCtx = { client: KortexClient; userId: string };

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Slug unique within the folder (md-sync writes `<folder>/<slug>.md`). */
export async function freeSlug({ client, userId }: NoteCtx, folderPath: string, title: string, exceptId?: string): Promise<string> {
  const base = slugify(title) || "notiz";
  const { data, error } = await client
    .from("knowledge_items")
    .select("id,slug")
    .eq("user_id", userId)
    .eq("folder_path", folderPath)
    .like("slug", `${base}%`);
  if (error) throw new Error(error.message);
  const taken = new Set((data ?? []).filter((r) => r.id !== exceptId).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export interface CreateNoteInput {
  /** Client-generated uuid (optimistic UI keeps its id); generated here when omitted. */
  id?: string;
  title: string;
  contentMd?: string;
  /** Folder path; default 00_Inbox. A given folder counts as manual placement. */
  folderPath?: string;
  parentItemId?: string | null;
  tags?: string[];
  /** Cover image URL (W4: Unsplash or an uploaded image). */
  coverUrl?: string | null;
  /** Page icon: a Lucide icon name (W4). */
  icon?: string | null;
  /**
   * Run the central dedup (@kortex/db `insertOrMerge`): a note with the same content is merged into
   * the existing entry instead of inserted twice. Off for manual "new page" (an empty page is no
   * duplicate); used by automated creation such as the scratchpad cleanup. `excludeId` is never a hit.
   */
  dedup?: { excludeId?: string; platform?: string };
}

export async function createNoteFor(ctx: NoteCtx, input: CreateNoteInput): Promise<{ id: string; path: string }> {
  const title = input.title.trim() || tx("note title", "Untitled");
  const folder = await ensureFolderPath(ctx.client, ctx.userId, input.folderPath?.trim() || "00_Inbox");
  const slug = await freeSlug(ctx, folder.folder_path, title);
  const id = input.id && isUuid(input.id) ? input.id : crypto.randomUUID();
  const tags = (input.tags ?? []).map(tagName).filter(Boolean);
  const row = {
    id,
    user_id: ctx.userId,
    type: "note",
    source_platform: "manual",
    title,
    slug,
    content_md: input.contentMd ?? "",
    content_hash: await contentHash(input.contentMd ?? ""),
    folder_id: folder.id,
    folder_path: folder.folder_path,
    is_manual_placement: Boolean(input.folderPath),
    parent_item_id: input.parentItemId && isUuid(input.parentItemId) ? input.parentItemId : null,
    related_item_ids: input.parentItemId && isUuid(input.parentItemId) ? [input.parentItemId] : [],
    tags,
    status: "processed",
    ...(input.coverUrl ? { cover_image_url: cleanCoverUrl(input.coverUrl) } : {}),
    ...(input.icon ? { icon: cleanIcon(input.icon) } : {}),
  } satisfies Insert<"knowledge_items">;
  if (input.dedup) {
    const res = await insertOrMerge(ctx.client, ctx.userId, row, {
      type: "note",
      title,
      contentMd: row.content_md,
      tags,
      platform: input.dedup.platform ?? "manual",
      excludeId: input.dedup.excludeId,
    });
    if (res.duplicate) {
      const hit = await getItem(ctx.client, ctx.userId, res.id, ["folder_path", "slug"] as const);
      return { id: res.id, path: `${hit?.folder_path ?? folder.folder_path}/${hit?.slug ?? slug}.md` };
    }
  } else {
    const { error } = await ctx.client.from("knowledge_items").insert(row);
    if (error) throw new Error(error.message);
  }
  if (tags.length) await bumpTags(ctx.client, ctx.userId, tags, true);
  return { id, path: `${folder.folder_path}/${slug}.md` };
}

/** Accepts only http(s) URLs as cover (null clears it). Throws on anything else. */
export function cleanCoverUrl(url: string | null): string | null {
  if (url === null || url === "") return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(t("Invalid cover address"));
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(t("Invalid cover address"));
  return u.toString();
}

/** Page icons are Lucide names in kebab case ("book-open"); null clears it. */
export function cleanIcon(icon: string | null): string | null {
  if (icon === null || icon === "") return null;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(icon) || icon.length > 64) throw new Error(t("Invalid icon"));
  return icon;
}

/** W4: sets cover and/or icon of an item (undefined = unchanged). */
export async function setItemLookFor(ctx: NoteCtx, id: string, patch: { coverUrl?: string | null; icon?: string | null }): Promise<void> {
  const update: { cover_image_url?: string | null; icon?: string | null } = {};
  if (patch.coverUrl !== undefined) update.cover_image_url = cleanCoverUrl(patch.coverUrl);
  if (patch.icon !== undefined) update.icon = cleanIcon(patch.icon);
  if (!Object.keys(update).length) return;
  await updateItem(ctx.client, ctx.userId, id, update);
}

/** Saves title and/or body. The slug (file name) follows a title change. */
export async function updateNoteFor(ctx: NoteCtx, id: string, patch: { title?: string; contentMd?: string }): Promise<void> {
  const update: { title?: string; slug?: string; content_md?: string; content_hash?: string | null } = {};
  if (patch.contentMd !== undefined) {
    update.content_md = patch.contentMd;
    // The dedup hash always describes the stored body (@kortex/db dedup.ts).
    update.content_hash = await contentHash(patch.contentMd);
  }
  if (patch.title !== undefined && patch.title.trim()) {
    const cur = await getItem(ctx.client, ctx.userId, id, ["folder_path", "title"] as const);
    if (!cur) throw new Error(t("Entry not found"));
    if (cur.title !== patch.title.trim()) {
      update.title = patch.title.trim();
      update.slug = await freeSlug(ctx, cur.folder_path, update.title, id);
    }
  }
  if (Object.keys(update).length) await updateItem(ctx.client, ctx.userId, id, update);
  if (patch.contentMd !== undefined) await syncTasksFromBody(ctx, id, patch.contentMd);
}

/** Body checklist → action items of that note: a ticked `- [x] Text` closes the matching task. */
export async function syncTasksFromBody(ctx: NoteCtx, itemId: string, md: string): Promise<void> {
  if (!md.includes("[")) return;
  const { data, error } = await ctx.client
    .from("action_items")
    .select("id,title,status")
    .eq("user_id", ctx.userId)
    .eq("source_item_id", itemId)
    .in("status", ["open", "in_progress", "done"]);
  if (error) throw new Error(error.message);
  const changes = checklistChanges(
    md,
    (data ?? []).map((a) => ({ id: a.id, text: a.title, done: a.status === "done" })),
  );
  for (const c of changes) {
    const { error: upErr } = await ctx.client
      .from("action_items")
      .update({ status: c.done ? "done" : "open", completed_at: c.done ? new Date().toISOString() : null })
      .eq("user_id", ctx.userId)
      .eq("id", c.id);
    if (upErr) throw new Error(upErr.message);
  }
}
