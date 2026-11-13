// Reine Anzeige-Helfer für die Sessions-Ansicht im Side-Panel (Favicons, Domains, Datum, Kopieren, Link nach Kortex).
import { intlLocale, t, tn } from "../i18n";
import type { SavedSession } from "./library";
import { DEFAULT_BASE_URL } from "./settings";
import { autoSessionName } from "./session-name";
import { SESSION_FOLDER, markdownLinkList } from "./sessions";

/** Hostname ohne `www.`; leer bei kaputten URLs. */
export function tabDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/**
 * Favicon-Quelle, die eine Extension-Seite laden darf: http(s) oder ein eingebettetes Bild.
 * `chrome://`-, `edge://`- und sonstige Adressen fallen weg, die Ansicht zeigt dann das Globus-Icon.
 */
export function faviconSrc(favicon: string | undefined): string | null {
  if (!favicon) return null;
  return /^(https?:\/\/|data:image\/)/i.test(favicon) ? favicon : null;
}

/** Bis zu `max` Tabs für die Favicon-Reihe der Karte, je Domain einer (die Reihe soll die Vielfalt zeigen). */
export function faviconStrip<T extends { url: string; favicon?: string }>(tabs: readonly T[], max = 6): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const tab of tabs) {
    const key = tabDomain(tab.url) || tab.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tab);
    if (out.length === max) break;
  }
  return out;
}

/** Titel ohne das angehängte "(N Tabs)", die Karte zeigt die Anzahl separat. */
export const displayTitle = (title: string) => title.replace(/\s*\(\d+ Tabs?\)\s*$/, "").trim() || title;

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Heute, 14:05", "Gestern, 09:12" oder "31.10.26, 14:05" (lokale Zeit). */
export function sessionDateLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, now)) return t("Today, {time}", { time });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return t("Yesterday, {time}", { time });
  return `${d.toLocaleDateString(intlLocale(), { day: "2-digit", month: "2-digit", year: "2-digit" })}, ${time}`;
}

/**
 * Vorauswahl für "Auswahl": die in der Tab-Leiste markierten Tabs (Strg/Umschalt-Klick), wenn es mehr als einer ist,
 * sonst alle speicherbaren Tabs.
 */
export function initialSelection(tabs: readonly { id?: number; highlighted?: boolean }[]): Set<number> {
  const ids = (list: readonly { id?: number }[]) => new Set(list.flatMap((tab) => (tab.id === undefined ? [] : [tab.id])));
  const marked = tabs.filter((tab) => tab.highlighted);
  return ids(marked.length > 1 ? marked : tabs);
}

/** "1 tab" / "12 tabs". */
export const tabCount = (n: number) => tn(n, "{n} tab", "{n} tabs");

/** Zwischenablage: dieselbe Markdown-Linkliste wie in der Session-Notiz. */
export const sessionMarkdown = (s: Pick<SavedSession, "tabs">) => markdownLinkList(s.tabs);

/**
 * Link in die Kortex-Web-App: die Notiz der Session, wenn der Server sie bestätigt hat, sonst der Sessions-Ordner
 * im Vault (offline eingereihte und ältere Einträge kennen ihre item_id nicht).
 */
export function kortexSessionUrl(baseUrl: string, s: Pick<SavedSession, "item_id">): string | null {
  let base: URL;
  try {
    base = new URL(/^https?:\/\//i.test(baseUrl.trim()) ? baseUrl.trim() : DEFAULT_BASE_URL);
  } catch {
    return null; // no Kortex address yet (options page)
  }
  const path = s.item_id && !s.item_id.startsWith("mock-")
    ? `/notes/${encodeURIComponent(s.item_id)}`
    : `/vault/${SESSION_FOLDER.split("/").map(encodeURIComponent).join("/")}`;
  return new URL(path, base.origin).href;
}

const STAMP = /(?:^|\s·\s)Session \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/**
 * Titel für die Karte: der Name ohne den automatischen Zeitstempel ("Recherche · Session 2026-11-05 09:12" ->
 * "Recherche"), das Datum steht ohnehin in der Meta-Zeile. Ohne Namen die Domains der ersten Tabs.
 */
export function cardTitle(s: Pick<SavedSession, "title" | "tabs">): string {
  const shown = displayTitle(s.title);
  if (!STAMP.test(shown)) return shown;
  const name = shown.replace(STAMP, "").trim();
  if (name) return name;
  const auto = autoSessionName(s.tabs);
  if (auto) return auto;
  const hosts = [...new Set(s.tabs.map((x) => tabDomain(x.url)).filter(Boolean))];
  if (!hosts.length) return shown;
  return hosts.slice(0, 2).join(", ") + (hosts.length > 2 ? ` +${hosts.length - 2}` : "");
}
