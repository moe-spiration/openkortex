// Registers the extension's German catalog (the English source text is the key, see @kortex/i18n)
// and decides the language of this JavaScript context.
//
// Every entrypoint (service worker, content scripts, popup, side panel, options page, tab board,
// the injected page reader) is a context of its own. Importing this module registers the catalog
// and starts with the browser language; `initLanguage()` then applies the choice stored in the
// extension settings ("auto" = browser language) and must run before the context produces text.
import { pickLocale, registerCatalog, setLocale, getLocale, type Catalog, type Locale } from "@kortex/i18n";
import { chromeStore, loadSettings, type LanguageSetting } from "../lib/settings";
import extension from "./de/extension.json";
import ruhe from "./de/ruhe.json";

registerCatalog("de", extension as Catalog);
// Texts of the Ruhe components (src/ui/ruhe, 2026-11-27).
registerCatalog("de", ruhe as Catalog);

export { PRODUCT_NAME, feature, getLocale, intlLocale, msg, setLocale, t, tn, tx } from "@kortex/i18n";
export type { Locale };

/** Language of the browser: `navigator.languages` on pages, `navigator.language` / the UI language in the service worker. */
export function browserLocale(): Locale {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  const preferred = [...(nav?.languages ?? []), nav?.language];
  try {
    preferred.push(chrome.i18n.getUILanguage());
  } catch {
    /* no extension runtime (tests, preview) */
  }
  return pickLocale(preferred);
}

/** The stored choice wins; "auto" (or nothing stored) follows the browser. */
export const resolveLanguage = (setting: LanguageSetting | undefined): Locale => (setting === "en" || setting === "de" ? setting : browserLocale());

/** Sets the language of this context (and `<html lang>` on extension pages). */
export function applyLanguage(setting: LanguageSetting | undefined): Locale {
  const locale = resolveLanguage(setting);
  setLocale(locale);
  if (typeof document !== "undefined" && typeof location !== "undefined" && /-extension:$/.test(location.protocol)) document.documentElement.lang = locale;
  return locale;
}

/** Reads the stored choice and applies it; falls back to the browser language when storage is unavailable. */
export async function initLanguage(): Promise<Locale> {
  try {
    return applyLanguage((await loadSettings(chromeStore)).language);
  } catch {
    return applyLanguage("auto");
  }
}

/**
 * Follows a changed language choice: the new language is set, then `onChange` runs (extension pages
 * render again, the service worker rebuilds its menus; content scripts just show the next text in it).
 */
export function watchLanguage(onChange?: (locale: Locale) => void): void {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.settings) return;
      const before = getLocale();
      const next = applyLanguage((changes.settings.newValue as { language?: LanguageSetting } | undefined)?.language);
      if (next !== before) onChange?.(next);
    });
  } catch {
    /* no extension runtime (tests, preview) */
  }
}

/**
 * Extension pages: apply the stored language, render, and render again when the choice changes
 * (no reload: the popup would capture the page a second time and forms would lose their input).
 */
export async function startPage(render: () => void): Promise<void> {
  await initLanguage();
  watchLanguage(render);
  render();
}

setLocale(browserLocale());
