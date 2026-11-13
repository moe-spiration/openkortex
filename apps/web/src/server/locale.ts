import type { KortexClient } from "@kortex/db";
import type { Locale } from "@kortex/i18n";
import { runWithLocale } from "@/i18n/server";
import { getUserSettings } from "./repo";

/*
 * Language of work done for a user outside their own request (cron jobs, the mail webhook,
 * background pipelines): the account's `user_settings.locale`. Accounts that existed before the
 * column are German, so anything but "en" counts as "de".
 */

export const localeOfSettings = (settings: { locale?: unknown } | null | undefined): Locale =>
  settings?.locale === "en" ? "en" : "de";

/** The account language of a user; German when the row cannot be read. */
export async function userLocale(client: KortexClient, userId: string): Promise<Locale> {
  try {
    return localeOfSettings(await getUserSettings(client, userId));
  } catch {
    return "de";
  }
}

/** Runs `fn` in the account language of `userId` (texts, prompts and ai-core calls inside follow it). */
export async function runAsUser<T>(client: KortexClient, userId: string, fn: () => Promise<T>): Promise<T> {
  return runWithLocale(await userLocale(client, userId), fn);
}
