// Language of @kortex/mcp-server. English is the source, German lives in ./de/mcp-server.json.
//
// The stdio server is a single-user process: the CLI sets the language once from the user's
// `kortex.user_settings.locale` (`setLocale`). The HTTP server answers several users at once, so
// the language lives in an AsyncLocalStorage: `runWithLocale` wraps one request (the authenticated
// user's language for /mcp, the browser's Accept-Language for the OAuth pages). Tool names and
// JSON field names never change with the language.
import { AsyncLocalStorage } from "node:async_hooks";
import { registerCatalog, setLocaleResolver, type Catalog, type Locale } from "@kortex/i18n";
import mcpServer from "./de/mcp-server.json";

registerCatalog("de", mcpServer as Catalog);

const storage = new AsyncLocalStorage<Locale>();
setLocaleResolver(() => storage.getStore());

/** Runs `fn` (and everything it awaits) in `locale`; undefined keeps the process-wide language. */
export function runWithLocale<T>(locale: Locale | undefined, fn: () => T): T {
  return locale ? storage.run(locale, fn) : fn();
}

/** "en" | "de" from a stored setting; anything else (no row, null, another value) is undefined. */
export const storedLocale = (value: unknown): Locale | undefined =>
  value === "en" || value === "de" ? value : undefined;

/** First supported language of an Accept-Language header; undefined when it names none. */
export function localeOfAcceptLanguage(header: string | string[] | undefined): Locale | undefined {
  const raw = Array.isArray(header) ? header.join(",") : (header ?? "");
  for (const part of raw.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase() ?? "";
    if (/^de(?:$|[-_])/.test(tag)) return "de";
    if (/^en(?:$|[-_])/.test(tag)) return "en";
  }
  return undefined;
}

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
 * The account's language (`kortex.user_settings.locale`). Undefined when there is no row, no value
 * or the lookup fails (the column may be missing on an older database): the caller then keeps
 * English, the default.
 */
export async function loadUserLocale(client: unknown, userId: string): Promise<Locale | undefined> {
  try {
    const { data, error } = await (client as SettingsClient)
      .from("user_settings")
      .select("locale")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return undefined;
    return storedLocale((data as { locale?: unknown } | null)?.locale);
  } catch {
    return undefined;
  }
}

export { PRODUCT_NAME, byLocale, getLocale, intlLocale, msg, setLocale, t, tn, tx } from "@kortex/i18n";
export type { Locale };
