import { byLocale } from "@kortex/i18n";
import { intlLocale, t, tn } from "@/i18n";
import { generateText } from "ai";
import type { Json } from "@kortex/db";
import { z } from "zod";
import type { ModelRouter } from "@kortex/ai-core";
import {
  HOME_EXCLUDED_TYPES,
  loadMeeting,
  plainExcerpt,
  type HomeClock,
  type HomeCtx,
} from "./service";
import type { BriefingSummary, HomeBriefing, HomeBriefingTask, HomeMeeting } from "./types";

/*
 * Morning Briefing: one or two sentences from today's daily note, open tasks, recent items and
 * today's meeting, written by the user's `summarize` route (OpenRouter keeps data_collection:
 * 'deny', enforced in ai-core). The sentence is generated at most once per user and day: stored in
 * kortex.user_insights (kind 'briefing', key = day, see createDbBriefingCache) so it survives
 * restarts and is shared by all server processes; the client's localStorage copy is still adopted
 * when the DB has none. The task list under it is loaded fresh on every call.
 */

const RECENT_HOURS = 36;
const SHOWN_TASKS = 3;
const SUMMARY_MAX = 280;
/** A failed model call is retried after this long (the fallback sentence shows meanwhile). */
const FALLBACK_RETRY_MS = 15 * 60_000;

export interface BriefingTaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  source_item_id: string | null;
  source_timestamp_sec: number | null;
  created_at: string;
}

export interface BriefingInputs {
  daily: { energy: number | null; focus: string[]; text: string } | null;
  tasks: BriefingTaskRow[];
  recent: { title: string; type: string; summary: string }[];
  meeting: HomeMeeting | null;
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** Overdue / due today first, then priority, then newest. */
export function rankTasks(tasks: readonly BriefingTaskRow[], today: string): BriefingTaskRow[] {
  const dueRank = (t: BriefingTaskRow) =>
    t.due_date ? (t.due_date.slice(0, 10) <= today ? 0 : 1) : 2;
  return [...tasks].sort(
    (a, b) =>
      dueRank(a) - dueRank(b) ||
      (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
      (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) ||
      b.created_at.localeCompare(a.created_at),
  );
}

export async function loadBriefingInputs(ctx: HomeCtx, clock: HomeClock): Promise<BriefingInputs> {
  const { client, userId } = ctx;
  const since = new Date(clock.now.getTime() - RECENT_HOURS * 3_600_000).toISOString();
  const [daily, tasks, recent, meeting] = await Promise.all([
    client
      .from("knowledge_items")
      .select("content_md,metadata")
      .eq("user_id", userId)
      .eq("type", "daily_note")
      .eq("slug", clock.today)
      .maybeSingle(),
    client
      .from("action_items")
      .select("id,title,status,priority,due_date,source_item_id,source_timestamp_sec,created_at")
      .eq("user_id", userId)
      .in("status", ["open", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(60),
    client
      .from("knowledge_items")
      .select("title,type,summary,content_md")
      .eq("user_id", userId)
      .not("type", "in", `(${HOME_EXCLUDED_TYPES.join(",")})`)
      .not("status", "in", "(error,archived)")
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(10),
    loadMeeting(ctx, clock).catch(() => null),
  ]);
  if (tasks.error) throw new Error(`briefing tasks: ${tasks.error.message}`);
  if (recent.error) throw new Error(`briefing items: ${recent.error.message}`);
  let dailyIn: BriefingInputs["daily"] = null;
  if (daily.data) {
    const c = rec(rec(daily.data.metadata).checkin);
    const focus = (Array.isArray(c.focus) ? c.focus : [])
      .filter((f) => !rec(f).done)
      .map((f) => String(rec(f).text ?? "").trim())
      .filter(Boolean);
    dailyIn = {
      energy: typeof c.energy === "number" ? c.energy : null,
      focus,
      text: plainExcerpt(daily.data.content_md, 800),
    };
  }
  return {
    daily: dailyIn,
    tasks: rankTasks((tasks.data ?? []) as BriefingTaskRow[], clock.today),
    recent: (
      (recent.data ?? []) as {
        title: string;
        type: string;
        summary: string | null;
        content_md: string;
      }[]
    ).map((r) => ({
      title: r.title,
      type: r.type,
      summary: plainExcerpt(r.summary || r.content_md, 200),
    })),
    meeting,
  };
}

export const hasBriefingContent = (i: BriefingInputs) =>
  i.tasks.length > 0 ||
  i.recent.length > 0 ||
  !!i.meeting ||
  !!(i.daily && (i.daily.focus.length || i.daily.text));

/** Shown while the vault has nothing to brief on (in the current language). */
export const templateSummary = (): string =>
  t("Still quiet here. Drop a thought, a link or a PDF into the Inbox, Kortex sorts out the rest.");

/** Plain sentence from the counts (no model). */
export function fallbackSummary(i: BriefingInputs): string {
  const parts: string[] = [];
  if (i.meeting) parts.push(t("Meeting “{title}”", { title: i.meeting.title }));
  if (i.tasks.length) parts.push(tn(i.tasks.length, "{n} open task", "{n} open tasks"));
  if (i.recent.length) parts.push(tn(i.recent.length, "{n} new entry since yesterday", "{n} new entries since yesterday"));
  if (i.daily?.focus.length) parts.push(t("Focus: {focus}", { focus: i.daily.focus[0] ?? "" }));
  return parts.length ? `${parts.join(", ")}.` : templateSummary();
}

const fmtDue = (d: string) =>
  byLocale({ en: `${d.slice(5, 7)}/${d.slice(8, 10)}`, de: `${d.slice(8, 10)}.${d.slice(5, 7)}.` });

/** System prompt of the morning briefing in the current language. */
export const briefingSystem = (): string =>
  byLocale({
    en: [
      "You write the morning briefing for Kortex, a personal Second Brain.",
      'Answer in English, addressing the user directly as "you".',
      "summary: one or two short sentences, at most 220 characters. Concrete: appointments, the most important tasks, the focus of the day.",
      "No greeting, no platitudes, no Markdown, no emojis, do not invent anything.",
      "task_ids: up to 3 IDs of the most important open tasks, the most important first, only IDs from the list.",
      'Answer only with JSON: {"summary": "…", "task_ids": ["…"]}',
    ],
    de: [
      "Du schreibst das Morning Briefing für Kortex, ein persönliches Second Brain.",
      "Antworte auf Deutsch in der Du-Form.",
      "summary: ein bis zwei kurze Sätze, höchstens 220 Zeichen. Konkret: Termine, die wichtigsten Aufgaben, der Fokus des Tages.",
      "Keine Begrüßung, keine Floskeln, kein Markdown, keine Emojis, nichts erfinden.",
      "task_ids: bis zu 3 IDs der wichtigsten offenen Aufgaben, die wichtigste zuerst, nur IDs aus der Liste.",
      'Antworte nur mit JSON: {"summary": "…", "task_ids": ["…"]}',
    ],
  }).join("\n");

const PROMPT_LABELS = {
  en: {
    today: "Today",
    meeting: "Meeting today",
    with: "with",
    energy: "Energy",
    focus: "Focus",
    tasks: "Open tasks:",
    due: "due",
    priority: "priority",
    recent: "New or edited since yesterday:",
  },
  de: {
    today: "Heute",
    meeting: "Meeting heute",
    with: "mit",
    energy: "Energie",
    focus: "Fokus",
    tasks: "Offene Aufgaben:",
    due: "fällig",
    priority: "Priorität",
    recent: "Neu oder bearbeitet seit gestern:",
  },
};

export function briefingPrompt(i: BriefingInputs, clock: HomeClock): string {
  const day = new Date(`${clock.today}T12:00:00Z`).toLocaleDateString(intlLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const l = byLocale(PROMPT_LABELS);
  const lines = [`${l.today}: ${day}`];
  if (i.meeting)
    lines.push(
      "",
      `${l.meeting}: ${i.meeting.title}${i.meeting.people.length ? ` (${l.with} ${i.meeting.people.join(", ")})` : ""}`,
    );
  if (i.daily) {
    lines.push("", "Daily Note:");
    if (i.daily.energy !== null) lines.push(`${l.energy}: ${i.daily.energy}/10`);
    if (i.daily.focus.length) lines.push(`${l.focus}: ${i.daily.focus.join("; ")}`);
    if (i.daily.text) lines.push(i.daily.text);
  }
  if (i.tasks.length) {
    lines.push("", l.tasks);
    for (const task of i.tasks.slice(0, 20))
      lines.push(
        `- [${task.id}] ${task.title}${task.due_date ? ` (${l.due} ${fmtDue(task.due_date)})` : ""}${task.priority === "high" || task.priority === "urgent" ? ` (${l.priority} ${task.priority})` : ""}`,
      );
  }
  if (i.recent.length) {
    lines.push("", l.recent);
    for (const r of i.recent)
      lines.push(`- [${r.type}] ${r.title}${r.summary ? `: ${r.summary}` : ""}`);
  }
  return lines.join("\n");
}

const BriefingOutputSchema = z.object({ summary: z.string(), task_ids: z.array(z.string()) });

export function cleanSummary(s: string): string {
  const t = s
    .replace(/[*_`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length <= SUMMARY_MAX ? t : `${t.slice(0, SUMMARY_MAX - 1).replace(/\s+\S*$/, "")}…`;
}

/**
 * The model's answer → summary + task ids. Cheap routes don't all honour structured output, so
 * JSON is read leniently (also inside a code fence) and plain prose is taken as the summary.
 */
export function parseBriefingAnswer(text: string): { summary: string; task_ids: string[] } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = BriefingOutputSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
      if (parsed.success) return parsed.data;
    } catch {
      /* not JSON: prose below */
    }
  }
  const prose = text.replace(/```[a-z]*/gi, "").trim();
  return { summary: prose.startsWith("{") ? "" : prose, task_ids: [] };
}

export async function generateBriefingText(
  models: ModelRouter,
  i: BriefingInputs,
  clock: HomeClock,
): Promise<{ summary: string; taskIds: string[] }> {
  const { text } = await generateText({
    model: models.fast(),
    system: briefingSystem(),
    prompt: briefingPrompt(i, clock),
    temperature: 0.3,
    // Room for reasoning models that spend output tokens before they answer.
    maxOutputTokens: 1200,
  });
  const out = parseBriefingAnswer(text);
  const known = new Set(i.tasks.map((t) => t.id));
  const summary = cleanSummary(out.summary);
  if (!summary) throw new Error("empty briefing");
  return {
    summary,
    taskIds: [...new Set(out.task_ids)].filter((id) => known.has(id)).slice(0, SHOWN_TASKS),
  };
}

const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${String(m).padStart(2, "0")}:${r}`;
};

/** The model's picks first (when still open), then the default ranking. */
export function shownTasks(
  tasks: readonly BriefingTaskRow[],
  taskIds: readonly string[],
): HomeBriefingTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const picked = taskIds.map((id) => byId.get(id)).filter((t): t is BriefingTaskRow => !!t);
  const rest = tasks.filter((t) => !taskIds.includes(t.id));
  return [...picked, ...rest].slice(0, SHOWN_TASKS).map((t) => ({
    id: t.id,
    text: t.title,
    ts:
      t.source_timestamp_sec !== null && t.source_timestamp_sec !== undefined
        ? mmss(t.source_timestamp_sec)
        : null,
    due: t.due_date ? t.due_date.slice(0, 10) : null,
    sourceItemId: t.source_item_id,
  }));
}

// --- per-day cache ----------------------------------------------------------------------------------

const MAX_CACHE = 2000;
/** Days of briefings kept per user in kortex.user_insights. */
export const BRIEFING_KEEP_DAYS = 14;

export interface BriefingCache {
  get(ctx: HomeCtx, date: string): Promise<BriefingSummary | undefined>;
  set(ctx: HomeCtx, s: BriefingSummary): Promise<void>;
  /** One generation per user and day at a time in this process (StrictMode double effects, two tabs). */
  once(
    userId: string,
    date: string,
    make: () => Promise<BriefingSummary>,
  ): Promise<BriefingSummary>;
}

function inflightGuard() {
  const inflight = new Map<string, Promise<BriefingSummary>>();
  return (userId: string, date: string, make: () => Promise<BriefingSummary>) => {
    const k = `${userId}:${date}`;
    let p = inflight.get(k);
    if (!p) {
      p = make().finally(() => inflight.delete(k));
      inflight.set(k, p);
    }
    return p;
  };
}

/** Process memory only (tests, mock mode). */
export function createBriefingCache(): BriefingCache {
  const entries = new Map<string, BriefingSummary>();
  const key = (userId: string, date: string) => `${userId}:${date}`;
  return {
    get: async (ctx, date) => entries.get(key(ctx.userId, date)),
    async set(ctx, s) {
      if (entries.size >= MAX_CACHE) entries.clear();
      entries.set(key(ctx.userId, s.date), s);
    },
    once: inflightGuard(),
  };
}

const minusDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/**
 * kortex.user_insights (kind 'briefing', key = YYYY-MM-DD) through the user's own client (RLS)
 * plus an explicit user_id filter. A small memory layer saves the read on repeated calls.
 */
export function createDbBriefingCache(): BriefingCache {
  const memory = createBriefingCache();
  return {
    async get(ctx, date) {
      const hit = await memory.get(ctx, date);
      if (hit) return hit;
      const { data, error } = await ctx.client
        .from("user_insights")
        .select("payload")
        .eq("user_id", ctx.userId)
        .eq("kind", "briefing")
        .eq("key", date)
        .maybeSingle();
      if (error) throw new Error(`load briefing: ${error.message}`);
      const s = data ? adoptStored(data.payload, date) : null;
      if (s) await memory.set(ctx, s);
      return s ?? undefined;
    },
    async set(ctx, s) {
      await memory.set(ctx, s);
      const { error } = await ctx.client
        .from("user_insights")
        .upsert(
          { user_id: ctx.userId, kind: "briefing", key: s.date, payload: s as unknown as Json },
          { onConflict: "user_id,kind,key" },
        );
      if (error) throw new Error(`save briefing: ${error.message}`);
      await ctx.client
        .from("user_insights")
        .delete()
        .eq("user_id", ctx.userId)
        .eq("kind", "briefing")
        .lt("key", minusDays(s.date, BRIEFING_KEEP_DAYS));
    },
    once: inflightGuard(),
  };
}

/** A stored row back into a summary (any kind; the stale rules in getBriefing decide on reuse). */
function adoptStored(c: unknown, date: string): BriefingSummary | null {
  const r = rec(c);
  if (
    r.date !== date ||
    typeof r.summary !== "string" ||
    !["ai", "template", "fallback"].includes(String(r.kind))
  )
    return null;
  return {
    date,
    summary: r.summary,
    taskIds: Array.isArray(r.taskIds)
      ? r.taskIds.filter((x): x is string => typeof x === "string").slice(0, SHOWN_TASKS)
      : [],
    kind: r.kind as BriefingSummary["kind"],
    model: typeof r.model === "string" ? r.model : null,
    generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : new Date(0).toISOString(),
  };
}

/** A client copy is only trusted for its own day and only as model output (template/fallback are free to redo). */
export function adoptClientCopy(c: unknown, date: string): BriefingSummary | null {
  const r = rec(c);
  if (r.date !== date || r.kind !== "ai" || typeof r.summary !== "string" || !r.summary.trim())
    return null;
  return {
    date,
    summary: cleanSummary(r.summary),
    taskIds: Array.isArray(r.taskIds)
      ? r.taskIds.filter((x): x is string => typeof x === "string").slice(0, SHOWN_TASKS)
      : [],
    kind: "ai",
    model: typeof r.model === "string" ? r.model.slice(0, 200) : null,
    generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : new Date().toISOString(),
  };
}

export interface BriefingOptions {
  cache: BriefingCache;
  /** Router of the user's ADR-06 routing; throws when no provider key is set. */
  models: () => Promise<ModelRouter>;
  clientCopy?: unknown;
  log?: (message: string, err?: unknown) => void;
}

const modelLabel = (models: ModelRouter) => {
  const r = models.route?.("summarize");
  return r ? `${r.provider}:${r.modelId}` : models.modelIds.fast;
};

export async function getBriefing(
  ctx: HomeCtx,
  clock: HomeClock,
  opts: BriefingOptions,
): Promise<HomeBriefing> {
  const inputs = await loadBriefingInputs(ctx, clock);
  const content = hasBriefingContent(inputs);
  const date = clock.today;

  let summary = await opts.cache.get(ctx, date).catch((err: unknown) => {
    opts.log?.("briefing cache read failed", err);
    return undefined;
  });
  if (!summary) {
    const adopted = adoptClientCopy(opts.clientCopy, date);
    if (adopted)
      await opts.cache
        .set(ctx, adopted)
        .catch((err: unknown) => opts.log?.("briefing cache write failed", err));
    summary = adopted ?? undefined;
  }
  const stale =
    !summary ||
    (summary.kind === "template" && content) ||
    (summary.kind === "fallback" &&
      clock.now.getTime() - Date.parse(summary.generatedAt) > FALLBACK_RETRY_MS);

  if (stale) {
    summary = await opts.cache.once(ctx.userId, date, async () => {
      const at = clock.now.toISOString();
      let s: BriefingSummary;
      if (!content) {
        s = {
          date,
          summary: templateSummary(),
          taskIds: [],
          kind: "template",
          model: null,
          generatedAt: at,
        };
      } else {
        try {
          const models = await opts.models();
          const out = await generateBriefingText(models, inputs, clock);
          s = {
            date,
            summary: out.summary,
            taskIds: out.taskIds,
            kind: "ai",
            model: modelLabel(models),
            generatedAt: at,
          };
        } catch (err) {
          opts.log?.("briefing generation failed", err);
          s = {
            date,
            summary: fallbackSummary(inputs),
            taskIds: [],
            kind: "fallback",
            model: null,
            generatedAt: at,
          };
        }
      }
      await opts.cache
        .set(ctx, s)
        .catch((err: unknown) => opts.log?.("briefing cache write failed", err));
      return s;
    });
  }

  const s = summary!;
  const tasks = shownTasks(inputs.tasks, s.taskIds);
  const noteId = inputs.meeting?.id ?? tasks.find((t) => t.sourceItemId)?.sourceItemId ?? null;
  return {
    ...s,
    tasks,
    openTaskCount: inputs.tasks.length,
    noteId,
    noteIsMeeting: !!inputs.meeting,
  };
}
