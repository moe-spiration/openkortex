import { DOMAIN_OBJECT_TYPES, type KortexClient } from "@kortex/db";
import { addDays, localDate } from "./dates";

/*
 * What Life, Insights and the weekly review compute from: one user's recent items, all goal and
 * project objects, recent and open tasks, daily check-ins and saved digests. Every query runs
 * through the caller's client (the user's RLS session) and also filters by user_id. Pages past the
 * PostgREST 1000-row cap.
 */

export interface SourceItem {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  tags: string[];
  cluster: string | null;
  folder: string;
  slug: string;
  status: string;
  manual: boolean;
  platform: string;
  created: string;
  updated: string;
  metadata: Record<string, unknown>;
}

export interface SourceTask {
  id: string;
  title: string;
  done: boolean;
  due: string | null;
  completed: string | null;
  created: string;
  sourceItemId: string | null;
  priority: string;
}

export interface DailyHabit {
  key: string;
  label: string;
  done: boolean;
}

export interface DailyEntry {
  date: string;
  energy: number | null;
  habits: DailyHabit[];
  focusDone: number;
  focusTotal: number;
}

export interface LifeSource {
  /** "Today" in the user's zone. */
  today: string;
  timeZone: string;
  /** Non-daily items created or updated in the window, newest first (excludes digests). */
  items: SourceItem[];
  /** All goal and project objects. */
  goals: SourceItem[];
  /** Open tasks plus tasks completed or created in the window. */
  tasks: SourceTask[];
  /** One entry per daily note in the window, oldest first. */
  dailies: DailyEntry[];
  /** Saved weekly digests (90_Digests), newest first. */
  digests: SourceItem[];
  /** Life area labels from user_settings.custom_taxonomy (onboarding choice). */
  areaLabels: string[];
}

/** Days of history loaded (Insights compares 90 days against the 90 before). */
export const SOURCE_DAYS = 182;
const PAGE = 1000;
const MAX_ROWS = 20_000;

const ITEM_COLUMNS =
  "id,type,title,summary,tags,cluster_name,folder_path,slug,status,is_manual_placement,source_platform,created_at,updated_at,metadata" as const;

type ItemRow = {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  tags: string[] | null;
  cluster_name: string | null;
  folder_path: string;
  slug: string;
  status: string;
  is_manual_placement: boolean | null;
  source_platform: string;
  created_at: string;
  updated_at: string;
  metadata: unknown;
};

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export const toSourceItem = (r: ItemRow): SourceItem => ({
  id: r.id,
  type: r.type,
  title: r.title,
  summary: r.summary,
  tags: (r.tags ?? []).map((t) => t.replace(/^#+/, "").trim()).filter(Boolean),
  cluster: r.cluster_name,
  folder: r.folder_path,
  slug: r.slug,
  status: r.status,
  manual: Boolean(r.is_manual_placement),
  platform: r.source_platform,
  created: r.created_at,
  updated: r.updated_at,
  metadata: record(r.metadata),
});

/** Check-in fields from a daily note's metadata (lib/api/actions.ts saveDailyCheckin). */
export function toDailyEntry(date: string, metadata: unknown): DailyEntry {
  const c = record(record(metadata).checkin);
  const energy = typeof c.energy === "number" && c.energy >= 1 && c.energy <= 10 ? c.energy : null;
  const habits: DailyHabit[] = (Array.isArray(c.habits) ? c.habits : [])
    .map(record)
    .filter((h) => typeof h.key === "string" && typeof h.label === "string")
    .map((h) => ({ key: h.key as string, label: h.label as string, done: h.done === true }));
  const focus = (Array.isArray(c.focus) ? c.focus : [])
    .map(record)
    .filter((f) => typeof f.text === "string" && f.text);
  return {
    date,
    energy,
    habits,
    focusDone: focus.filter((f) => f.done === true).length,
    focusTotal: focus.length,
  };
}

async function paged<T>(
  what: string,
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

export async function loadLifeSource(
  client: KortexClient,
  userId: string,
  opts: { now: Date; timeZone: string; days?: number },
): Promise<LifeSource> {
  const today = localDate(opts.now, opts.timeZone);
  const since = new Date(
    Date.parse(`${addDays(today, -(opts.days ?? SOURCE_DAYS))}T00:00:00Z`),
  ).toISOString();
  const objects = DOMAIN_OBJECT_TYPES as readonly string[];

  const [items, goals, openTasks, recentTasks, dailies, digests, settings] = await Promise.all([
    paged<ItemRow>("load items", (a, b) =>
      client
        .from("knowledge_items")
        .select(ITEM_COLUMNS)
        .eq("user_id", userId)
        .not("type", "in", "(daily_note,digest)")
        .or(`created_at.gte.${since},updated_at.gte.${since}`)
        .order("updated_at", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    paged<ItemRow>("load goals", (a, b) =>
      client
        .from("knowledge_items")
        .select(ITEM_COLUMNS)
        .eq("user_id", userId)
        .in("type", ["goal", "project"])
        .order("updated_at", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    paged<TaskRow>("load open tasks", (a, b) =>
      client
        .from("action_items")
        .select(TASK_COLUMNS)
        .eq("user_id", userId)
        .not("status", "in", "(done,cancelled)")
        .order("id")
        .range(a, b),
    ),
    paged<TaskRow>("load recent tasks", (a, b) =>
      client
        .from("action_items")
        .select(TASK_COLUMNS)
        .eq("user_id", userId)
        .eq("status", "done")
        .or(`completed_at.gte.${since},created_at.gte.${since}`)
        .order("id")
        .range(a, b),
    ),
    paged<{ slug: string; metadata: unknown; created_at: string }>("load daily notes", (a, b) =>
      client
        .from("knowledge_items")
        .select("slug,metadata,created_at")
        .eq("user_id", userId)
        .eq("type", "daily_note")
        .gte("slug", addDays(today, -(opts.days ?? SOURCE_DAYS)))
        .order("slug")
        .range(a, b),
    ),
    paged<ItemRow>("load digests", (a, b) =>
      client
        .from("knowledge_items")
        .select(ITEM_COLUMNS)
        .eq("user_id", userId)
        .eq("type", "digest")
        .order("updated_at", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    client.from("user_settings").select("custom_taxonomy").eq("user_id", userId).maybeSingle(),
  ]);
  if (settings.error) throw new Error(`load settings: ${settings.error.message}`);

  const taxonomy = Array.isArray(settings.data?.custom_taxonomy)
    ? settings.data.custom_taxonomy
    : [];
  const areaLabels = taxonomy
    .map(record)
    .filter((e) => e.kind === "life_area" && typeof e.label === "string")
    .map((e) => e.label as string);

  return {
    today,
    timeZone: opts.timeZone,
    items: items.filter((r) => !objects.includes(r.type)).map(toSourceItem),
    goals: goals.map(toSourceItem),
    tasks: [...openTasks, ...recentTasks].map(toSourceTask),
    dailies: dailies
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.slug))
      .map((d) => toDailyEntry(d.slug, d.metadata)),
    digests: digests.map(toSourceItem),
    areaLabels,
  };
}

const TASK_COLUMNS =
  "id,title,status,due_date,completed_at,created_at,source_item_id,priority" as const;
type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  source_item_id: string | null;
  priority: string;
};

export const toSourceTask = (r: TaskRow): SourceTask => ({
  id: r.id,
  title: r.title,
  done: r.status === "done",
  due: r.due_date ? r.due_date.slice(0, 10) : null,
  completed: r.completed_at,
  created: r.created_at,
  sourceItemId: r.source_item_id,
  priority: r.priority,
});
