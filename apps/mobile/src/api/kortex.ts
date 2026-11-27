import "react-native-url-polyfill/auto";
import type { JobAutonomy, JobView, StandingOrderView } from "../lib/agentJobs";
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { localeHeader, t } from "../i18n";
import { createApiClient, INBOX_FOLDER, type ApiClient } from "./ingest";
import { fetchWithForm } from "./formFetch";
import { fetch as streamFetch } from "expo/fetch";
import { createChatStreamParser, type ChatAnswer } from "./chatStream";
import { instance, kortexUrl, setInstance } from "./config";
import type { Instance } from "./instance";
import { applyWatchPatch, parseWatch, type WatchPatch } from "@kortex/db/radar";
import { validateTypeMetadata } from "@kortex/db/type-registry";
import { mergeMeta } from "../data/meta";
import type { StatusResult } from "../data/status";
import { SETTINGS_COLUMNS, type InboundMail, type MobileSettings } from "../data/settings";
import { mergeDailyMarkdown } from "../data/dailyMerge";
import { DAILY_FOLDER, toDailyMarkdown, type DailyCheckin } from "../data/daily";
import type { DueItem } from "../notify/plan";
import { ITEM_COLUMNS, TASK_COLUMNS, type ItemRow, type LiveHome, type TaskRow, type LiveBackIn, type LiveLife } from "../data/live";
import { wikiLikePattern } from "../lib/links";
import { LIFE_PAGE_FOLDER } from "../lib/lifePage";
import type { AgentAction, AgentResult, AgentUndo, Autonomy, Skill } from "../lib/agent";

/*
 * Live connection: Supabase email/password sign-in (session in SecureStore), reads through RLS
 * in the `kortex` schema, and the Kortex API with the Supabase access token as bearer (the
 * server accepts it on every route; personal `kx_` tokens only work for /api/ingest).
 */

// SecureStore values are limited to ~2 KB, a Supabase session is larger: store it in chunks.
const CHUNK = 1800;
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const n = await SecureStore.getItemAsync(`${key}.n`);
    if (!n) return null;
    const parts = await Promise.all(Array.from({ length: Number(n) }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`)));
    return parts.some((p) => p === null) ? null : parts.join("");
  },
  async setItem(key: string, value: string): Promise<void> {
    const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, "g")) ?? [""];
    await Promise.all(parts.map((p, i) => SecureStore.setItemAsync(`${key}.${i}`, p)));
    await SecureStore.setItemAsync(`${key}.n`, String(parts.length));
  },
  async removeItem(key: string): Promise<void> {
    const n = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? 0);
    await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.deleteItemAsync(`${key}.${i}`)));
    await SecureStore.deleteItemAsync(`${key}.n`);
  },
};

// Storage key without ":" etc. (SecureStore allows [A-Za-z0-9._-]).
const STORAGE_KEY = "kortex.auth";

/** True once the app knows its server (baked into the build or entered on first start). */
export const isConfigured = () => instance() !== null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped client on the kortex schema
type Client = SupabaseClient<any, "kortex", "kortex">;
let sb: Client | undefined;
export function supabase(): Client {
  const at = instance();
  if (!at) throw new Error(t("No Kortex server set up"));
  sb ??= createClient(at.supabaseUrl, at.anonKey, {
    db: { schema: "kortex" },
    auth: {
      storage: Platform.OS === "web" ? undefined : secureStorage,
      storageKey: STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return sb;
}

// Refresh tokens only while the app is in the foreground (supabase-js recommendation for RN).
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (s) => {
    if (!isConfigured()) return;
    if (s === "active") void supabase().auth.startAutoRefresh();
    else void supabase().auth.stopAutoRefresh();
  });
}

/** Points the app at another instance (or none): the Supabase client is rebuilt on next use. */
export function switchInstance(next: Instance | null) {
  if (sb) void sb.auth.stopAutoRefresh();
  sb = undefined;
  setInstance(next);
}

export type SignInResult = { ok: true; session: Session } | { ok: false; error: string; noAccess?: boolean };

/** True when the account is on kortex.allowed_users (RPC as the user). */
export async function checkAllowed(): Promise<boolean> {
  const { data, error } = await supabase().rpc("is_allowed");
  if (error) throw new Error(error.message);
  return data === true;
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  if (!isConfigured()) return { ok: false, error: t("No Kortex server set up") };
  const { data, error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.session) {
    const msg = error?.message ?? t("Sign-in failed");
    return { ok: false, error: /invalid login/i.test(msg) ? t("Wrong email or password") : msg };
  }
  try {
    if (!(await checkAllowed())) {
      await supabase().auth.signOut();
      return { ok: false, error: t("No access: this account is not enabled for Kortex."), noAccess: true };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, session: data.session };
}

export const signOut = () => supabase().auth.signOut();

async function accessToken(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(t("Not signed in"));
  return token;
}

/** Bearer token plus the app language (`X-Kortex-Locale`), so the server answers in it. */
const authHeaders = async () => ({ Authorization: `Bearer ${await accessToken()}`, ...localeHeader() });

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";
  } catch {
    return "Europe/Berlin";
  }
};

/** Error text of a Kortex `{ ok: false, error: { message } }` response. */
async function failureOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  const e = body?.error;
  return (typeof e === "string" ? e : e?.message) ?? `HTTP ${res.status}`;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${kortexUrl()}${path}`, { headers: { ...(await authHeaders()) } });
  if (!res.ok) throw new Error(await failureOf(res));
  const body = (await res.json()) as { ok: boolean; data: T };
  return body.data;
}

async function sendJson<T>(method: "POST" | "PATCH", path: string, body: unknown): Promise<T> {
  const res = await fetch(`${kortexUrl()}${path}`, {
    method,
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await failureOf(res));
  return ((await res.json()) as { data: T }).data;
}

// --- agent jobs and standing orders (GET/POST /api/mobile/agent, same services as the web agent page) ---

export async function loadAgentJobs(): Promise<{ jobs: JobView[]; orders: StandingOrderView[] }> {
  return getJson("/api/mobile/agent");
}

export type AgentJobOp =
  | { op: "start"; prompt: string; title?: string; skill?: string; autonomy?: JobAutonomy; origin?: "manual" | "task" | "presort"; action_item_id?: string }
  | { op: "confirm"; id: string; picks?: number[] }
  | { op: "dismiss" | "undo" | "order_remove"; id: string }
  | { op: "order_add"; text: string }
  | { op: "order_toggle"; id: string; enabled: boolean };

export async function agentJobOp<T = unknown>(body: AgentJobOp): Promise<T> {
  return sendJson<T>("POST", "/api/mobile/agent", body);
}

/** Griply side of a life area (read only), as /api/mobile/griply answers it (web lib/griply GriplyArea). */
export interface GriplyArea {
  id: string;
  name: string;
  goals: { id: string; name: string; progress?: number; deadline?: string }[];
  projects: { id: string; name: string; progress?: number; deadline?: string }[];
  habits: { id: string; name: string; rate?: number }[];
}

export async function loadGriplyAreas(areas: { key: string; name: string }[]): Promise<{ state: "off" | "pending" | "connected"; areas: Record<string, GriplyArea | null> }> {
  const q = areas.map((a) => `area=${encodeURIComponent(`${a.key}:${a.name}`)}`).join("&");
  return getJson(`/api/mobile/griply?${q}`);
}

/** "An Griply geben" (like the web board): creates the task in Griply and marks it exported. */
export async function handOverTask(id: string): Promise<{ exported_at: string; external_ref: string }> {
  return sendJson("POST", "/api/mobile/griply", { op: "handover", id });
}

/** GET /api/reminders/due: reminders that have come and unseen radar changes (answers `{ items }`, no `data` wrapper). */
export async function loadDueReminders(): Promise<DueItem[]> {
  const res = await fetch(`${kortexUrl()}/api/reminders/due`, { headers: { ...(await authHeaders()) } });
  if (!res.ok) throw new Error(await failureOf(res));
  return ((await res.json()) as { items?: DueItem[] }).items ?? [];
}

/** Reminders up to `untilIso` (end of today), also those not yet due: /api/reminders/due only lists what has already come. */
export async function loadRemindersUntil(untilIso: string): Promise<DueItem[]> {
  const { data, error } = await supabase()
    .from("knowledge_items")
    .select("id,title,remind_at")
    .eq("user_id", await uid())
    .neq("status", "archived")
    .not("remind_at", "is", null)
    .lte("remind_at", untilIso)
    .order("remind_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; title: string; remind_at: string }[]).map((r) => ({ id: r.id, title: r.title, remind_at: r.remind_at, kind: "reminder" as const }));
}

/** Note editor: same server logic as the web editor (slug, folder, checklist → tasks). */
export const createNote = (title: string, contentMd: string, folderPath?: string, tags?: string[]) =>
  sendJson<{ id: string; path: string }>("POST", "/api/mobile/notes", { title, content_md: contentMd, ...(folderPath ? { folder_path: folderPath } : {}), ...(tags?.length ? { tags } : {}) });

/** The notes of the Life Areas folder (area pages and their subpages), for finding an area's page. */
export async function loadLifePages(): Promise<ItemRow[]> {
  const { data, error } = await supabase()
    .from("knowledge_items")
    .select(ITEM_COLUMNS)
    .eq("user_id", await uid())
    .eq("folder_path", LIFE_PAGE_FOLDER)
    .neq("status", "archived")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ItemRow[];
}
export const saveNote = (id: string, patch: { title?: string; content_md?: string }) =>
  sendJson<{ id: string }>("PATCH", `/api/mobile/notes?id=${encodeURIComponent(id)}`, patch);

/** One entry into the single scratchpad document (/api/scratchpad answers `{ ok, ... }`, not `{ data }`). */
export async function addScratchpad(text: string): Promise<void> {
  const res = await fetch(`${kortexUrl()}/api/scratchpad`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(await failureOf(res));
}

export interface ScratchEntry {
  id: string;
  /** `YYYY-MM-DD HH:mm` */
  at: string;
  text: string;
}

/** The scratchpad entries (GET /api/scratchpad answers `{ ok, item_id, entries }`, oldest first). */
export async function loadScratchpad(): Promise<{ item_id: string | null; entries: ScratchEntry[] }> {
  const res = await fetch(`${kortexUrl()}/api/scratchpad`, { headers: { ...(await authHeaders()) } });
  if (!res.ok) throw new Error(await failureOf(res));
  const body = (await res.json()) as { item_id?: string | null; entries?: ScratchEntry[] };
  return { item_id: body.item_id ?? null, entries: body.entries ?? [] };
}

// --- reads ---------------------------------------------------------------------------------------

export async function loadItems(limit = 200): Promise<ItemRow[]> {
  const { data: u } = await supabase().auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error(t("Not signed in"));
  const { data, error } = await supabase()
    .from("knowledge_items")
    .select(ITEM_COLUMNS)
    .eq("user_id", uid)
    .not("type", "in", "(daily_note,digest)")
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ItemRow[];
}

/** Few light rows for the "Einträge" home screen widget: newest, favourites or still in the inbox folder. */
export async function loadWidgetItems(source: "recent" | "favorites" | "inbox", limit = 25): Promise<ItemRow[]> {
  let q = supabase()
    .from("knowledge_items")
    // The inbox needs the placement (metadata) for its "Passt" suggestion; the other lists only the read mark.
    .select(`id,type,title,summary,content_md,status,is_favorite,created_at,read_at:metadata->>read_at${source === "inbox" ? ",metadata,folder_path,is_manual_placement" : ""}`)
    .eq("user_id", await uid())
    .not("type", "in", "(daily_note,digest)")
    .neq("status", "archived");
  if (source === "favorites") q = q.eq("is_favorite", true);
  if (source === "inbox") q = q.like("folder_path", `${INBOX_FOLDER}%`);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ItemRow[];
}

export const loadHome = () => getJson<{ backIn: LiveBackIn[] } & Partial<LiveHome>>(`/api/mobile/home?tz=${encodeURIComponent(tz())}`);
export const loadLife = () => getJson<LiveLife>(`/api/mobile/life?tz=${encodeURIComponent(tz())}`);

async function uid(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error(t("Not signed in"));
  return id;
}

/** Open and recently finished tasks (kortex.action_items, RLS). */
export async function loadTasks(): Promise<TaskRow[]> {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data, error } = await supabase()
    .from("action_items")
    .select(TASK_COLUMNS)
    .eq("user_id", await uid())
    .or(`status.in.(open,in_progress),completed_at.gte.${since}`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TaskRow[];
}

export async function setTaskDone(id: string, done: boolean): Promise<void> {
  const { error } = await supabase()
    .from("action_items")
    .update({ status: done ? "done" : "open", completed_at: done ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", await uid());
  if (error) throw new Error(error.message);
}

/** Project, timeframe or context of a task (patch already cleaned by `cleanTaskPatch`). */
export async function updateTask(
  id: string,
  patch: { project_item_id?: string | null; timeframe?: string | null; context?: string | null; due_date?: string | null; status?: "open" | "in_progress" | "done"; completed_at?: string | null; assignee?: string },
): Promise<void> {
  const { error } = await supabase().from("action_items").update(patch).eq("id", id).eq("user_id", await uid());
  if (error) throw new Error(error.message);
}

/** Sets or clears the "überführt" mark; returns the stored timestamp per id. */
export async function setTasksExported(ids: string[], on: boolean): Promise<Map<string, string | null>> {
  const { data, error } = await supabase()
    .from("action_items")
    .update({ exported_at: on ? new Date().toISOString() : null })
    .in("id", ids)
    .eq("user_id", await uid())
    .select("id,exported_at");
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { id: string; exported_at: string | null }[]).map((r) => [r.id, r.exported_at]));
}

export async function createTask(title: string): Promise<TaskRow> {
  const { data, error } = await supabase()
    .from("action_items")
    .insert({ user_id: await uid(), title: title.trim().slice(0, 300) })
    .select(TASK_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as TaskRow;
}

/** Archive, favourite or move an item. A move is a manual placement the organizer keeps. */
export async function updateItem(id: string, patch: { status?: "archived" | "processed"; is_favorite?: boolean; is_pinned?: boolean; folder_path?: string; tags?: string[]; remind_at?: string | null }): Promise<void> {
  const user = await uid();
  const body: Record<string, unknown> = { ...patch };
  if (patch.folder_path) {
    // Same pair the web writes: folder_id of the system folder plus its path.
    const { data: folder, error: ferr } = await supabase().from("folders").select("id").eq("user_id", user).eq("folder_path", patch.folder_path).maybeSingle();
    if (ferr) throw new Error(ferr.message);
    if (!folder) throw new Error(t("Folder {folder} is missing", { folder: patch.folder_path }));
    body.folder_id = (folder as { id: string }).id;
    body.is_manual_placement = true;
  }
  const { error } = await supabase().from("knowledge_items").update(body).eq("id", id).eq("user_id", user);
  if (error) throw new Error(error.message);
}

/** G4 Archiv: archived items, newest archive first (same query as the web's archive page). */
export async function loadArchived(limit = 300): Promise<ItemRow[]> {
  const { data, error } = await supabase()
    .from("knowledge_items")
    .select(ITEM_COLUMNS)
    .eq("user_id", await uid())
    .eq("status", "archived")
    .not("type", "in", "(daily_note,digest)")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ItemRow[];
}

/** Every folder path of the vault (kortex.folders), for the folder browser. */
export async function loadFolderPaths(): Promise<string[]> {
  const { data, error } = await supabase().from("folders").select("folder_path").eq("user_id", await uid()).limit(2000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { folder_path: string }[]).map((r) => r.folder_path);
}

/** The entries filed directly in one folder (not archived), newest first. */
export async function loadFolderItems(folderPath: string, limit = 300): Promise<ItemRow[]> {
  const { data, error } = await supabase()
    .from("knowledge_items")
    .select(ITEM_COLUMNS)
    .eq("user_id", await uid())
    .eq("folder_path", folderPath)
    .neq("status", "archived")
    .not("type", "in", "(daily_note,digest)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ItemRow[];
}

/**
 * Entries around one item across the whole vault (not only the loaded page): those whose Markdown links to
 * `[[title` (backlinks) and those named by `targets` (its own [[links]]). The caller sorts both directions apart.
 */
export async function loadLinkedItems(title: string, targets: string[]): Promise<ItemRow[]> {
  const user = await uid();
  const base = () => supabase().from("knowledge_items").select(ITEM_COLUMNS).eq("user_id", user).neq("status", "archived");
  const [back, out] = await Promise.all([
    title.trim() ? base().ilike("content_md", wikiLikePattern(title)).limit(60) : Promise.resolve({ data: [], error: null }),
    targets.length ? base().in("title", targets.slice(0, 50)).limit(60) : Promise.resolve({ data: [], error: null }),
  ]);
  if (back.error) throw new Error(back.error.message);
  if (out.error) throw new Error(out.error.message);
  return [...((back.data ?? []) as unknown as ItemRow[]), ...((out.data ?? []) as unknown as ItemRow[])];
}

/** One entry by its exact title (any case), for a `[[link]]` whose target is not loaded yet. */
export async function findItemByTitle(title: string): Promise<ItemRow | null> {
  const { data, error } = await supabase()
    .from("knowledge_items")
    .select(ITEM_COLUMNS)
    .eq("user_id", await uid())
    .ilike("title", title.trim().replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ItemRow[])[0] ?? null;
}

/**
 * Archives an item or brings it back, like the web's setArchived: the status before archiving is kept in
 * metadata.status_before_archive and restored on the way back (default `processed`).
 */
export async function setArchived(id: string, archived: boolean): Promise<void> {
  const user = await uid();
  const { data: cur, error: rerr } = await supabase().from("knowledge_items").select("status,metadata").eq("id", id).eq("user_id", user).maybeSingle();
  if (rerr) throw new Error(rerr.message);
  if (!cur) throw new Error(t("Entry not found"));
  const row = cur as { status: string; metadata: unknown };
  const meta: Record<string, unknown> = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? { ...(row.metadata as Record<string, unknown>) } : {};
  let status: string;
  if (archived) {
    if (row.status === "archived") return;
    meta.status_before_archive = row.status;
    status = "archived";
  } else {
    status = typeof meta.status_before_archive === "string" ? meta.status_before_archive : "processed";
    delete meta.status_before_archive;
  }
  const { error } = await supabase().from("knowledge_items").update({ status, metadata: meta }).eq("id", id).eq("user_id", user);
  if (error) throw new Error(error.message);
}

/** Marks an item read (metadata.read_at = now) or unread (key removed); returns the new metadata. */
export async function setRead(id: string, read: boolean): Promise<Record<string, unknown>> {
  const user = await uid();
  const { data: cur, error: rerr } = await supabase().from("knowledge_items").select("metadata").eq("id", id).eq("user_id", user).maybeSingle();
  if (rerr) throw new Error(rerr.message);
  if (!cur) throw new Error(t("Entry not found"));
  const m = (cur as { metadata: unknown }).metadata;
  const meta: Record<string, unknown> = m && typeof m === "object" && !Array.isArray(m) ? { ...(m as Record<string, unknown>) } : {};
  if (read) meta.read_at = new Date().toISOString();
  else delete meta.read_at;
  const { error } = await supabase().from("knowledge_items").update({ metadata: meta }).eq("id", id).eq("user_id", user);
  if (error) throw new Error(error.message);
  return meta;
}

/**
 * Eigenschaften: merges `patch` into metadata (null removes a key) after checking it against the type's
 * schema in the registry (lenient: adapter fields stay). Returns the stored metadata.
 */
export async function patchItemMetadata(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const user = await uid();
  const { data: cur, error: rerr } = await supabase().from("knowledge_items").select("type,metadata").eq("id", id).eq("user_id", user).maybeSingle();
  if (rerr) throw new Error(rerr.message);
  if (!cur) throw new Error(t("Entry not found"));
  const row = cur as { type: string; metadata: unknown };
  const merged = mergeMeta(row.metadata, patch);
  const checked = validateTypeMetadata(row.type, merged, { lenient: true });
  if (!checked.ok) throw new Error(checked.error);
  const { error } = await supabase().from("knowledge_items").update({ metadata: checked.metadata }).eq("id", id).eq("user_id", user);
  if (error) throw new Error(error.message);
  return checked.metadata;
}

/**
 * Delta radar on a watched page ("Gesehen", "Beobachten aus"), same rule as the web action patchWatch. Reads
 * metadata fresh, so a radar check that ran since the list was loaded is kept. Returns the stored metadata.
 */
export async function patchItemWatch(id: string, patch: WatchPatch): Promise<Record<string, unknown>> {
  const user = await uid();
  const { data: cur, error: rerr } = await supabase().from("knowledge_items").select("metadata").eq("id", id).eq("user_id", user).maybeSingle();
  if (rerr) throw new Error(rerr.message);
  if (!cur) throw new Error(t("Entry not found"));
  const m = (cur as { metadata: unknown }).metadata;
  const meta: Record<string, unknown> = m && typeof m === "object" && !Array.isArray(m) ? { ...(m as Record<string, unknown>) } : {};
  meta.watch = applyWatchPatch(parseWatch(meta), patch, new Date());
  const { error } = await supabase().from("knowledge_items").update({ metadata: meta }).eq("id", id).eq("user_id", user);
  if (error) throw new Error(error.message);
  return meta;
}

/** Removes the flashcard deck of a note (the note stays). */
export async function clearFlashcards(itemId: string): Promise<void> {
  const user = await uid();
  const { error } = await supabase().from("knowledge_items").update({ flashcards: null }).eq("id", itemId).eq("user_id", user);
  if (error) throw new Error(error.message);
}

/** Deletes items for good (the list waits for its undo window before calling this). */
export async function deleteItems(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const user = await uid();
  const { error } = await supabase().from("knowledge_items").delete().eq("user_id", user).in("id", ids);
  if (error) throw new Error(error.message);
}

// --- daily check-in (10_Notes/Daily/<date>.md, same as the web's saveDailyCheckin) ----------

export interface DailyLoad {
  /** metadata.checkin of today's note, if any. */
  stored: unknown;
  /** Dates of the last 90 days that have a check-in with energy. */
  days: string[];
  /** Energy 1-10 of those days, for the bars of the last days (like the web overview). */
  energies: Record<string, number>;
}

export async function loadDaily(date: string): Promise<DailyLoad> {
  const user = await uid();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const notes = await supabase()
      .from("knowledge_items")
      .select("slug,metadata")
      .eq("user_id", user)
      .eq("type", "daily_note")
      .eq("folder_path", DAILY_FOLDER)
      .gte("slug", since)
      .order("slug", { ascending: false })
      .limit(120);
  if (notes.error) throw new Error(notes.error.message);
  const rows = (notes.data ?? []) as { slug: string; metadata: { checkin?: { energy?: unknown } } | null }[];
  return {
    stored: rows.find((r) => r.slug === date)?.metadata?.checkin ?? null,
    days: rows.filter((r) => typeof r.metadata?.checkin?.energy === "number").map((r) => r.slug),
    energies: Object.fromEntries(rows.flatMap((r) => (typeof r.metadata?.checkin?.energy === "number" ? [[r.slug, r.metadata.checkin.energy]] : []))),
  };
}

export async function saveDaily(c: DailyCheckin): Promise<void> {
  const user = await uid();
  const { data: existing, error } = await supabase()
    .from("knowledge_items")
    .select("id,metadata,content_md")
    .eq("user_id", user)
    .eq("type", "daily_note")
    .eq("folder_path", DAILY_FOLDER)
    .eq("slug", c.date)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const prev = ((existing as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>;
  const metadata = { ...prev, date: c.date, checkin: c };
  const generated = toDailyMarkdown(c);
  if (existing) {
    // Only the check-in parts are replaced; the user's own text in the note survives.
    const content_md = mergeDailyMarkdown((existing as { content_md?: string | null }).content_md, generated);
    const { error: upErr } = await supabase().from("knowledge_items").update({ content_md, metadata }).eq("id", (existing as { id: string }).id).eq("user_id", user);
    if (upErr) throw new Error(upErr.message);
    return;
  }
  const { data: folder } = await supabase().from("folders").select("id").eq("user_id", user).eq("folder_path", DAILY_FOLDER).maybeSingle();
  const { error: insErr } = await supabase()
    .from("knowledge_items")
    .insert({
      user_id: user,
      type: "daily_note",
      source_platform: "manual",
      title: `Daily Journal ${c.date}`,
      slug: c.date,
      content_md: generated,
      folder_id: (folder as { id: string } | null)?.id ?? null,
      folder_path: DAILY_FOLDER,
      is_manual_placement: true,
      tags: ["daily"],
      metadata,
      status: "processed",
    });
  if (insErr) throw new Error(insErr.message);
}

// --- user settings (same row as the web settings) ----------------------------------------------

export async function loadSettings(): Promise<MobileSettings | null> {
  const { data, error } = await supabase().from("user_settings").select(SETTINGS_COLUMNS).eq("user_id", await uid()).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as MobileSettings | null) ?? null;
}

export async function patchSettings(patch: Partial<Pick<MobileSettings, "auto_tag_enabled" | "auto_cluster_enabled" | "locale">>): Promise<void> {
  const { error } = await supabase().from("user_settings").update(patch).eq("user_id", await uid());
  if (error) throw new Error(error.message);
}

/** Mail an Kortex address (read-only here; created and rotated in the web settings). */
export const loadInboundMail = () => getJson<InboundMail>("/api/ingest/mail");

// --- writes --------------------------------------------------------------------------------------

let ingestClient: ApiClient | undefined;
export function api(): ApiClient {
  ingestClient ??= createApiClient({
    getSettings: async () => ({ mockMode: false, baseUrl: kortexUrl(), token: await accessToken().catch(() => "") }),
    timeoutMs: 60_000,
  });
  return ingestClient;
}

/** /api/chat/transcribe answered 422: the recording holds no speech. Nothing is stored. */
export class NothingHeardError extends Error {
  constructor() {
    super(t("Nothing understood. Speak closer to the microphone and try again."));
    this.name = "NothingHeardError";
  }
}

/** Voice memo → text via /api/chat/transcribe (multipart `audio`; m4a/AAC is accepted). */
export async function transcribe(uri: string, mimeType = "audio/mp4"): Promise<string> {
  const form = new FormData();
  const ext = mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a" : mimeType.split("/")[1] ?? "audio";
  // React Native file part, sent through XMLHttpRequest (formFetch): Expo's fetch rejects such parts.
  form.append("audio", { uri, name: `sprachnotiz.${ext}`, type: mimeType } as unknown as Blob);
  const res = await fetchWithForm(`${kortexUrl()}/api/chat/transcribe`, {
    method: "POST",
    headers: { ...(await authHeaders()) },
    body: form,
  });
  if (res.status === 422) throw new NothingHeardError();
  if (!res.ok) throw new Error(await failureOf(res));
  const body = (await res.json()) as { text: string };
  return body.text;
}

/** Copilot status action (POST /api/chat/action): preview with save false, store with save true + item_id. */
export async function chatStatus(instruction: string, opts: { itemId?: string; save: boolean }): Promise<StatusResult> {
  const res = await fetch(`${kortexUrl()}/api/chat/action`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ action: "status", instruction, save: opts.save, ...(opts.itemId ? { item_id: opts.itemId } : {}) }),
  });
  if (!res.ok) throw new Error(await failureOf(res));
  return (await res.json()) as StatusResult;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Hybrid-RAG answer from /api/chat, streamed: `onUpdate` gets the answer so far after every chunk
 * (expo/fetch exposes the body as a stream; the plain RN fetch does not).
 */
export async function askKortex(
  messages: ChatTurn[],
  onUpdate?: (a: ChatAnswer) => void,
  itemId?: string,
  agent?: { autonomy: Autonomy; skill?: Skill },
): Promise<ChatAnswer> {
  const scope = itemId ? { messages, mode: "note", item_id: itemId } : { messages, mode: "brain" };
  const res = await streamFetch(`${kortexUrl()}/api/chat`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(agent ? { ...scope, agent: true, autonomy: agent.autonomy, ...(agent.skill ? { skill: agent.skill } : {}) } : scope),
  });
  if (!res.ok) throw new Error(await failureOf(res as unknown as Response));
  const parser = createChatStreamParser();
  const reader = res.body?.getReader();
  if (!reader) return parser.end();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onUpdate?.(parser.push(decoder.decode(value, { stream: true })));
  }
  return parser.end();
}

/** POST /api/chat/agent answers flat (`{ ok, op, results }`), without the usual `data` wrapper. */
async function agentCall<T>(body: unknown): Promise<T[]> {
  const res = await fetch(`${kortexUrl()}/api/chat/agent`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await failureOf(res));
  return ((await res.json()) as { results?: T[] }).results ?? [];
}

/** Agent: carries out the changes the user confirmed on a proposal (op execute), in order. */
export const agentExecute = (actions: AgentAction[]) => agentCall<AgentResult>({ op: "execute", actions });

/** Agent: takes changes back, last one first (a created note is archived, never deleted). */
export const agentUndo = (undo: AgentUndo[]) => agentCall<{ ok: boolean; error?: string }>({ op: "undo", undo });
