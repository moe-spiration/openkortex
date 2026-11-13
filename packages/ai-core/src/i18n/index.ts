// Registers the German catalog of @kortex/ai-core (the English source text is the key, see
// @kortex/i18n). Every module of this package that translates imports `t` from here, so the
// catalog is registered no matter which file of the package is loaded first. ai-core only READS
// the language; the app or server that starts the work sets it.
import { byLocale, registerCatalog, type Catalog } from "@kortex/i18n";
import aiCore from "./de/ai-core.json";

registerCatalog("de", aiCore as Catalog);

export { PRODUCT_NAME, brand, byLocale, getLocale, intlLocale, msg, t, tn, tx } from "@kortex/i18n";
export type { Locale } from "@kortex/i18n";
export * from "./content";

/** Caption/subtitle language preference when the caller sets none: the user's language first. */
export const contentLanguages = (): string[] => byLocale({ en: ["en", "de"], de: ["de", "en"] });

/** Accept-Language for pages fetched on behalf of the user: their language first, the other second. */
export const acceptLanguage = (): string =>
  byLocale({ en: "en-US,en;q=0.9,de;q=0.8", de: "de-DE,de;q=0.9,en;q=0.8" });
