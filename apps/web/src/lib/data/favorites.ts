"use server";

import { t } from "@/i18n";
import { typeIcon } from "@kortex/db";
import { runData, type DataResult } from "./run";

/*
 * Sidebar favourites (UI audit 0.6.2, variant A2): every item with the star (knowledge_items.is_favorite),
 * archived ones left out. The order is the user's own and lives in the shell prefs (favOrder); here they come
 * newest first, which is also where a freshly starred item lands until it is dragged.
 */

export interface FavoriteRow {
  id: string;
  title: string;
  /** DB type (type registry). */
  type: string;
  /** Lucide icon name of the type (type registry). */
  icon: string;
}

const MAX_FAVORITES = 60;

export async function loadFavorites(): Promise<DataResult<FavoriteRow[]>> {
  return runData("loadFavorites", async (ctx) => {
    const { data, error } = await ctx.client
      .from("knowledge_items")
      .select("id,title,type,status")
      .eq("user_id", ctx.userId)
      .eq("is_favorite", true)
      .order("updated_at", { ascending: false })
      .limit(MAX_FAVORITES);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((r) => r.status !== "archived")
      .map((r) => ({
        id: r.id,
        title: (r.title ?? "").trim() || t("Untitled"),
        type: r.type,
        icon: typeIcon(r.type),
      }));
  });
}
