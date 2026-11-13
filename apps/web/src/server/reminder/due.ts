import { json } from "../api-error";
import { preflight, route, type DepsProvider } from "../route";
import { parseWatch, hasUnseenChange } from "@/lib/radar";

/*
 * GET /api/reminders/due — everything a client should tell the user about right now, for web, desktop and
 * Android alike: reminders whose `remind_at` has passed and watched pages (delta radar) with a change the user
 * has not seen yet. Auth like /api/ingest (session cookie or a `kx_` token with the read scope `search`).
 *
 *   { items: [{ id, title, remind_at, kind: "reminder" | "radar", url? }] }
 *
 * `id` is the item id for reminders and `radar:<item id>:<change time>` for radar changes, so a client can
 * remember which ids it already announced; a snoozed reminder keeps its id but gets a new `remind_at`
 * (clients key on id + remind_at). `url` is the watched page (radar) or the item's source URL.
 */

export type DueKind = "reminder" | "radar";

export interface DueItem {
  id: string;
  title: string;
  remind_at: string;
  kind: DueKind;
  url?: string;
}

interface Row {
  id: string;
  title: string;
  source_url: string | null;
  remind_at: string | null;
  metadata: Record<string, unknown> | null;
}

const LIMIT = 100;

export function createDueHandlers(getDeps: DepsProvider) {
  return {
    GET: route(getDeps, async ({ auth, deps }) => {
      const now = deps.now();
      const base = () =>
        auth.client.from("knowledge_items").select("id,title,source_url,remind_at,metadata").eq("user_id", auth.userId).neq("status", "archived");

      const [rem, rad] = await Promise.all([
        base().not("remind_at", "is", null).lte("remind_at", now.toISOString()).order("remind_at", { ascending: true }).limit(LIMIT),
        base().eq("metadata->watch->>enabled", "true").limit(LIMIT),
      ]);
      if (rem.error) throw new Error(`reminders: ${rem.error.message}`);
      if (rad.error) throw new Error(`reminders: ${rad.error.message}`);

      const items: DueItem[] = [];
      for (const r of (rem.data ?? []) as Row[]) {
        if (!r.remind_at) continue;
        items.push({ id: r.id, title: r.title, remind_at: r.remind_at, kind: "reminder", ...(r.source_url ? { url: r.source_url } : {}) });
      }
      for (const r of (rad.data ?? []) as Row[]) {
        const w = parseWatch(r.metadata);
        if (!w || !hasUnseenChange(w) || !w.last_diff) continue;
        items.push({ id: `radar:${r.id}:${w.last_diff.at}`, title: r.title, remind_at: w.last_diff.at, kind: "radar", ...(r.source_url ? { url: r.source_url } : {}) });
      }
      items.sort((a, b) => Date.parse(a.remind_at) - Date.parse(b.remind_at));
      return json({ items });
    }),
    OPTIONS: preflight(getDeps),
  };
}
