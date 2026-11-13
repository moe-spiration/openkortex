// Registers the desktop app's German catalog (the English source text is the key, see @kortex/i18n)
// and decides the language of a window. Imported first in main.tsx, so every Tauri window has it.
import { getLocale, pickLocale, registerCatalog, setLocale, type Catalog, type Locale } from "@kortex/i18n";
import desktop from "./de/desktop.json";

registerCatalog("de", desktop as Catalog);

export { PRODUCT_NAME, feature, getLocale, intlLocale, msg, setLocale, t, tn, tx } from "@kortex/i18n";
export type { Locale };

/** The languages of the settings row, each in its own language (never translated). */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch" };

/**
 * Copy of the core's language for the next start of a window (localStorage is shared by all local
 * windows). The choice itself lives in the core's desktop.json (`get_locale` / `set_locale`).
 */
export const LOCALE_KEY = "kortex.desktop.locale";

export function parseLocale(value: unknown): Locale | null {
  return value === "en" || value === "de" ? value : null;
}

/** Language before the first render: the remembered one, else the system language (English as the fallback). */
export function initialLocale(storage: Pick<Storage, "getItem"> | null, languages: readonly string[]): Locale {
  try {
    const stored = parseLocale(storage?.getItem(LOCALE_KEY));
    if (stored) return stored;
  } catch {
    /* storage blocked: the system language decides */
  }
  return pickLocale(languages);
}

/** Sets the language of this window (before React renders). */
export function startLocale(storage: Pick<Storage, "getItem"> | null): Locale {
  const locale = initialLocale(storage, typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]));
  setLocale(locale);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  return locale;
}

/** Follows the core: remembers `locale` and reloads the window when it shows another language. */
export function followLocale(locale: unknown, storage: Pick<Storage, "setItem"> | null): void {
  const next = parseLocale(locale);
  if (!next) return;
  try {
    storage?.setItem(LOCALE_KEY, next);
  } catch {
    /* storage blocked: the language lasts until the next start */
  }
  if (next !== getLocale()) window.location.reload();
}
