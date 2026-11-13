// Language of @kortex/md-sync. English is the source, German lives in ./de/md-sync.json.
//
// md-sync is a single-user process: the CLI sets the language once at start-up from the user's
// `kortex.user_settings.locale` (`applyUserLocale`). Everything the daemon writes for that user
// (AI notes via @kortex/ai-core, task and flashcard sections, messages) then follows it.
import { registerCatalog, setLocale, type Catalog, type Locale } from "@kortex/i18n";
import mdSync from "./de/md-sync.json";

registerCatalog("de", mdSync as Catalog);

/** Minimal shape of the Supabase client this needs (kortex schema already selected). */
interface SettingsClient {
  from(table: "user_settings"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): { maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }> };
    };
  };
}

/**
 * The account's language (`kortex.user_settings.locale`): "en" or "de" from the row, otherwise
 * undefined (no row, no value, another value, or the lookup failed).
 */
export async function loadUserLocale(client: unknown, userId: string): Promise<Locale | undefined> {
  try {
    const { data, error } = await (client as SettingsClient)
      .from("user_settings")
      .select("locale")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return undefined;
    const value = (data as { locale?: unknown } | null)?.locale;
    return value === "en" || value === "de" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Sets the process language from the user's settings; without a stored value English stays. */
export async function applyUserLocale(client: unknown, userId: string): Promise<Locale> {
  const locale = (await loadUserLocale(client, userId)) ?? "en";
  setLocale(locale);
  return locale;
}

export { getLocale, setLocale, t } from "@kortex/i18n";
export type { Locale };
