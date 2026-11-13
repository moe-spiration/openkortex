import { t } from "@/i18n";
import {
  type ExistingObject,
  type IngestContext,
  type ItemChunkInsert,
  type ActionItemInsert,
  slugify,
} from "@kortex/ai-core";
import {
  DOMAIN_OBJECT_TYPES,
  syncSourceTasks,
  type Insert,
  type Json,
  type KortexClient,
  type Row,
  type Update,
  type UserSettings,
} from "@kortex/db";
import { ApiError } from "./api-error";

// Data access for the API routes. Every query filters by user_id explicitly: RLS covers
// session/JWT callers, but the API-token path uses the service role and relies on these filters.

type ItemRow = Row<"knowledge_items">;

const fail = (what: string, error: { message: string } | null): never => {
  throw new ApiError("server_error", `${what}: ${error?.message ?? "unknown error"}`, {
    cause: error,
  });
};

export async function getItem<K extends keyof ItemRow>(
  c: KortexClient,
  userId: string,
  id: string,
  columns: readonly K[],
): Promise<Pick<ItemRow, K> | null> {
  const { data, error } = await c
    .from("knowledge_items")
    .select(columns.join(","))
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("load item", error);
  return data as unknown as Pick<ItemRow, K> | null;
}

export async function findItemBySourceUrl<K extends keyof ItemRow>(
  c: KortexClient,
  userId: string,
  url: string,
  columns: readonly K[],
  type?: string,
): Promise<Pick<ItemRow, K> | null> {
  let q = c
    .from("knowledge_items")
    .select(columns.join(","))
    .eq("user_id", userId)
    .eq("source_url", url);
  if (type) q = q.eq("type", type);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(1);
  if (error) fail("find item by url", error);
  return ((data as unknown as Pick<ItemRow, K>[] | null) ?? [])[0] ?? null;
}

export async function insertItem(c: KortexClient, row: Insert<"knowledge_items">): Promise<void> {
  const { error } = await c.from("knowledge_items").insert(row);
  if (error) fail("insert item", error);
}

export async function updateItem(
  c: KortexClient,
  userId: string,
  id: string,
  patch: Update<"knowledge_items">,
): Promise<void> {
  const { error } = await c
    .from("knowledge_items")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", id);
  if (error) fail("update item", error);
}

// --- Folders -------------------------------------------------------------------------------

export interface FolderRef {
  id: string;
  folder_path: string;
}

export async function listFolders(c: KortexClient, userId: string): Promise<FolderRef[]> {
  const { data, error } = await c.from("folders").select("id,folder_path").eq("user_id", userId);
  if (error) fail("list folders", error);
  return (data ?? []) as FolderRef[];
}

/** "10_Notes//Automotive/" → "10_Notes/Automotive". Rejects `..` and empty paths. */
export function normalizeFolderPath(path: string): string {
  const segments = path
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0 || segments.some((s) => s === "." || s === "..")) {
    throw new ApiError("invalid_request", t("Invalid folder path: {path}", { path }));
  }
  return segments.join("/");
}

/** Returns the folder for `path`, creating missing parents (manual placement or AI sub-folders). */
export async function ensureFolderPath(
  c: KortexClient,
  userId: string,
  path: string,
): Promise<FolderRef> {
  const target = normalizeFolderPath(path);
  const existing = new Map((await listFolders(c, userId)).map((f) => [f.folder_path, f]));
  const segments = target.split("/");
  let parent: FolderRef | undefined;
  for (let i = 0; i < segments.length; i++) {
    const folderPath = segments.slice(0, i + 1).join("/");
    let folder = existing.get(folderPath);
    if (!folder) {
      const name = segments[i] as string;
      const { data, error } = await c
        .from("folders")
        .insert({
          user_id: userId,
          parent_id: parent?.id ?? null,
          name,
          slug: slugify(name) || "ordner",
          folder_path: folderPath,
        })
        .select("id,folder_path")
        .single();
      if (error) {
        // Created concurrently (unique user_id + folder_path): read it back.
        const again = (await listFolders(c, userId)).find((f) => f.folder_path === folderPath);
        if (!again) fail("create folder", error);
        folder = again;
      } else {
        folder = data as FolderRef;
      }
      existing.set(folderPath, folder as FolderRef);
    }
    parent = folder;
  }
  return parent as FolderRef;
}

// --- Tags ----------------------------------------------------------------------------------

/** Upserts tags and bumps usage_count (no RPC exists for an atomic increment; fine for MVP). */
export async function bumpTags(
  c: KortexClient,
  userId: string,
  names: readonly string[],
  isManual = false,
): Promise<void> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return;
  const { data, error } = await c
    .from("tags")
    .select("id,name,usage_count")
    .eq("user_id", userId)
    .in("name", unique);
  if (error) fail("load tags", error);
  const found = new Map(
    ((data ?? []) as Array<{ id: string; name: string; usage_count: number | null }>).map((t) => [
      t.name,
      t,
    ]),
  );
  for (const name of unique) {
    const tag = found.get(name);
    if (tag) {
      const res = await c
        .from("tags")
        .update({ usage_count: (tag.usage_count ?? 0) + 1 })
        .eq("user_id", userId)
        .eq("id", tag.id);
      if (res.error) fail("update tag", res.error);
    } else {
      const res = await c
        .from("tags")
        .upsert(
          { user_id: userId, name, usage_count: 1, is_manual: isManual },
          { onConflict: "user_id,name" },
        );
      if (res.error) fail("insert tag", res.error);
    }
  }
}

// --- Chunks, tasks, highlights --------------------------------------------------------------

export async function replaceChunks(
  c: KortexClient,
  userId: string,
  itemId: string,
  chunks: readonly ItemChunkInsert[],
): Promise<void> {
  const del = await c.from("item_chunks").delete().eq("user_id", userId).eq("item_id", itemId);
  if (del.error) fail("delete chunks", del.error);
  for (let i = 0; i < chunks.length; i += 100) {
    const { error } = await c
      .from("item_chunks")
      .insert(chunks.slice(i, i + 100) as ItemChunkInsert[]);
    if (error) fail("insert chunks", error);
  }
}

/**
 * Re-processing an item syncs its extracted tasks with stable identity (@kortex/db `syncSourceTasks`):
 * known tasks keep their id and edits, new ones are added, untouched obsolete open ones removed.
 */
export async function replaceOpenActionItems(
  c: KortexClient,
  userId: string,
  itemId: string,
  rows: readonly ActionItemInsert[],
): Promise<void> {
  try {
    await syncSourceTasks(c, userId, itemId, rows);
  } catch (e) {
    fail("sync action items", e as { message: string });
  }
}

export async function insertHighlight(
  c: KortexClient,
  row: Insert<"item_highlights">,
): Promise<string> {
  const { data, error } = await c.from("item_highlights").insert(row).select("id").single();
  if (error || !data) fail("insert highlight", error);
  return (data as { id: string }).id;
}

// --- Organizer context -----------------------------------------------------------------------

export async function getUserSettings(
  c: KortexClient,
  userId: string,
): Promise<UserSettings | null> {
  const { data, error } = await c
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("load settings", error);
  return data as UserSettings | null;
}

/** Lowercase e-mail addresses of a `person` object: `metadata.email` and `metadata.contact_info.email`. */
export function personEmails(type: string, metadata: unknown): string[] {
  if (type !== "person" || !metadata || typeof metadata !== "object") return [];
  const m = metadata as { email?: unknown; contact_info?: { email?: unknown } | null };
  return [m.email, m.contact_info?.email]
    .filter((e): e is string => typeof e === "string" && e.includes("@"))
    .map((e) => e.trim().toLowerCase());
}

/** Existing tags, clusters, objects and folders, so the organizer reuses the user's taxonomy. */
export async function loadOrganizerContext(
  c: KortexClient,
  userId: string,
  settings: UserSettings | null,
): Promise<IngestContext> {
  const [tags, clusters, objects, folders] = await Promise.all([
    c
      .from("tags")
      .select("name")
      .eq("user_id", userId)
      .order("usage_count", { ascending: false })
      .limit(500),
    c
      .from("knowledge_items")
      .select("cluster_name")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(500),
    c
      .from("knowledge_items")
      .select("id,title,type,metadata")
      .eq("user_id", userId)
      .in("type", [...DOMAIN_OBJECT_TYPES])
      .limit(1000),
    listFolders(c, userId),
  ]);
  for (const r of [tags, clusters, objects]) if (r.error) fail("load organizer context", r.error);
  const clusterNames = [
    ...new Set(
      ((clusters.data ?? []) as Array<{ cluster_name: string | null }>)
        .map((r) => r.cluster_name)
        .filter((n): n is string => !!n && n !== "General"),
    ),
  ];
  return {
    existingTags: ((tags.data ?? []) as Array<{ name: string }>).map((t) => t.name),
    existingClusters: clusterNames,
    existingObjects: (
      (objects.data ?? []) as Array<{ id: string; title: string; type: string; metadata: unknown }>
    ).map(({ metadata, ...o }) => {
      const emails = personEmails(o.type, metadata);
      return { ...o, ...(emails.length ? { emails } : {}) } as ExistingObject;
    }),
    folders,
    folderPaths: folders.map((f) => f.folder_path),
    userSettings: settings
      ? {
          auto_tag_enabled: settings.auto_tag_enabled,
          auto_cluster_enabled: settings.auto_cluster_enabled,
        }
      : null,
  };
}

/** Shallow-merges into a jsonb object column value. */
export const mergeJson = (base: Json | null | undefined, patch: Record<string, unknown>): Json => {
  const b = base && typeof base === "object" && !Array.isArray(base) ? base : {};
  return JSON.parse(JSON.stringify({ ...b, ...patch })) as Json;
};
