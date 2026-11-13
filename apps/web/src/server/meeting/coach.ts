import { t } from "@/i18n";
import {
  generateCoaching,
  parseMeetingTranscript,
  lastMinutes,
  type CoachingSnippet,
  type CoachingTask,
} from "@kortex/ai-core";
import { matchKnowledgeHybrid, matchKnowledgeHybridForUser, type Json } from "@kortex/db";
import { ApiError, json, notFound } from "../api-error";
import type { AuthContext } from "../auth";
import type { ServerDeps } from "../deps";
import { enforceLimits } from "../limits";
import { getItem, getUserSettings, mergeJson, updateItem } from "../repo";
import { preflight, readJson, route, type DepsProvider } from "../route";
import { CHANNEL_NAMES, cardsFromBullets, CoachRequestSchema, liveMetaOf, type CoachCard } from "./live-core";

/*
 * POST /api/meeting/coach { item_id }: live coaching for the running meeting (desktop HUD, web card).
 * Last minutes of the live transcript + full-text matches from the Second Brain + open tasks →
 * the user's `meeting_coach` route (ADR-06) → at most 3 cards, stored in metadata.live.cards.
 */

const SNIPPETS = 6;
const QUERY_CHARS = 400;

/** Search words of the recent transcript (websearch syntax: plain words, OR between them). */
export function coachQuery(text: string): string {
  const words = [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}.-]+/u)
        .filter((w) => w.length > 4),
    ),
  ];
  return words.slice(-24).join(" OR ").slice(0, QUERY_CHARS);
}

async function snippetsFor(ctx: AuthContext, query: string, selfId: string, deps: ServerDeps): Promise<CoachingSnippet[]> {
  if (!query) return [];
  try {
    const params = { queryText: query, queryEmbedding: null, matchCount: SNIPPETS + 2 };
    // API tokens run on the service role: the per-user RPC; sessions/JWTs: the auth.uid() one.
    const rows =
      ctx.mode === "api_token"
        ? await matchKnowledgeHybridForUser(ctx.client, ctx.userId, params)
        : await matchKnowledgeHybrid(ctx.client, params);
    return rows
      .filter((r) => r.item_id !== selfId)
      .slice(0, SNIPPETS)
      .map((r) => ({
        title: r.title,
        type: r.type,
        text: (r.summary ? `${r.summary}\n` : "") + (r.chunk_text ?? ""),
        page_or_timestamp: r.page_or_timestamp,
        item_id: r.item_id,
      }));
  } catch (err) {
    // Coaching without Second-Brain context is still useful.
    deps.log.error("coach snippets failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

async function openTasks(ctx: AuthContext): Promise<CoachingTask[]> {
  const { data } = await ctx.client
    .from("action_items")
    .select("title, assignee, due_date")
    .eq("user_id", ctx.userId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(15);
  return (data ?? []) as CoachingTask[];
}

export async function coachMeeting(deps: ServerDeps, ctx: AuthContext, itemId: string, windowMinutes = 5) {
  const row = await getItem(ctx.client, ctx.userId, itemId, ["id", "title", "type", "content_md", "metadata"]);
  const live = row ? liveMetaOf(row.metadata) : null;
  if (!row || row.type !== "meeting" || !live) throw notFound(t("Live meeting not found"));
  const transcript = (row.content_md ?? "").trim();
  if (!transcript) return { ok: true as const, cards: [] as CoachCard[], model: null, skipped: "no_transcript" as const };

  const names = { self: CHANNEL_NAMES[0], remote: CHANNEL_NAMES[1] };
  let segments;
  try {
    segments = parseMeetingTranscript(transcript, names).segments;
  } catch {
    return { ok: true as const, cards: [] as CoachCard[], model: null, skipped: "no_transcript" as const };
  }
  const recent = lastMinutes(segments, windowMinutes).map((s) => s.text).join(" ");

  const settings = await getUserSettings(ctx.client, ctx.userId);
  const models = deps.createModels(settings, await deps.loadCatalog());
  const [snippets, tasks] = await Promise.all([snippetsFor(ctx, coachQuery(recent), row.id, deps), openTasks(ctx)]);
  let bullets: string[];
  try {
    ({ bullets } = await generateCoaching(
      { transcript: segments, windowMinutes, snippets, openTasks: tasks, selfName: CHANNEL_NAMES[0], selfRole: process.env.KORTEX_COACH_ROLE },
      { models, task: "meeting_coach" },
    ));
  } catch (err) {
    deps.log.error("coaching failed", { error: err instanceof Error ? err.message : String(err) });
    throw new ApiError("server_error", t("Coaching is not available right now, please try again in a moment"), { status: 502, cause: err });
  }
  const cards = cardsFromBullets(bullets);
  const now = deps.now().toISOString();
  // Re-read: the desktop may have appended lines while the model answered.
  const fresh = (await getItem(ctx.client, ctx.userId, row.id, ["metadata"]))?.metadata ?? row.metadata;
  const current = liveMetaOf(fresh) ?? live;
  await updateItem(ctx.client, ctx.userId, row.id, {
    metadata: mergeJson(fresh, {
      live: { ...current, cards, coached_at: now, coached_segments: current.segments } as unknown as Json,
      // The shell's meeting card shows this line without a live session too.
      coaching: cards[0]?.text ?? null,
    }),
  });
  return { ok: true as const, cards, model: models.modelIds.chat ?? null };
}

export function createMeetingCoachHandlers(getDeps: DepsProvider) {
  return {
    POST: route(getDeps, async ({ request, auth, deps }) => {
      await enforceLimits({ auth, deps }, "chat_action");
      const body = CoachRequestSchema.parse(await readJson(request));
      return json(await coachMeeting(deps, auth, body.item_id, body.window_minutes));
    }),
    OPTIONS: preflight(getDeps),
  };
}
