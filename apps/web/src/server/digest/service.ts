import { byLocale } from "@kortex/i18n";
import { weekYearLabel } from "../life/dates";
import { t, tx } from "@/i18n";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  chunkDocument,
  embedTexts,
  modelFor,
  modelIdFor,
  slugify,
  type ModelRouter,
} from "@kortex/ai-core";
import { DOMAIN_OBJECT_TYPES, toPgVector, type KortexClient } from "@kortex/db";
import type { AuthContext } from "../auth";
import type { ServerDeps } from "../deps";
import { ensureFolderPath, insertItem, mergeJson, replaceChunks, updateItem } from "../repo";

export const DIGEST_FOLDER = "90_Digests";

export const DigestRequestSchema = z.object({
  /** Look-back window in days. */
  days: z.number().int().min(1).max(31).default(7),
  /** Only this cluster … */
  cluster: z.string().trim().min(1).max(200).optional(),
  /** … or only this folder (and its sub-folders). Without either: one digest per cluster. */
  folder_path: z.string().trim().min(1).max(300).optional(),
  /** Exact model id for this run (see chat modelSettingsFor); default: chat_reasoning route. */
  model: z.string().trim().min(1).max(200).optional(),
  /** Save as knowledge_items (type 'digest', 90_Digests). false = preview only. */
  save: z.boolean().default(true),
  max_groups: z.number().int().min(1).max(20).default(8),
});
export type DigestRequest = z.infer<typeof DigestRequestSchema>;

export const DigestOutputSchema = z.object({
  headline: z.string(),
  decisions: z.array(z.string()),
  progress: z.array(z.string()),
  blockers_risks: z.array(z.string()),
  next_week: z.array(z.string()),
});
export type DigestOutput = z.infer<typeof DigestOutputSchema>;

export interface DigestResult {
  item_id: string | null;
  title: string;
  group: string;
  folder_path: string;
  source_count: number;
  task_count: number;
  content_md: string;
  /** True when an existing digest for the same group and week was updated. */
  updated: boolean;
}

export interface DigestResponse {
  ok: true;
  period: { start: string; end: string; iso_week: string };
  digests: DigestResult[];
}

interface ActivityItem {
  id: string;
  title: string;
  type: string;
  summary: string | null;
  content_md: string;
  cluster_name: string | null;
  folder_path: string;
  updated_at: string;
}

interface ActivityTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee: string | null;
  completed_at: string | null;
  source_item_id: string | null;
}

interface Group {
  key: string;
  items: ActivityItem[];
  tasks: ActivityTask[];
}

/** ISO 8601 week, e.g. { year: 2026, week: 43 }. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7),
  };
}

/** Calendar date in the current language: "10/23/2026" / "23.10.2026". */
export const deDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return byLocale({ en: `${m}/${d}/${y}`, de: `${d}.${m}.${y}` });
};

export const EXCLUDED_TYPES = ["digest", ...DOMAIN_OBJECT_TYPES];
const groupKeyOf = (i: Pick<ActivityItem, "cluster_name" | "folder_path">) =>
  i.cluster_name && i.cluster_name !== "General"
    ? i.cluster_name
    : (i.folder_path.split("/")[0] ?? "00_Inbox");

async function loadActivity(
  c: KortexClient,
  userId: string,
  since: string,
  req: DigestRequest,
): Promise<Group[]> {
  let q = c
    .from("knowledge_items")
    .select("id,title,type,summary,content_md,cluster_name,folder_path,updated_at")
    .eq("user_id", userId)
    .gte("updated_at", since)
    .not("type", "in", `(${EXCLUDED_TYPES.join(",")})`)
    .order("updated_at", { ascending: false })
    .limit(400);
  if (req.cluster) q = q.eq("cluster_name", req.cluster);
  const { data, error } = await q;
  if (error) throw new Error(`load digest items: ${error.message}`);
  let items = (data ?? []) as ActivityItem[];
  if (req.folder_path) {
    const p = req.folder_path.replace(/\/+$/, "");
    items = items.filter((i) => i.folder_path === p || i.folder_path.startsWith(`${p}/`));
  }

  const taskCols = "id,title,status,priority,due_date,assignee,completed_at,source_item_id";
  const [created, completed] = await Promise.all([
    c
      .from("action_items")
      .select(taskCols)
      .eq("user_id", userId)
      .gte("created_at", since)
      .limit(400),
    c
      .from("action_items")
      .select(taskCols)
      .eq("user_id", userId)
      .gte("completed_at", since)
      .limit(400),
  ]);
  if (created.error || completed.error) throw new Error("load digest tasks failed");
  const tasks = new Map<string, ActivityTask>();
  for (const t of [
    ...((created.data ?? []) as ActivityTask[]),
    ...((completed.data ?? []) as ActivityTask[]),
  ])
    tasks.set(t.id, t);

  // Tasks belong to the group of their source item (which may be older than the window).
  type Source = Pick<ActivityItem, "id" | "cluster_name" | "folder_path">;
  const sources = new Map<string, Source>(items.map((i) => [i.id, i]));
  const missing = [
    ...new Set(
      [...tasks.values()]
        .map((t) => t.source_item_id)
        .filter((id): id is string => !!id && !sources.has(id)),
    ),
  ];
  if (missing.length > 0) {
    const { data: src } = await c
      .from("knowledge_items")
      .select("id,cluster_name,folder_path")
      .eq("user_id", userId)
      .in("id", missing);
    for (const s of (src ?? []) as Source[]) sources.set(s.id, s);
  }

  const scope = req.cluster ?? req.folder_path?.replace(/\/+$/, "");
  const inScope = (s: Source) =>
    req.cluster
      ? s.cluster_name === req.cluster
      : !scope || s.folder_path === scope || s.folder_path.startsWith(`${scope}/`);

  const groups = new Map<string, Group>();
  const groupFor = (key: string) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, items: [], tasks: [] }));
    return g;
  };
  for (const i of items) groupFor(scope ?? groupKeyOf(i)).items.push(i);
  for (const t of tasks.values()) {
    const src = t.source_item_id ? sources.get(t.source_item_id) : undefined;
    if (scope) {
      if (src && inScope(src)) groupFor(scope).tasks.push(t);
    } else {
      groupFor(src ? groupKeyOf(src) : tx("digest group", "General")).tasks.push(t);
    }
  }
  return [...groups.values()]
    .filter((g) => g.items.length > 0 || g.tasks.length > 0)
    .sort((a, b) => b.items.length + b.tasks.length - (a.items.length + a.tasks.length));
}

const DIGEST_PROMPT_LABELS = {
  en: { area: "Area", period: "Period", to: "to", due: "due", items: "Entries (meetings, notes, documents):", tasks: "Tasks:", none: "(none)" },
  de: { area: "Bereich", period: "Zeitraum", to: "bis", due: "fällig", items: "Einträge (Meetings, Notizen, Dokumente):", tasks: "Aufgaben:", none: "(keine)" },
};

function digestPrompt(group: Group, start: string, end: string): string {
  const l = byLocale(DIGEST_PROMPT_LABELS);
  const items = group.items.slice(0, 60).map((i) => {
    const body = (i.summary || i.content_md).replace(/\s+/g, " ").slice(0, 1_200);
    return `- [${i.type}] ${i.title} (${deDate(i.updated_at)}): ${body}`;
  });
  const tasks = group.tasks.slice(0, 80).map((t) => {
    const due = t.due_date ? `, ${l.due} ${deDate(t.due_date)}` : "";
    return `- [${t.status}] ${t.title} (${t.priority}${due}, ${t.assignee ?? "Me"})`;
  });
  return [
    `${l.area}: ${group.key}`,
    `${l.period}: ${deDate(start)} ${l.to} ${deDate(end)}`,
    "",
    l.items,
    ...(items.length ? items : [l.none]),
    "",
    l.tasks,
    ...(tasks.length ? tasks : [l.none]),
  ].join("\n");
}

const digestSystem = (): string =>
  byLocale({
    en: `You write the weekly management update (Weekly Project Digest) for the Second Brain Kortex.
Summarise only the entries and tasks you are given. Do not invent anything.
Return a JSON object:
- "headline": 1-2 sentences on the overall picture of the week.
- "decisions": decisions that were made.
- "progress": progress achieved and tasks completed.
- "blockers_risks": blockers, risks, overdue or critical tasks.
- "next_week": the most important priorities for next week.
Every point is a short, concrete sentence in English (unless the sources are clearly German). Empty arrays when there is nothing.`,
    de: `Du schreibst das wöchentliche Management-Update (Weekly Project Digest) für das Second Brain Kortex.
Fasse ausschließlich die gelieferten Einträge und Aufgaben zusammen. Erfinde nichts.
Liefere ein JSON-Objekt:
- "headline": 1-2 Sätze Gesamtbild der Woche.
- "decisions": getroffene Entscheidungen.
- "progress": erreichte Fortschritte und erledigte Aufgaben.
- "blockers_risks": Blocker, Risiken, überfällige oder kritische Aufgaben.
- "next_week": die wichtigsten Prioritäten für die nächste Woche.
Jeder Punkt ist ein kurzer, konkreter Satz auf Deutsch (außer die Quellen sind eindeutig englisch). Leere Arrays, wenn es nichts gibt.`,
  });

export function renderDigestMarkdown(
  group: Group,
  out: DigestOutput,
  period: { start: string; end: string; week: string },
): string {
  const section = (title: string, points: string[]) => [
    `## ${title}`,
    "",
    ...(points.length ? points.map((p) => `- ${p.trim()}`) : [`- ${tx("list", "None")}`]),
    "",
  ];
  return [
    `# Weekly Digest · ${group.key} · ${period.week}`,
    "",
    t("> Period {start} – {end} · {items} entries · {tasks} tasks", {
      start: deDate(period.start),
      end: deDate(period.end),
      items: group.items.length,
      tasks: group.tasks.length,
    }),
    "",
    out.headline.trim(),
    "",
    ...section(t("1. Decisions"), out.decisions),
    ...section(t("2. Progress"), out.progress),
    ...section(t("3. Blockers & risks"), out.blockers_risks),
    ...section(t("4. Priorities next week"), out.next_week),
    `## ${t("Sources")}`,
    "",
    ...(group.items.length
      ? group.items
          .slice(0, 40)
          .map((i) => `- [[${i.title}]] · ${i.type} · ${deDate(i.updated_at)}`)
      : [`- ${tx("list", "None")}`]),
  ]
    .join("\n")
    .trim();
}

/** Digests are searchable like any note; embedding is best-effort (chunks are kept either way). */
export async function indexDigestChunks(
  deps: ServerDeps,
  ctx: AuthContext,
  models: ModelRouter,
  id: string,
  title: string,
  content: string,
): Promise<void> {
  const chunks = chunkDocument({ title, type: "digest", contentMd: content });
  let vectors: number[][] | null = null;
  try {
    vectors = await embedTexts(
      chunks.map((ch) => ch.text),
      { model: models.embedding() },
    );
  } catch (err) {
    deps.log.error("digest embedding failed", err);
  }
  await replaceChunks(
    ctx.client,
    ctx.userId,
    id,
    chunks.map((ch, i) => ({
      item_id: id,
      user_id: ctx.userId,
      chunk_index: ch.index,
      chunk_heading: ch.heading,
      page_or_timestamp: null,
      chunk_text: ch.text,
      embedding: vectors?.[i] ? toPgVector(vectors[i]) : null,
    })),
  );
}

async function saveDigest(
  deps: ServerDeps,
  ctx: AuthContext,
  models: ModelRouter,
  group: Group,
  content: string,
  out: DigestOutput,
  meta: { start: string; end: string; week: string; slug: string; title: string; model: string },
): Promise<{ id: string; updated: boolean }> {
  const c = ctx.client;
  const folder = await ensureFolderPath(c, ctx.userId, DIGEST_FOLDER);
  const { data: existing } = await c
    .from("knowledge_items")
    .select("id,metadata")
    .eq("user_id", ctx.userId)
    .eq("type", "digest")
    .eq("slug", meta.slug)
    .limit(1);
  const prev = (existing ?? [])[0] as { id: string; metadata: unknown } | undefined;
  const isCluster = !group.key.match(/^\d{2}_/);
  const metadata = {
    period_start: meta.start,
    period_end: meta.end,
    iso_week: meta.week,
    group: group.key,
    source_item_count: group.items.length,
    task_count: group.tasks.length,
    model_used: meta.model,
  };
  const fields = {
    title: meta.title,
    summary: out.headline.trim() || null,
    content_md: content,
    folder_path: folder.folder_path,
    folder_id: folder.id,
    is_manual_placement: true,
    ...(isCluster ? { cluster_name: group.key } : {}),
    tags: ["digest/weekly"],
    related_item_ids: group.items.slice(0, 100).map((i) => i.id),
    status: "processed",
  };
  const id = prev?.id ?? deps.uuid();
  if (prev) {
    await updateItem(c, ctx.userId, id, {
      ...fields,
      metadata: mergeJson(prev.metadata as never, metadata),
    });
  } else {
    await insertItem(c, {
      id,
      user_id: ctx.userId,
      type: "digest",
      source_platform: "kortex",
      slug: meta.slug,
      icon: "newspaper",
      ...fields,
      metadata: mergeJson(null, metadata),
    });
  }

  await indexDigestChunks(deps, ctx, models, id, meta.title, content);
  return { id, updated: !!prev };
}

export async function generateDigests(
  deps: ServerDeps,
  ctx: AuthContext,
  req: DigestRequest,
  models: ModelRouter,
  /**
   * Routed task that writes the digest: chat_reasoning (POST /api/digest) or the cheaper
   * summarize (server cron, one call per group and week).
   */
  task: "chat_reasoning" | "summarize" = "chat_reasoning",
): Promise<DigestResponse> {
  const modelId = modelIdFor(models, task);
  const end = deps.now();
  const start = new Date(end.getTime() - req.days * 86_400_000);
  const { year, week } = isoWeek(end);
  const weekLabel = weekYearLabel(week, year);
  const period = {
    start: start.toISOString(),
    end: end.toISOString(),
    iso_week: `${year}-W${String(week).padStart(2, "0")}`,
  };

  const groups = (await loadActivity(ctx.client, ctx.userId, period.start, req)).slice(
    0,
    req.max_groups,
  );
  const digests: DigestResult[] = [];
  for (const group of groups) {
    const { output } = await generateText({
      model: modelFor(models, task),
      system: digestSystem(),
      prompt: digestPrompt(group, period.start, period.end),
      output: Output.object({ schema: DigestOutputSchema, name: "weekly_digest" }),
      temperature: 0.2,
    });
    const content = renderDigestMarkdown(group, output, {
      start: period.start,
      end: period.end,
      week: weekLabel,
    });
    const title = `Weekly Digest ${weekLabel} · ${group.key}`;
    const slug = `weekly-digest-${period.iso_week.toLowerCase()}-${slugify(group.key) || "allgemein"}`;
    let itemId: string | null = null;
    let updated = false;
    if (req.save) {
      const saved = await saveDigest(deps, ctx, models, group, content, output, {
        start: period.start,
        end: period.end,
        week: weekLabel,
        slug,
        title,
        model: modelId,
      });
      itemId = saved.id;
      updated = saved.updated;
    }
    digests.push({
      item_id: itemId,
      title,
      group: group.key,
      folder_path: DIGEST_FOLDER,
      source_count: group.items.length,
      task_count: group.tasks.length,
      content_md: content,
      updated,
    });
  }
  return { ok: true, period, digests };
}
