// Registers the mobile app's German catalog (the English source text is the key, see @kortex/i18n)
// and holds the app's language: device language at start, then the stored choice, then the
// account's `user_settings.locale`. Pure (no React Native import), so vitest and the headless
// widget / background tasks load it as well. Import it before any screen (index.ts does).
import { getLocale, pickLocale, registerCatalog, setLocale, toLocale, type Catalog, type Locale } from "@kortex/i18n";
import mobile from "./de/mobile.json";

registerCatalog("de", mobile as Catalog);

export { PRODUCT_NAME, feature, byLocale, getLocale, intlLocale, msg, t, tn, toLocale, tx } from "@kortex/i18n";
export type { Locale };

/** Language of the device, read in plain JS (no native module): English unless the device is German. */
export function deviceLocale(): Locale {
  try {
    return pickLocale([Intl.DateTimeFormat().resolvedOptions().locale]);
  } catch {
    return "en";
  }
}

// Before anything renders: the device language. The stored choice and the account follow (applyLocale).
setLocale(deviceLocale());

const listeners = new Set<() => void>();

/** Notifies when the language changes at runtime (`useLocale` in src/i18n/device.ts renders the tree again). */
export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Switches the language of the running app; every subscriber renders again in the new language. */
export function applyLocale(locale: Locale): void {
  if (locale === getLocale()) return;
  setLocale(locale);
  listeners.forEach((fn) => fn());
}

/** Header every request to the Kortex web API carries, so the server answers in the app's language. */
export const localeHeader = (): { "X-Kortex-Locale": Locale } => ({ "X-Kortex-Locale": getLocale() });

export const LOCALE_KEY = "kortex.locale";

export interface LocaleStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** The language chosen last on this device, or null when none was stored yet. */
export async function readStoredLocale(storage: LocaleStorage): Promise<Locale | null> {
  try {
    const raw = await storage.getItem(LOCALE_KEY);
    return raw === "en" || raw === "de" ? raw : null;
  } catch {
    return null;
  }
}

/** Applies the stored choice (if any) and returns the language in use. Never throws. */
export async function restoreLocale(storage: LocaleStorage): Promise<Locale> {
  const stored = await readStoredLocale(storage);
  if (stored) applyLocale(stored);
  return getLocale();
}

/** Switches the language and remembers it on the device (settings switch, account setting arriving). */
export async function chooseLocale(storage: LocaleStorage, value: unknown): Promise<Locale> {
  const locale = toLocale(value);
  applyLocale(locale);
  await storage.setItem(LOCALE_KEY, locale).catch(() => undefined);
  return locale;
}
