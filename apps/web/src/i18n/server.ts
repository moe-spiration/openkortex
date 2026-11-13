// Per-request language on the server. The process answers several users at once, so the language
// lives in an AsyncLocalStorage: `enterRequestLocale` sets it for the rest of the current request
// (server components, server actions, route handlers), `runWithLocale` for a job that acts for
// one user outside a request (digest, mail ingest, cron).
import { AsyncLocalStorage } from "node:async_hooks";
import { pickLocale, setLocaleResolver, toLocale, type Locale } from "@kortex/i18n";
import "./index";
import { LOCALE_COOKIE } from "./index";

const storage = new AsyncLocalStorage<Locale>();
setLocaleResolver(() => storage.getStore());

export function enterRequestLocale(locale: Locale): void {
  storage.enterWith(locale);
}

export function runWithLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run(locale, fn);
}

const cookieOf = (header: string | null, name: string): string | undefined =>
  header
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/**
 * Language of a request: the `X-Kortex-Locale` header (apps and the extension), else the cookie the
 * web client sets, else the browser's Accept-Language, else English.
 */
export function localeOfRequest(headers: Pick<Headers, "get">, cookie?: string): Locale {
  const explicit = headers.get("x-kortex-locale") ?? cookie ?? cookieOf(headers.get("cookie"), LOCALE_COOKIE);
  if (explicit === "de" || explicit === "en") return explicit;
  if (explicit) return toLocale(explicit);
  const accepted = (headers.get("accept-language") ?? "").split(",").map((p) => p.split(";")[0]?.trim());
  return pickLocale(accepted);
}

/**
 * Runs `fn` in the language a request states. A request that states none (no X-Kortex-Locale,
 * language cookie or Accept-Language) keeps the current language: English on the server, German
 * in the test suite.
 */
export function runInRequestLocale<T>(headers: Pick<Headers, "get">, fn: () => T): T {
  const stated =
    headers.get("x-kortex-locale") || headers.get("accept-language") || headers.get("cookie")?.includes(`${LOCALE_COOKIE}=`);
  return stated ? storage.run(localeOfRequest(headers), fn) : fn();
}
