"use server";

import { requestLocale } from "@/app/request-locale";
import { enterRequestLocale } from "@/i18n/server";
import { t } from "@/i18n";
import { stripFlashcardsSection } from "@kortex/ai-core";
import { DOMAIN_OBJECT_FOLDERS, isDomainObjectType, normalizeTimeframe, validateTypeMetadata, type Json, type KortexClient } from "@kortex/db";
import { validateMetadata } from "@/lib/objects/schema";
import { parseTypedValue, typedFieldsOf } from "@/lib/typed/fields";
import { dbTypeFor, tagName } from "@/lib/supabase/mapping";
import { ensureBootstrapped, getSession } from "@/lib/supabase/server";
import type { ItemType } from "@/lib/workspace-data";
import { bumpTags, ensureFolderPath, getItem, insertHighlight, updateItem } from "@/server/repo";
import { applyWatchPatch, isWatchableUrl, parseWatch, type WatchPatch, type WatchState } from "@/lib/radar";
import { setChecklistDone } from "./checklist";
import { AGENT_ASSIGNEE } from "@/lib/tasks-board";
import { mergeDailyMarkdown } from "@/lib/daily/merge";
import { createNoteFor, freeSlug, setItemLookFor, updateNoteFor, type CreateNoteInput } from "@/server/notes/service";

const MANUAL_TASK_MARK = "manual";

/*
 * Server actions behind the optimistic stores (lib/notes/store.tsx and friends). Each one runs as
 * the signed-in user (RLS) and also filters by user_id. They never throw to the client: the result
 * is `{ ok: false, error }`, and the store rolls its optimistic change back.
 */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

type Ctx = { client: KortexClient; userId: string };

async function run<T>(what: string, fn: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  enterRequestLocale(await requestLocale());
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: t("Not signed in") };
    await ensureBootstrapped(session);
    return { ok: true, data: await fn({ client: session.client, userId: session.user.id }) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kortex] ${what} failed:`, message);
    return { ok: false, error: message };
  }
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

// --- Notes -------------------------------------------------------------------------------------

export type { CreateNoteInput };

export async function createNote(input: CreateNoteInput): Promise<ActionResult<{ id: string; path: string }>> {
  return run("createNote", (ctx) => createNoteFor(ctx, input));
}

/** Saves title and/or body. The slug (file name) follows a title change. */
export async function updateNote(id: string, patch: { title?: string; contentMd?: string }): Promise<ActionResult> {
  return run("updateNote", async (ctx) => {
    await updateNoteFor(ctx, id, patch);
    return undefined;
  });
}

/**
 * The Markdown body of one item (and its updated_at), for notes whose body the workspace snapshot left out
 * (`bodyPending`, lib/supabase/snapshot.ts). Read-only.
 */
export async function loadItemBody(id: string): Promise<ActionResult<{ contentMd: string; updatedAt: string }>> {
  return run("loadItemBody", async (ctx) => {
    if (!isUuid(id)) throw new Error(t("Entry not found"));
    const row = await getItem(ctx.client, ctx.userId, id, ["content_md", "updated_at"] as const);
    if (!row) throw new Error(t("Entry not found"));
    return { contentMd: row.content_md ?? "", updatedAt: row.updated_at };
  });
}

/** W4: cover (URL) and page icon (Lucide name) of an item; undefined leaves a field unchanged, null clears it. */
export async function setItemLook(id: string, patch: { coverUrl?: string | null; icon?: string | null }): Promise<ActionResult> {
  return run("setItemLook", async (ctx) => {
    await setItemLookFor(ctx, id, patch);
    return undefined;
  });
}

// --- Objects -------------------------------------------------------------------------------------

/**
 * Turn into Object (or back into its content type): sets `type` and the domain metadata, keeps the
 * pipeline's own metadata keys. `moveToTypeFolder` moves it into `70_Objects/<Type>` unless the
 * user placed it by hand (CLAUDE.md rule 3); the shell instead offers the folder as a suggestion
 * and calls `moveItem` on accept.
 */
export async function turnIntoObject(
  id: string,
  to: ItemType,
  metadata: Record<string, unknown> = {},
  opts: { moveToTypeFolder?: boolean } = {},
): Promise<ActionResult<{ type: string; folderPath: string }>> {
  return run("turnIntoObject", async (ctx) => {
    const cur = await getItem(ctx.client, ctx.userId, id, ["type", "metadata", "folder_path", "is_manual_placement"] as const);
    if (!cur) throw new Error(t("Entry not found"));
    const meta = asRecord(cur.metadata);
    const previous = typeof meta.previous_type === "string" ? meta.previous_type : null;
    // Drop the old object's fields, keep everything else (ingest, ai_title, ...).
    if (isDomainObjectType(cur.type)) for (const key of Object.keys(validateMetadata(cur.type, meta).metadata)) delete meta[key];
    let type: string;
    if (isDomainObjectType(to)) {
      type = to;
      if (!isDomainObjectType(cur.type)) meta.previous_type = cur.type;
      Object.assign(meta, validateMetadata(to, metadata).metadata);
    } else {
      type = dbTypeFor(to, isDomainObjectType(cur.type) ? previous : cur.type);
      delete meta.previous_type;
    }
    let folderPath = cur.folder_path;
    const patch: Record<string, unknown> = { type, metadata: meta as Json };
    if (opts.moveToTypeFolder && isDomainObjectType(to) && !cur.is_manual_placement) {
      const folder = await ensureFolderPath(ctx.client, ctx.userId, DOMAIN_OBJECT_FOLDERS[to]);
      folderPath = folder.folder_path;
      Object.assign(patch, { folder_id: folder.id, folder_path: folderPath });
    }
    await updateItem(ctx.client, ctx.userId, id, patch);
    return { type, folderPath };
  });
}

/**
 * Sets (or with `undefined`/null removes) one metadata field: an object's domain field, or a typed item's registry
 * field (status, rating, isbn, ...; validated against the type registry). Only this one key changes; every other
 * stored key (pipeline bookkeeping, fields edited elsewhere) stays as it is.
 */
export async function setMetadataField(id: string, key: string, value: unknown): Promise<ActionResult> {
  return run("setMetadataField", async (ctx) => {
    const cur = await getItem(ctx.client, ctx.userId, id, ["type", "metadata"] as const);
    if (!cur) throw new Error(t("Entry not found"));
    const meta = asRecord(cur.metadata);
    if (!isDomainObjectType(cur.type)) {
      const field = typedFieldsOf(cur.type).find((f) => f.key === key);
      if (!field) throw new Error(t("Unknown field"));
      const parsed = parseTypedValue(field, value);
      if (!parsed.ok) throw new Error(parsed.error);
      if (parsed.value === undefined) delete meta[key];
      else {
        const checked = validateTypeMetadata(cur.type, { [key]: parsed.value });
        if (!checked.ok) throw new Error(checked.error);
        meta[key] = checked.metadata[key];
      }
    } else if (value === undefined || value === null || value === "") delete meta[key];
    else {
      const r = validateMetadata(cur.type, { [key]: value });
      if (r.errors[key]) throw new Error(r.errors[key]);
      if (r.dropped.length) throw new Error(t("Unknown field"));
      if (key in r.metadata) meta[key] = r.metadata[key];
      else delete meta[key];
    }
    await updateItem(ctx.client, ctx.userId, id, { metadata: meta as Json });
    return undefined;
  });
}

// --- Placement & tags ------------------------------------------------------------------------------

/**
 * Moves an item into a folder (created when missing). `manual` (default) sets
 * `is_manual_placement`, so the AI organizer never moves it again.
 */
export async function moveItem(id: string, folderPath: string, opts: { manual?: boolean } = {}): Promise<ActionResult<{ path: string }>> {
  return run("moveItem", async (ctx) => {
    const cur = await getItem(ctx.client, ctx.userId, id, ["title", "slug", "folder_path"] as const);
    if (!cur) throw new Error(t("Entry not found"));
    const folder = await ensureFolderPath(ctx.client, ctx.userId, folderPath);
    const slug = folder.folder_path === cur.folder_path ? cur.slug : await freeSlug(ctx, folder.folder_path, cur.slug || cur.title, id);
    await updateItem(ctx.client, ctx.userId, id, {
      folder_id: folder.id,
      folder_path: folder.folder_path,
      slug,
      is_manual_placement: opts.manual ?? true,
    });
    return { path: `${folder.folder_path}/${slug}.md` };
  });
}

/**
 * "Prüfen" after an automatic placement (or undo in the Inbox): flags the item so it shows up in
 * the Inbox review queue (metadata.placement.review), whatever the organizer's confidence was.
 * `review: false` clears the flag.
 */
export async function requestPlacementReview(id: string, review = true): Promise<ActionResult> {
  return run("requestPlacementReview", async (ctx) => {
    const cur = await getItem(ctx.client, ctx.userId, id, ["metadata"] as const);
    if (!cur) throw new Error(t("Entry not found"));
    const meta = asRecord(cur.metadata);
    const placement = asRecord(meta.placement);
    if (review) placement.review = true;
    else delete placement.review;
    await updateItem(ctx.client, ctx.userId, id, { metadata: { ...meta, placement } as Json });
    return undefined;
  });
}

async function setTags(ctx: Ctx, id: string, fn: (tags: string[]) => string[]): Promise<string[]> {
  const cur = await getItem(ctx.client, ctx.userId, id, ["tags"] as const);
  if (!cur) throw new Error(t("Entry not found"));
  const next = [...new Set(fn(cur.tags ?? []))];
  await updateItem(ctx.client, ctx.userId, id, { tags: next });
  return next;
}

/** Adds a hashtag (`#ai/mcp` or `ai/mcp`); returns the item's tags as labels without `#`. */
export async function addTag(id: string, label: string): Promise<ActionResult<string[]>> {
  return run("addTag", async (ctx) => {
    const name = tagName(label);
    if (!name) throw new Error(t("Empty tag"));
    const tags = await setTags(ctx, id, (t) => [...t.filter((x) => tagName(x) !== name), name]);
    await bumpTags(ctx.client, ctx.userId, [name], true);
    return tags;
  });
}

export async function removeTag(id: string, label: string): Promise<ActionResult<string[]>> {
  return run("removeTag", async (ctx) => {
    const name = tagName(label);
    return setTags(ctx, id, (t) => t.filter((x) => tagName(x) !== name));
  });
}

// --- Lists: bulk actions (context menu and selection bar) ----------------------------------------------

const BULK_MAX = 500;

function bulkIds(ids: readonly string[]): string[] {
  const list = [...new Set(ids)].filter(isUuid);
  if (!list.length) throw new Error(t("Nothing selected"));
  if (list.length > BULK_MAX) throw new Error(t("At most {max} entries at once", { max: BULK_MAX }));
  return list;
}

/** Marks or unmarks items as favorites. */
export async function setFavorite(ids: string[], favorite: boolean): Promise<ActionResult> {
  return run("setFavorite", async (ctx) => {
    const { error } = await ctx.client.from("knowledge_items").update({ is_favorite: favorite }).eq("user_id", ctx.userId).in("id", bulkIds(ids));
    if (error) throw new Error(error.message);
    return undefined;
  });
}

/**
 * Archives items (status `archived`: hidden everywhere, the file leaves the vault like a local deletion) or
 * brings them back to the status they had before (`metadata.status_before_archive`, default `processed`).
 */
export async function setArchived(ids: string[], archived: boolean): Promise<ActionResult> {
  return run("setArchived", async (ctx) => {
    for (const id of bulkIds(ids)) {
      const cur = await getItem(ctx.client, ctx.userId, id, ["status", "metadata"] as const);
      if (!cur) continue;
      const meta = asRecord(cur.metadata);
      if (archived) {
        if (cur.status === "archived") continue;
        meta.status_before_archive = cur.status;
        await updateItem(ctx.client, ctx.userId, id, { status: "archived", metadata: meta as Json });
      } else {
        const before = typeof meta.status_before_archive === "string" ? meta.status_before_archive : "processed";
        delete meta.status_before_archive;
        await updateItem(ctx.client, ctx.userId, id, { status: before, metadata: meta as Json });
      }
    }
    return undefined;
  });
}

/** Deletes items for good. The UI waits for its undo window to pass before calling this. */
export async function deleteItems(ids: string[]): Promise<ActionResult<{ deleted: number }>> {
  return run("deleteItems", async (ctx) => {
    const list = bulkIds(ids);
    const { error } = await ctx.client.from("knowledge_items").delete().eq("user_id", ctx.userId).in("id", list);
    if (error) throw new Error(error.message);
    return { deleted: list.length };
  });
}

/** Moves several items into one folder (manual placement, like `moveItem`). */
export async function moveItems(ids: string[], folderPath: string): Promise<ActionResult<{ moved: number }>> {
  return run("moveItems", async (ctx) => {
    const list = bulkIds(ids);
    const folder = await ensureFolderPath(ctx.client, ctx.userId, folderPath);
    let moved = 0;
    for (const id of list) {
      const cur = await getItem(ctx.client, ctx.userId, id, ["title", "slug", "folder_path"] as const);
      if (!cur) continue;
      const slug = folder.folder_path === cur.folder_path ? cur.slug : await freeSlug(ctx, folder.folder_path, cur.slug || cur.title, id);
      await updateItem(ctx.client, ctx.userId, id, { folder_id: folder.id, folder_path: folder.folder_path, slug, is_manual_placement: true });
      moved += 1;
    }
    return { moved };
  });
}

/** Adds (`on`) or removes a hashtag on several items. */
export async function tagItems(ids: string[], label: string, on: boolean): Promise<ActionResult> {
  return run("tagItems", async (ctx) => {
    const name = tagName(label);
    if (!name) throw new Error(t("Empty tag"));
    for (const id of bulkIds(ids)) await setTags(ctx, id, (t) => (on ? [...t.filter((x) => tagName(x) !== name), name] : t.filter((x) => tagName(x) !== name)));
    if (on) await bumpTags(ctx.client, ctx.userId, [name], true);
    return undefined;
  });
}

// --- Journal entries and flashcard decks (context menu) --------------------------------------------------

/**
 * "Als Notiz exportieren": copies an item (a daily note, say) into a regular note in `10_Notes`, leaving the
 * original untouched. Returns the new note's id and path.
 */
export async function duplicateAsNote(id: string, folderPath = "10_Notes"): Promise<ActionResult<{ id: string; path: string }>> {
  return run("duplicateAsNote", async (ctx) => {
    const cur = await getItem(ctx.client, ctx.userId, id, ["title", "content_md"] as const);
    if (!cur) throw new Error(t("Entry not found"));
    return createNoteFor(ctx, { title: cur.title, contentMd: cur.content_md, folderPath });
  });
}

/** Removes the flashcard deck of a note (the note itself stays). The UI waits for its undo window first. */
export async function deleteFlashcardDeck(itemId: string): Promise<ActionResult> {
  return run("deleteFlashcardDeck", async (ctx) => {
    if (!isUuid(itemId)) throw new Error(t("Invalid note"));
    const cur = await getItem(ctx.client, ctx.userId, itemId, ["content_md"] as const);
    await updateItem(ctx.client, ctx.userId, itemId, {
      flashcards: null,
      ...(cur ? { content_md: stripFlashcardsSection(cur.content_md) } : {}),
    });
    return undefined;
  });
}

// --- Tasks -------------------------------------------------------------------------------------------

/**
 * Ticks or reopens a task. When it came from a note whose body has the same checklist line, that
 * line flips too (`bodyChanged`), so the note and the task list never disagree.
 */
export async function setActionItemDone(actionId: string, done: boolean): Promise<ActionResult<{ bodyChanged: boolean }>> {
  return run("setActionItemDone", async (ctx) => {
    const { data, error } = await ctx.client
      .from("action_items")
      .update({ status: done ? "done" : "open", completed_at: done ? new Date().toISOString() : null })
      .eq("user_id", ctx.userId)
      .eq("id", actionId)
      .select("title,source_item_id");
    if (error) throw new Error(error.message);
    const row = data?.[0];
    if (!row) throw new Error(t("Task not found"));
    if (!row.source_item_id) return { bodyChanged: false };
    const item = await getItem(ctx.client, ctx.userId, row.source_item_id, ["content_md"] as const);
    if (!item) return { bodyChanged: false };
    const next = setChecklistDone(item.content_md, row.title, done);
    if (next === item.content_md) return { bodyChanged: false };
    await updateItem(ctx.client, ctx.userId, row.source_item_id, { content_md: next });
    return { bodyChanged: true };
  });
}

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

export interface TaskInput {
  title: string;
  /** YYYY-MM-DD (local day) or full ISO timestamp; null clears it. */
  due?: string | null;
  priority?: Priority;
  /** Note the task belongs to (optional). */
  sourceItemId?: string | null;
  /** Project / goal object the task belongs to; null clears it. */
  projectItemId?: string | null;
  /** "today" | "this_week" | "later" | YYYY-MM-DD; null clears it. */
  timeframe?: string | null;
  /** Short why / where-from sentence; null clears it. */
  context?: string | null;
}

/** Validated update columns for the optional rich fields (shared by create and update). */
async function richFields(
  ctx: Ctx,
  input: Pick<TaskInput, "projectItemId" | "timeframe" | "context">,
): Promise<{ project_item_id?: string | null; timeframe?: string | null; context?: string | null }> {
  const out: { project_item_id?: string | null; timeframe?: string | null; context?: string | null } = {};
  if (input.projectItemId !== undefined) {
    if (input.projectItemId === null) out.project_item_id = null;
    else {
      if (!isUuid(input.projectItemId)) throw new Error(t("Invalid project"));
      const { data, error } = await ctx.client
        .from("knowledge_items")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("id", input.projectItemId)
        .in("type", ["project", "goal"])
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(t("Project not found"));
      out.project_item_id = input.projectItemId;
    }
  }
  if (input.timeframe !== undefined) {
    const tf = input.timeframe === null || input.timeframe === "" ? null : normalizeTimeframe(input.timeframe);
    if (input.timeframe && !tf) throw new Error(t("Invalid timeframe"));
    out.timeframe = tf;
  }
  if (input.context !== undefined) {
    const c = input.context?.replace(/s+/g, " ").trim() ?? "";
    if (c.length > 500) throw new Error(t("Context too long"));
    out.context = c || null;
  }
  return out;
}

const dueValue = (due: string | null | undefined): string | null | undefined => {
  if (due === undefined || due === null || due === "") return due === "" ? null : due;
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return `${due}T00:00:00Z`;
  if (Number.isNaN(Date.parse(due))) throw new Error(t("Invalid due date"));
  return due;
};

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  source_item_id: string | null;
  created_at: string;
  project_item_id: string | null;
  timeframe: string | null;
  context: string | null;
  exported_at: string | null;
  external_ref: string | null;
  assignee: string | null;
}

const TASK_COLUMNS = "id,title,status,priority,due_date,source_item_id,created_at,project_item_id,timeframe,context,exported_at,external_ref,assignee" as const;

/** A task typed by hand (Tasks hub). Marked as manual (not AI-extracted). */
export async function createActionItem(input: TaskInput): Promise<ActionResult<TaskRow>> {
  return run("createActionItem", async (ctx) => {
    const title = input.title.replace(/\s+/g, " ").trim();
    if (!title) throw new Error(t("Empty task"));
    if (title.length > 500) throw new Error(t("Task too long"));
    const priority = input.priority && PRIORITIES.includes(input.priority) ? input.priority : "medium";
    const source = input.sourceItemId && isUuid(input.sourceItemId) ? input.sourceItemId : null;
    const rich = await richFields(ctx, input);
    const { data, error } = await ctx.client
      .from("action_items")
      .insert({
        user_id: ctx.userId,
        title,
        description: MANUAL_TASK_MARK,
        priority,
        due_date: dueValue(input.due) ?? null,
        source_item_id: source,
        ...rich,
      })
      .select(TASK_COLUMNS)
      .single();
    if (error || !data) throw new Error(error?.message ?? "insert failed");
    return data as TaskRow;
  });
}

/** Edits title, due date, priority, project, timeframe or context of a task. */
export async function updateActionItem(id: string, patch: Partial<Omit<TaskInput, "sourceItemId">>): Promise<ActionResult<TaskRow>> {
  return run("updateActionItem", async (ctx) => {
    const update: { title?: string; due_date?: string | null; priority?: Priority; project_item_id?: string | null; timeframe?: string | null; context?: string | null } = await richFields(ctx, patch);
    if (patch.title !== undefined) {
      const title = patch.title.replace(/\s+/g, " ").trim();
      if (!title || title.length > 500) throw new Error(t("Invalid title"));
      update.title = title;
    }
    if (patch.due !== undefined) update.due_date = dueValue(patch.due) ?? null;
    if (patch.priority !== undefined) {
      if (!PRIORITIES.includes(patch.priority)) throw new Error(t("Invalid priority"));
      update.priority = patch.priority;
    }
    const { data, error } = await ctx.client
      .from("action_items")
      .update(update)
      .eq("user_id", ctx.userId)
      .eq("id", id)
      .select(TASK_COLUMNS)
      .single();
    if (error || !data) throw new Error(error?.message ?? t("Task not found"));
    return data as TaskRow;
  });
}

/**
 * Status board: takes an AI suggestion over (`accepted`, status in_progress) or puts it back (status open), and
 * hands a task to the agent (`agent`, assignee "Agent") or takes it back. A done task keeps its status.
 */
export async function setActionItemStage(id: string, patch: { accepted?: boolean; agent?: boolean }): Promise<ActionResult<TaskRow>> {
  return run("setActionItemStage", async (ctx) => {
    const { data: row, error: readError } = await ctx.client.from("action_items").select("status").eq("user_id", ctx.userId).eq("id", id).maybeSingle();
    if (readError || !row) throw new Error(readError?.message ?? t("Task not found"));
    const update: { status?: "open" | "in_progress"; assignee?: string } = {};
    if (patch.accepted !== undefined && (row.status === "open" || row.status === "in_progress")) update.status = patch.accepted ? "in_progress" : "open";
    if (patch.agent !== undefined) update.assignee = patch.agent ? AGENT_ASSIGNEE : "Me";
    const q = ctx.client.from("action_items");
    const { data, error } = Object.keys(update).length
      ? await q.update(update).eq("user_id", ctx.userId).eq("id", id).select(TASK_COLUMNS).single()
      : await q.select(TASK_COLUMNS).eq("user_id", ctx.userId).eq("id", id).single();
    if (error || !data) throw new Error(error?.message ?? t("Task not found"));
    return data as TaskRow;
  });
}

/**
 * Marks tasks as handed over ("überführt", `exported_at` = now) or takes the mark back (`exported: false`).
 * Returns the stored timestamps so the optimistic UI can settle on the server value.
 */
export async function setActionItemsExported(ids: string[], exported: boolean): Promise<ActionResult<{ id: string; exported_at: string | null }[]>> {
  return run("setActionItemsExported", async (ctx) => {
    const list = [...new Set(ids)].filter(isUuid).slice(0, 500);
    if (!list.length) return [];
    const { data, error } = await ctx.client
      .from("action_items")
      .update({ exported_at: exported ? new Date().toISOString() : null })
      .eq("user_id", ctx.userId)
      .in("id", list)
      .select("id,exported_at");
    if (error) throw new Error(error.message);
    return data ?? [];
  });
}

/** Removes a task for good (cancelled tasks are hidden anyway; this is the "Löschen" path). */
export async function deleteActionItem(id: string): Promise<ActionResult> {
  return run("deleteActionItem", async (ctx) => {
    const { error } = await ctx.client.from("action_items").delete().eq("user_id", ctx.userId).eq("id", id);
    if (error) throw new Error(error.message);
    return undefined;
  });
}

// --- Daily check-in ----------------------------------------------------------------------------------

export interface DailyCheckinInput {
  /** YYYY-MM-DD */
  date: string;
  /** The file body (`toDailyMarkdown()` of components/home/daily.ts). */
  markdown: string;
  /** The structured check-in (stored as metadata.checkin for the widget). */
  checkin: Record<string, unknown>;
}

/** Upserts the daily note `10_Notes/Daily/<date>.md` (type daily_note, slug = date). */
export async function saveDailyCheckin(input: DailyCheckinInput): Promise<ActionResult<{ id: string }>> {
  return run("saveDailyCheckin", async (ctx) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error(t("Invalid date"));
    const folder = await ensureFolderPath(ctx.client, ctx.userId, "10_Notes/Daily");
    const { data: existing, error } = await ctx.client
      .from("knowledge_items")
      .select("id,metadata,content_md")
      .eq("user_id", ctx.userId)
      .eq("type", "daily_note")
      .eq("folder_path", folder.folder_path)
      .eq("slug", input.date)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const metadata = { ...asRecord(existing?.metadata), date: input.date, checkin: input.checkin } as Json;
    if (existing) {
      // W-01: only the check-in parts are replaced; text the user wrote into the note stays.
      const content_md = mergeDailyMarkdown(existing.content_md as string | null, input.markdown);
      await updateItem(ctx.client, ctx.userId, existing.id, { content_md, metadata });
      return { id: existing.id };
    }
    const id = crypto.randomUUID();
    const ins = await ctx.client.from("knowledge_items").insert({
      id,
      user_id: ctx.userId,
      type: "daily_note",
      source_platform: "manual",
      title: `Daily Journal ${input.date}`,
      slug: input.date,
      content_md: input.markdown,
      folder_id: folder.id,
      folder_path: folder.folder_path,
      is_manual_placement: true,
      tags: ["daily"],
      metadata,
      status: "processed",
    });
    if (ins.error) throw new Error(ins.error.message);
    return { id };
  });
}

/** The stored check-in of a day (metadata.checkin), or null. */
export async function loadDailyCheckin(date: string): Promise<ActionResult<Record<string, unknown> | null>> {
  return run("loadDailyCheckin", async (ctx) => {
    const { data, error } = await ctx.client
      .from("knowledge_items")
      .select("metadata")
      .eq("user_id", ctx.userId)
      .eq("type", "daily_note")
      .eq("slug", date)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const c = asRecord(data?.metadata).checkin;
    return c && typeof c === "object" ? (c as Record<string, unknown>) : null;
  });
}

// --- Reader: highlights & reading state -----------------------------------------------------------------

export interface HighlightInput {
  text: string;
  note?: string | null;
  color?: string;
  /** Where it sits: { page } for PDF, { cfi } for EPUB, anything JSON. */
  locator: Record<string, unknown>;
}

export async function saveHighlight(itemId: string, h: HighlightInput): Promise<ActionResult<{ id: string }>> {
  return run("saveHighlight", async (ctx) => {
    if (!h.text.trim()) throw new Error(t("Empty highlight"));
    const id = await insertHighlight(ctx.client, {
      item_id: itemId,
      user_id: ctx.userId,
      quote_text: h.text,
      note_text: h.note ?? null,
      color: h.color ?? "yellow",
      locator: h.locator as Json,
    });
    return { id };
  });
}

export interface StoredHighlight {
  id: string;
  text: string;
  note: string | null;
  color: string | null;
  locator: Record<string, unknown>;
  createdAt: string;
}

export async function listHighlights(itemId: string): Promise<ActionResult<StoredHighlight[]>> {
  return run("listHighlights", async (ctx) => {
    const { data, error } = await ctx.client
      .from("item_highlights")
      .select("id,quote_text,note_text,color,locator,created_at")
      .eq("user_id", ctx.userId)
      .eq("item_id", itemId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      text: r.quote_text,
      note: r.note_text,
      color: r.color,
      locator: asRecord(r.locator),
      createdAt: r.created_at,
    }));
  });
}

// --- Reminders and delta radar (S11) --------------------------------------------------------------

/** Snooze / set a reminder (`remind_at`, ISO instant); null clears it (done). */
export async function setReminder(id: string, remindAt: string | null): Promise<ActionResult> {
  return run("setReminder", async (ctx) => {
    if (remindAt !== null && Number.isNaN(Date.parse(remindAt))) throw new Error(t("Invalid date"));
    const iso = remindAt === null ? null : new Date(remindAt).toISOString();
    const cur = await getItem(ctx.client, ctx.userId, id, ["id"] as const);
    if (!cur) throw new Error(t("Entry not found"));
    await updateItem(ctx.client, ctx.userId, id, { remind_at: iso });
    return undefined;
  });
}

/** "Beobachten" of a URL item: switches `metadata.watch` on/off, sets the interval, marks a change as seen. */
export async function patchWatch(id: string, patch: WatchPatch): Promise<ActionResult<WatchState>> {
  return run("patchWatch", async (ctx) => {
    const cur = await getItem(ctx.client, ctx.userId, id, ["metadata", "source_url"] as const);
    if (!cur) throw new Error(t("Entry not found"));
    if (patch.enabled && !isWatchableUrl(cur.source_url)) throw new Error(t("Only entries with a web address can be watched"));
    const meta = asRecord(cur.metadata);
    const next = applyWatchPatch(parseWatch(meta), patch, new Date());
    await updateItem(ctx.client, ctx.userId, id, { metadata: { ...meta, watch: next } as unknown as Json });
    return next;
  });
}

export async function saveReadingState(itemId: string, state: Record<string, unknown>): Promise<ActionResult> {
  return run("saveReadingState", async (ctx) => {
    await updateItem(ctx.client, ctx.userId, itemId, { reading_state: state as Json });
    return undefined;
  });
}
