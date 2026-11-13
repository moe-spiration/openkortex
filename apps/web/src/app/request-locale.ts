import { cookies, headers } from "next/headers";
import { getLocale, LOCALE_COOKIE, type Locale } from "@/i18n";
import { localeOfRequest } from "@/i18n/server";

/**
 * Language of the current request (cookie the client keeps, else the browser's preference) for
 * server pages, `generateMetadata` and server actions. The caller enters it itself, in its own
 * function body: `enterRequestLocale(await requestLocale())`. Entering inside an awaited helper
 * would not reach the caller (AsyncLocalStorage.enterWith only covers what runs after it in the
 * same async function). Outside a request (tests, scripts) it answers the current language, so
 * entering it changes nothing.
 */
export async function requestLocale(): Promise<Locale> {
  try {
    return localeOfRequest(await headers(), (await cookies()).get(LOCALE_COOKIE)?.value);
  } catch {
    return getLocale();
  }
}
