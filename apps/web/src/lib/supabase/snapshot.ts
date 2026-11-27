import type { KortexClient } from "@kortex/db";
import { thresholdOf } from "@/lib/placement";
import type { User } from "@supabase/supabase-js";
import { OBJECT_HUBS as HUB_DEFS } from "@/lib/mock/workspace";
import { buildSpaces } from "@/lib/spaces";
import type { ActionItem, KnowledgeItem } from "@/lib/mock/types";
import { isoToday, type WorkspaceSnapshot } from "@/lib/workspace-data";
import {
  buildVaultTree,
  countHubs,
  tagLabel,
  toActionItem,
  toInboxJob,
  toKnowledgeItem,
  localDateTime,
  toProfile,
  uiType,
  type ItemRow,
} from "./mapping";
import {
  activityHeat,
  addIsoDays,
  dailyStreak,
  inboxTargets,
  isReviewCandidate,
  toProposal,
  toTask,
  type ActionRow,
} from "./live-views";

/**
 * Items loaded with full content (most recently updated first), paged in PAGE-sized requests
 * (PostgREST caps one response at 1,000 rows). Counts cover the whole vault. Override with
 * KORTEX_SNAPSHOT_LIMIT (100..5000).
 */
export const SNAPSHOT_ITEM_LIMIT = 1500;
const PAGE = 500;

export function snapshotLimit(raw = process.env.KORTEX_SNAPSHOT_LIMIT): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 100 ? Math.min(Math.floor(n), 5000) : SNAPSHOT_ITEM_LIMIT;
}
const COUNT_LIMIT = 10_000;

/**
 * Items whose Markdown body is part of the snapshot: the most recently updated ones. Every other body is loaded when
 * its note opens (`loadItemBody`), so the snapshot (sent with every full load and every `router.refresh()`) stays a
 * fraction of the vault's text. Links and TL;DR are still computed from the full body on the server.
 */
export const HOT_BODIES = 200;
/** Types whose body the shell reads outside the note sheet (journal mind dump, sessions, dossiers): always sent. */
const ALWAYS_BODY = new Set(["daily_note", "session", "person", "project", "organization", "concept", "tool", "asset", "goal"]);

/** The item with its body dropped (bodyPending) unless it is hot or of a type the shell reads elsewhere. */
export function withLazyBody(item: KnowledgeItem, hot: ReadonlySet<string>): KnowledgeItem {
  if (hot.has(item.id) || !item.contentMd || ALWAYS_BODY.has(item.dbType ?? item.type)) return item;
  return { ...item, contentMd: "", bodyPending: true };
}

export const ITEM_COLUMNS =
  "id,user_id,type,title,slug,summary,content_md,source_url,file_storage_path,file_mime_type,file_size_bytes,reading_state,cover_image_url,icon,is_favorite,remind_at,folder_path,is_manual_placement,tags,related_item_ids,metadata,status,created_at,updated_at" as const;

const check = <T>(what: string, r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(`kortex snapshot: ${what}: ${r.error.message}`);
  return r.data as T;
};

/**
 * The signed-in user's workspace as the shell renders it. Every query runs through the user's
 * RLS session and additionally filters by user_id (multi-tenant rule).
 */
export async function loadSnapshot(
  client: KortexClient,
  user: User,
  timeZone: string,
): Promise<WorkspaceSnapshot> {
  const uid = user.id;
  const limit = snapshotLimit();
  const today = isoToday(timeZone);
  const heatFrom = new Date(Date.parse(addIsoDays(today, -84) + "T00:00:00Z")).toISOString();
  const [itemsR, typesR, foldersR, tagsR, actionsR, settingsR, dailyR, createdR] =
    await Promise.all([
      loadItemPages(client, uid, limit),
      client
        .from("knowledge_items")
        .select("type")
        .eq("user_id", uid)
        .neq("status", "archived")
        .range(0, COUNT_LIMIT - 1),
      client.from("folders").select("id,parent_id,name,folder_path,sort_order").eq("user_id", uid),
      client
        .from("tags")
        .select("name,usage_count")
        .eq("user_id", uid)
        .order("usage_count", { ascending: false })
        .limit(6),
      client
        .from("action_items")
        .select(
          "id,title,description,status,priority,due_date,assignee,source_item_id,source_timestamp_sec,created_at,project_item_id,timeframe,context,exported_at,external_ref",
        )
        .eq("user_id", uid)
        .neq("status", "cancelled")
        .order("created_at", { ascending: true })
        .limit(3000),
      client
        .from("user_settings")
        .select("subscription_tier,auto_place_threshold,locale")
        .eq("user_id", uid)
        .maybeSingle(),
      client
        .from("knowledge_items")
        .select("id,slug,metadata")
        .eq("user_id", uid)
        .eq("type", "daily_note")
        .neq("status", "archived")
        .order("slug", { ascending: false })
        .limit(400),
      client
        .from("knowledge_items")
        .select("created_at")
        .eq("user_id", uid)
        .gte("created_at", heatFrom)
        .range(0, COUNT_LIMIT - 1),
    ]);

  const rows = check("items", itemsR) as unknown as ItemRow[];
  const dbTypes = check("types", typesR).map((r) => r.type);
  const types = dbTypes.map(uiType);
  const folders = check("folders", foldersR);
  const tags = check("tags", tagsR);
  const actions = check("action items", actionsR) as ActionRow[];
  const settings = check("settings", settingsR);
  const dailyRows = check("daily notes", dailyR);
  const created = check("activity", createdR);

  const actionsBySource = new Map<string, ActionItem[]>();
  for (const a of actions) {
    if (!a.source_item_id) continue;
    const list = actionsBySource.get(a.source_item_id) ?? [];
    list.push(toActionItem(a));
    actionsBySource.set(a.source_item_id, list);
  }

  const ctx = {
    timeZone,
    idByTitle: new Map(rows.map((r) => [r.title.toLowerCase(), r.id])),
    ids: new Set(rows.map((r) => r.id)),
    actionsBySource,
  };
  // Newest first by creation for the lists; recency (updated_at) for "recently opened".
  const byCreated = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  // Bodies travel only for the items that are likely opened next; the rest load when opened (bodyPending).
  const hot = new Set(rows.slice(0, HOT_BODIES).map((r) => r.id));
  const items = byCreated.map((r) => withLazyBody(toKnowledgeItem(r, ctx), hot));
  const notes: KnowledgeItem[] = [];
  const objects: KnowledgeItem[] = [];
  for (const i of items) (i.type in OBJECT_TYPE_SET ? objects : notes).push(i);

  const dayOf = (r: { slug: string; metadata: unknown }) => {
    const d = (r.metadata as { date?: unknown } | null)?.date;
    return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)
      ? d
      : /^\d{4}-\d{2}-\d{2}$/.test(r.slug)
        ? r.slug
        : null;
  };
  // W5: the day's energy (1-10) from the check-in (metadata.checkin.energy, older notes: metadata.energy)
  // rides along for the 7-day history on Home. Extra field on the { id, date } entries.
  const energyOf = (r: { metadata: unknown }) => {
    const m = r.metadata as { energy?: unknown; checkin?: { energy?: unknown } | null } | null;
    const e = m?.checkin?.energy ?? m?.energy;
    return typeof e === "number" && Number.isInteger(e) && e >= 1 && e <= 10 ? e : null;
  };
  const dailyNotes = dailyRows
    .map((r) => ({ id: r.id, date: dayOf(r), energy: energyOf(r) }))
    .filter((d): d is { id: string; date: string; energy: number | null } => d.date !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
  const daily = dailyNotes.find((d) => d.date === today);
  const tree = buildVaultTree(folders);
  const openByPath = new Set(["10_Notes", "20_Meetings"]);

  const itemById = new Map(items.map((i) => [i.id, i]));
  const countByDay: Record<string, number> = {};
  for (const c of created) {
    const d = localDateTime(c.created_at, timeZone).date;
    countByDay[d] = (countByDay[d] ?? 0) + 1;
  }

  return {
    source: "supabase",
    userId: uid,
    locale: settings?.locale === "de" || settings?.locale === "en" ? settings.locale : null,
    today,
    profile: toProfile(user, settings?.subscription_tier),
    autoSpaces: buildSpaces(dbTypes),
    objectHubs: countHubs(HUB_DEFS, types),
    vaultTree: tree,
    vaultOpenDefault: Object.fromEntries(
      tree.filter((f) => f.depth === 0).map((f) => [f.id, openByPath.has(f.path)]),
    ),
    sidebarTags: tags.map((t) => tagLabel(t.name)),
    notes,
    objects,
    recentNoteIds: rows.slice(0, 4).map((r) => r.id),
    inboxActive: rows
      .filter((r) => r.status === "inbox" || r.status === "processing")
      .map(toInboxJob),
    dailyNoteId: daily?.id ?? null,
    tasks: actions.map((a) =>
      toTask(a, a.source_item_id ? itemById.get(a.source_item_id) : undefined, timeZone),
    ),
    inboxReview: notes
      .filter((i) => isReviewCandidate(i, today, thresholdOf(settings?.auto_place_threshold)))
      .map((i) => toProposal(i, (id) => itemById.get(id)?.title)),
    inboxTargets: inboxTargets(tree),
    dailyNotes,
    streak: dailyStreak(
      dailyNotes.map((d) => d.date),
      today,
    ),
    heat: activityHeat(countByDay, today),
  };
}

/**
 * The newest `limit` items, PAGE rows per request (stable order: updated_at desc, id). The pages are requested in
 * parallel (one round trip instead of three for the default limit); pages after the first short one are ignored.
 */
async function loadItemPages(
  client: KortexClient,
  uid: string,
  limit: number,
): Promise<{ data: ItemRow[] | null; error: { message: string } | null }> {
  const ranges: [number, number][] = [];
  for (let from = 0; from < limit; from += PAGE) ranges.push([from, Math.min(from + PAGE, limit) - 1]);
  const pages = await Promise.all(
    ranges.map(([from, to]) =>
      client
        .from("knowledge_items")
        .select(ITEM_COLUMNS)
        .eq("user_id", uid)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  );
  const rows: ItemRow[] = [];
  for (let i = 0; i < pages.length; i++) {
    const { data, error } = pages[i]!;
    if (error) return { data: null, error };
    const page = (data ?? []) as unknown as ItemRow[];
    rows.push(...page);
    const [from, to] = ranges[i]!;
    if (page.length < to - from + 1) break;
  }
  return { data: rows, error: null };
}

const OBJECT_TYPE_SET: Record<string, true> = {
  person: true,
  project: true,
  organization: true,
  concept: true,
  tool: true,
  asset: true,
  goal: true,
};
