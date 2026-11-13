// Registers the web app's German catalog (the English source text is the key, see @kortex/i18n).
// One JSON file per area keeps parallel work apart; the same source text may appear in several
// files as long as the translation is identical (`pnpm i18n:check`).
import { registerCatalog, type Catalog, type Locale } from "@kortex/i18n";
import app from "./de/app.json";
import content from "./de/content.json";
import lib from "./de/lib.json";
import server from "./de/server.json";
import settings from "./de/settings.json";
import shell from "./de/shell.json";
import views from "./de/views.json";

for (const part of [app, shell, settings, views, content, lib, server]) registerCatalog("de", part as Catalog);

export { PRODUCT_NAME, feature, getLocale, intlLocale, msg, setLocale, t, tFor, tn, tx } from "@kortex/i18n";
export type { Locale };

/** Cookie that tells the server which language the browser uses (set by the client, read per request). */
export const LOCALE_COOKIE = "kortex_locale";

/** Stores the language for later requests (one year) so the server answers in it as well. */
export function rememberLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.lang = locale;
}

/** Switches the language of the running app: remembered, then reloaded so every text is rebuilt. */
export function switchLocale(locale: Locale): void {
  rememberLocale(locale);
  window.location.reload();
}
