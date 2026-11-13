/*
 * "Mit Windows-App verbinden" (Settings → Connectors): a fresh personal API token with every scope
 * (capture, search, ask) goes to the Kortex Windows app through the `kortex://connect` deep link. The
 * desktop parks it and asks the user to confirm before it stores the token (apps/desktop connect.rs).
 */

import { intlLocale, t } from "@/i18n";

/** Name of the token in the list, one per connect ("Windows-App (03.11.2026, 14:05)"). */
export function desktopTokenName(now: Date): string {
  const stamp = now.toLocaleString(intlLocale(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return t("Windows app ({stamp})", { stamp });
}

/** `kortex://connect?token=…&web=<origin>`; the desktop only accepts https:// or localhost origins. */
export function desktopConnectLink(token: string, origin: string): string {
  const q = new URLSearchParams({ token, web: origin });
  return `kortex://connect?${q.toString()}`;
}
