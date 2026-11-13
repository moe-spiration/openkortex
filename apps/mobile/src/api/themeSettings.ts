import { parsePack, type PackId } from "@kortex/theme-packs";
import { supabase } from "./kortex";

/*
 * user_settings.theme_pack and .accent of the signed-in user (RLS: own row). The same columns the web app writes,
 * so a pack chosen on one device shows up on the other.
 */

export interface ThemeSettings {
  pack: PackId;
  /** null = never chosen (no value stored yet). */
  accent: string | null;
}

export async function loadThemeSettings(): Promise<ThemeSettings | null> {
  const { data, error } = await supabase().from("user_settings").select("theme_pack,accent").maybeSingle();
  if (error || !data) return null;
  const row = data as { theme_pack?: string; accent?: string };
  return { pack: parsePack(row.theme_pack), accent: row.accent ?? null };
}

export async function saveThemeSettings(patch: Partial<{ theme_pack: PackId; accent: string }>): Promise<boolean> {
  const { data: session } = await supabase().auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return false;
  const { error } = await supabase().from("user_settings").update(patch).eq("user_id", uid);
  return !error;
}
