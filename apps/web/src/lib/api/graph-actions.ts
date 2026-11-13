"use server";

import { requestLocale } from "@/app/request-locale";
import { enterRequestLocale } from "@/i18n/server";
import { t } from "@/i18n";
import { ensureBootstrapped, getSession } from "@/lib/supabase/server";
import { getItem, updateItem } from "@/server/repo";
import type { ActionResult } from "./actions";

/*
 * Server action behind the graph's Serendipity card: "Verknüpfen" writes the link into
 * `related_item_ids` of BOTH items (a backlink on each side, like the note sheet does). It runs as
 * the signed-in user (RLS) and filters by user_id.
 */

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function linkItems(a: string, b: string): Promise<ActionResult> {
  enterRequestLocale(await requestLocale());
  try {
    if (!isUuid(a) || !isUuid(b) || a === b) return { ok: false, error: t("Invalid entries") };
    const session = await getSession();
    if (!session) return { ok: false, error: t("Not signed in") };
    await ensureBootstrapped(session);
    const { client, user } = session;
    const [ra, rb] = await Promise.all([
      getItem(client, user.id, a, ["related_item_ids"] as const),
      getItem(client, user.id, b, ["related_item_ids"] as const),
    ]);
    if (!ra || !rb) return { ok: false, error: t("Entry not found") };
    const union = (list: string[] | null, id: string) => [...new Set([...(list ?? []), id])];
    await Promise.all([
      updateItem(client, user.id, a, { related_item_ids: union(ra.related_item_ids, b) }),
      updateItem(client, user.id, b, { related_item_ids: union(rb.related_item_ids, a) }),
    ]);
    return { ok: true, data: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[kortex] linkItems failed:", message);
    return { ok: false, error: message };
  }
}
