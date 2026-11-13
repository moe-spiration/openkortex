// Translation layer shared by every Kortex app and package.
//
// The source language is English and the English text is the key: `t("Save")`. A locale's catalog
// maps the English source to its translation ({ "Save": "Speichern" }); a missing entry falls back
// to the English source. Catalogs are plain JSON files next to the code that uses them
// (`src/i18n/de/*.json`) and are registered once at start-up (`registerCatalog`). The repository
// check `pnpm i18n:check` fails when a source string has no German entry.
//
//   t("Save")                                   "Save" / "Speichern"
//   t("Moved to {folder}", { folder })          placeholders in braces
//   tn(n, "{n} entry", "{n} entries")           plural by count, {n} is filled in
//   tx("verb", "Open")                          same English text, different meaning: catalog key "verb::Open"
//
// The first argument must be a plain string literal, never a variable or a template string, so
// the check can read it. Text is resolved when the function runs: never call `t` at module level
// (a constant filled at import time would keep the language of that moment); wrap such tables in a
// function or keep the English source in the table and call `t(row.label)` where it is shown
// (mark those sources with `msg("…")` so the check sees them).

import product from "../product.json";

/**
 * Display name of the product ("Kortex" in the private build, "OpenKortex" in the open-source
 * export, see product.json). Every translated text and every `byLocale` string is shown with it:
 * the word "Kortex" in a source or catalog text becomes this name. Technical ids (KortexVault,
 * X-Kortex-Locale, kortex://) are no whole word "Kortex" and stay as they are.
 */
export const PRODUCT_NAME: string = productName(
  product.name,
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env,
);

/**
 * The name from product.json. Tests always run with "Kortex" (like they always run in German), so
 * the same test files pass in the private build and in the open-source export.
 */
export function productName(configured: unknown, env?: Record<string, string | undefined>): string {
  if (env?.VITEST) return "Kortex";
  return String(configured ?? "").trim() || "Kortex";
}

// The word "Kortex" on its own: not inside KortexVault, kortex:// or a header like X-Kortex-Locale.
const BRAND_WORD = /(^|[^\w-])Kortex(?!\w)/g;

/** Replaces the whole word "Kortex" in `text` with `name`. */
export function brandWith(name: string, text: string): string {
  return name === "Kortex" ? text : text.replace(BRAND_WORD, (_m, before: string) => before + name);
}

/** Optional surfaces of the build (product.json `features`); the open-source export turns some off. */
export type Feature = "griply";
const FEATURE_DEFAULTS: Record<Feature, boolean> = { griply: true };
const productFeatures = ((product as { features?: Partial<Record<Feature, unknown>> }).features ?? {}) as Partial<Record<Feature, unknown>>;
/** Mutable only for tests (`FEATURES.griply = false`); the apps read it through `feature()`. */
export const FEATURES: Record<Feature, boolean> = {
  griply: productFeatures.griply === undefined ? FEATURE_DEFAULTS.griply : productFeatures.griply === true,
};
/** Whether this build shows an optional surface (product.json `features`). */
export const feature = (name: Feature): boolean => FEATURES[name];

/** Replaces the word "Kortex" with the product name (a no-op in the private build). */
export function brand(text: string): string {
  return brandWith(PRODUCT_NAME, text);
}

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export type Catalog = Record<string, string>;
export type Params = Record<string, string | number>;

const catalogs: Record<Locale, Catalog> = { en: {}, de: {} };
let globalLocale: Locale = DEFAULT_LOCALE;
let resolver: (() => Locale | undefined) | null = null;

/** "de", "de-AT", "DE_de" → "de"; everything else (also null, "fr") → "en". */
export function toLocale(value: unknown): Locale {
  return typeof value === "string" && /^de(?:$|[-_])/i.test(value.trim()) ? "de" : DEFAULT_LOCALE;
}

/** First supported language of a preference list (`navigator.languages`, Accept-Language parts). */
export function pickLocale(preferred: readonly (string | null | undefined)[]): Locale {
  for (const p of preferred) {
    if (typeof p !== "string" || !p.trim()) continue;
    if (/^de(?:$|[-_])/i.test(p.trim())) return "de";
    if (/^en(?:$|[-_])/i.test(p.trim())) return "en";
  }
  return DEFAULT_LOCALE;
}

/** Adds translations for a locale. Later registrations win for the same source text. */
export function registerCatalog(locale: Locale, entries: Catalog): void {
  Object.assign(catalogs[locale], entries);
}

/** Process-wide language: the one user of a browser tab, an app or a CLI. */
export function setLocale(locale: Locale): void {
  globalLocale = locale;
}

/**
 * Per-request language on a server that answers several users at once: the resolver (for example
 * one reading an AsyncLocalStorage) wins over the process-wide language whenever it returns a value.
 */
export function setLocaleResolver(fn: (() => Locale | undefined) | null): void {
  resolver = fn;
}

export function getLocale(): Locale {
  return resolver?.() ?? globalLocale;
}

/** BCP 47 tag for `Intl.*` and `toLocale*String` in the current language. */
export function intlLocale(locale: Locale = getLocale()): "en-US" | "de-DE" {
  return locale === "de" ? "de-DE" : "en-US";
}

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

function lookup(key: string, source: string, locale: Locale): string {
  return brand(locale === "en" ? (catalogs.en[key] ?? source) : (catalogs[locale][key] ?? catalogs.en[key] ?? source));
}

/** Translates an English source text into the current language. */
export function t(source: string, params?: Params): string {
  return fill(lookup(source, source, getLocale()), params);
}

/** Like `t`, with a context that separates two meanings of the same English text. */
export function tx(context: string, source: string, params?: Params): string {
  return fill(lookup(`${context}::${source}`, source, getLocale()), params);
}

/** Plural: `one` for exactly 1, `other` for the rest. `{n}` is the count. */
export function tn(count: number, one: string, other: string, params?: Params): string {
  const source = count === 1 ? one : other;
  return fill(lookup(source, source, getLocale()), { n: count, ...params });
}

/** Translates into a given language regardless of the current one (mails, digests for another user). */
export function tFor(locale: Locale, source: string, params?: Params): string {
  return fill(lookup(source, source, locale), params);
}

/**
 * Picks the variant for the current language: for long texts that are written per language and
 * are no catalog entries (AI prompts, mail bodies). `en` is required and the fallback.
 */
export function byLocale<T>(variants: { en: T } & Partial<Record<Locale, T>>, locale: Locale = getLocale()): T {
  const v = variants[locale] ?? variants.en;
  if (typeof v === "string") return brand(v) as T;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v.map(brand) as T;
  return v;
}

/** Marks an English source text for the check without translating it yet (tables, enums). */
export function msg<T extends string>(source: T): T {
  return source;
}

/** Runs `fn` with a process-wide language and restores the previous one (tests, CLIs). */
export function withLocale<T>(locale: Locale, fn: () => T): T {
  const before = globalLocale;
  globalLocale = locale;
  try {
    return fn();
  } finally {
    globalLocale = before;
  }
}
