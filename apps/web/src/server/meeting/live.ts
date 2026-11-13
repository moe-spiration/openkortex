import { intlLocale, t } from "@/i18n";
import { slugify } from "@kortex/ai-core";
import type { Json } from "@kortex/db";
import { ApiError, json, notFound } from "../api-error";
import type { AuthContext } from "../auth";
import type { ServerDeps } from "../deps";
import { INBOX_FOLDER } from "../ingest/contract";
import { enforceLimits } from "../limits";
import { getItem, insertItem, listFolders, mergeJson, updateItem } from "../repo";
import { preflight, readJson, route, type DepsProvider } from "../route";
import {
  addClip,
  appendTranscript,
  finalTranscript,
  formatSegments,
  isFresh,
  liveMetaOf,
  LiveActionSchema,
  MAX_TRANSCRIPT_CHARS,
  toSession,
  type LiveAction,
  type LiveClip,
  type LiveMeta,
  type LiveSession,
} from "./live-core";

/*
 * POST /api/meeting/live  start | append | clip | task | end (desktop HUD, web card)
 * GET  /api/meeting/live  the running session for the web card, or null
 * Spec: docs/plans/2026-10-30-meeting-capture.md. No new table: the session is the meeting item.
 */

const LIVE_COLUMNS = ["id", "title", "content_md", "metadata", "status", "type"] as const;

type LiveRow = { id: string; title: string; content_md: string | null; metadata: Json | null; status: string; type: string };

async function loadLive(ctx: AuthContext, itemId: string): Promise<{ row: LiveRow; live: LiveMeta }> {
  const row = (await getItem(ctx.client, ctx.userId, itemId, LIVE_COLUMNS)) as LiveRow | null;
  const live = row ? liveMetaOf(row.metadata) : null;
  if (!row || row.type !== "meeting" || !live) throw notFound(t("Live meeting not found"));
  return { row, live };
}

const writeLive = (ctx: AuthContext, row: LiveRow, live: LiveMeta, patch: Record<string, unknown> = {}) =>
  updateItem(ctx.client, ctx.userId, row.id, {
    ...patch,
    metadata: mergeJson(row.metadata, { live: live as unknown as Json }),
  });

const defaultTitle = (at: Date, tz?: string) =>
  `Meeting ${at.toLocaleString(intlLocale(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz })}`;

export async function startSession(deps: ServerDeps, ctx: AuthContext, a: Extract<LiveAction, { action: "start" }>) {
  const now = deps.now();
  const started = a.started_at ? new Date(a.started_at) : now;
  const title = a.title?.trim() || defaultTitle(started, "Europe/Berlin");
  const inbox = (await listFolders(ctx.client, ctx.userId)).find((f) => f.folder_path === INBOX_FOLDER);
  const id = deps.uuid();
  const live: LiveMeta = {
    state: "recording",
    started_at: started.toISOString(),
    updated_at: now.toISOString(),
    segments: 0,
    last_sec: 0,
    clips: [],
    cards: [],
    transcriber: a.transcriber ?? null,
  };
  await insertItem(ctx.client, {
    id,
    user_id: ctx.userId,
    type: "meeting",
    source_platform: a.client?.name === "kortex-desktop" ? "desktop" : "manual",
    title,
    slug: slugify(title) || id,
    content_md: "",
    folder_path: inbox?.folder_path ?? INBOX_FOLDER,
    folder_id: inbox?.id || null,
    is_manual_placement: false,
    tags: [],
    // "processing": the Gardener shows the meeting as work in progress until the protocol is done.
    status: "processing",
    metadata: mergeJson(null, {
      captured_at: live.started_at,
      client: a.client ?? null,
      live: live as unknown as Json,
    }),
  });
  return { ok: true as const, item_id: id, title };
}

export async function appendSegments(deps: ServerDeps, ctx: AuthContext, a: Extract<LiveAction, { action: "append" }>) {
  const { row, live } = await loadLive(ctx, a.item_id);
  if (live.state !== "recording") throw new ApiError("invalid_request", t("The meeting has already ended"), { status: 409 });
  const lines = formatSegments(a.segments);
  const content = appendTranscript(row.content_md, lines);
  if (content.length > MAX_TRANSCRIPT_CHARS) throw new ApiError("invalid_request", t("Transcript too long"), { status: 413 });
  const last = a.segments.reduce((m, s) => Math.max(m, s.start_sec), live.last_sec);
  const next: LiveMeta = {
    ...live,
    segments: live.segments + lines.length,
    last_sec: last,
    updated_at: deps.now().toISOString(),
    transcriber: a.transcriber ?? live.transcriber ?? null,
  };
  await writeLive(ctx, row, next, { content_md: content });
  return { ok: true as const, segments: next.segments };
}

export async function clipMoment(deps: ServerDeps, ctx: AuthContext, a: Extract<LiveAction, { action: "clip" }>) {
  const { row, live } = await loadLive(ctx, a.item_id);
  const now = deps.now();
  // Without a time (web card): seconds since the start.
  const at = a.at_sec ?? Math.max(0, Math.round((now.getTime() - Date.parse(live.started_at)) / 1000));
  const clip: LiveClip = { id: deps.uuid(), at_sec: at, text: a.text?.trim() ?? "", source: a.source, created_at: now.toISOString() };
  await writeLive(ctx, row, { ...addClip(live, clip), updated_at: live.state === "recording" ? now.toISOString() : live.updated_at });
  return { ok: true as const, clip };
}

export async function createTask(ctx: AuthContext, a: Extract<LiveAction, { action: "task" }>) {
  const { row } = await loadLive(ctx, a.item_id);
  // Not linked through source_item_id: the protocol run replaces the item's open extracted tasks.
  const { data, error } = await ctx.client
    .from("action_items")
    .insert({
      user_id: ctx.userId,
      title: a.title,
      description: t("From the live meeting “{title}”", { title: row.title }),
      source_timestamp_sec: a.at_sec != null ? Math.round(a.at_sec) : null,
    })
    .select("id")
    .single();
  if (error) throw new ApiError("server_error", `create task: ${error.message}`);
  return { ok: true as const, task_id: (data as { id: string }).id };
}

/** Ends the session and hands the transcript to the meeting adapter (protocol, action items). */
export async function endSession(deps: ServerDeps, ctx: AuthContext, a: Extract<LiveAction, { action: "end" }>) {
  const { row, live } = await loadLive(ctx, a.item_id);
  if (live.state === "ended") return { ok: true as const, item_id: row.id, queued: false };
  const transcript = a.transcript?.trim() ? a.transcript.trim() : (row.content_md ?? "").trim();
  const now = deps.now().toISOString();
  const ended: LiveMeta = { ...live, state: "ended", ended_at: now, updated_at: now };
  if (!transcript) {
    // Nothing was said: keep the (empty) item, no paid model run.
    await writeLive(ctx, row, ended, { status: "processed", summary: t("No conversation detected.") });
    return { ok: true as const, item_id: row.id, queued: false };
  }
  await writeLive(ctx, row, ended, { content_md: transcript, status: "inbox" });
  const fresh = (await getItem(ctx.client, ctx.userId, row.id, ["metadata"]))?.metadata ?? null;
  await updateItem(ctx.client, ctx.userId, row.id, { metadata: mergeJson(fresh, { ingest: { state: "queued" } }) });
  await deps.queue.enqueue(ctx, {
    itemId: row.id,
    kind: "note",
    input: { rawText: finalTranscript(transcript, live.clips), typeHint: "meeting", manualTags: [] },
    options: { keepTitle: false },
  });
  return { ok: true as const, item_id: row.id, queued: true };
}

/** Newest meeting item that is a fresh live session, or null. */
export async function currentSession(deps: ServerDeps, ctx: AuthContext): Promise<LiveSession | null> {
  const { data, error } = await ctx.client
    .from("knowledge_items")
    .select("id, title, content_md, metadata")
    .eq("user_id", ctx.userId)
    .eq("type", "meeting")
    .eq("status", "processing")
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) throw new ApiError("server_error", `load live meeting: ${error.message}`);
  const now = deps.now();
  for (const r of (data ?? []) as Array<{ id: string; title: string; content_md: string | null; metadata: Json | null }>) {
    const live = liveMetaOf(r.metadata);
    if (isFresh(live, now)) return toSession(r, live!);
  }
  return null;
}

export function createMeetingLiveHandlers(getDeps: DepsProvider) {
  return {
    GET: route(getDeps, async ({ auth, deps }) => json({ ok: true, session: await currentSession(deps, auth) })),
    POST: route(getDeps, async ({ request, auth, deps }) => {
      const a = LiveActionSchema.parse(await readJson(request));
      switch (a.action) {
        case "start":
          await enforceLimits({ auth, deps }, "ingest");
          return json(await startSession(deps, auth, a), { status: 201 });
        case "append":
          return json(await appendSegments(deps, auth, a));
        case "clip":
          return json(await clipMoment(deps, auth, a));
        case "task":
          await enforceLimits({ auth, deps }, "ingest");
          return json(await createTask(auth, a));
        case "end":
          await enforceLimits({ auth, deps }, "ingest");
          return json(await endSession(deps, auth, a));
      }
    }),
    OPTIONS: preflight(getDeps),
  };
}
