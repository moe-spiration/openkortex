import { t, tx } from "@/i18n";
import type { NavItem } from "@/lib/mock/types";

/*
 * 2026-11-12 (approved preview): the main rows are Heute, Inbox, Aufgaben, Tagebuch, Agent; Graph, Karteikarten,
 * Insights and Archiv are the Werkzeuge in a two-column grid above the profile line.
 *
 * Earlier: sidebar structure (UI audit 0.6.2, variant A2 "Sicht-Menü", 2026-11-06): the main rows at the top, then the
 * user's Favoriten, then the Bibliothek with its view switch (Typen, Objekte, Vault) and the Tags section. Life and
 * the Werkzeuge (Insights, Archiv) are pinned at the bottom above the profile line. Karteikarten and Graph sit in the
 * main rows (2026-11-10: Graph moved up from the Werkzeuge). Erinnerungen are tasks with a date: the route stays
 * (palette, Tasks header), the sidebar row is gone. Scratchpad is a popup, not a page: titlebar, orbit bar
 * and Alt+J open it.
 */

export type NavGroupId = "main" | "tools";

export interface NavGroup {
  id: NavGroupId;
  label: string;
  items: NavItem[];
}

/** Daily and weekly view of the journal (one view, two tabs). */
export const JOURNAL_DAY_HREF = "/journal";
export const JOURNAL_WEEK_HREF = "/journal/week";

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "main",
    label: "Navigation",
    items: [
      { id: "home", get label() { return tx("nav", "Today"); }, icon: "home", href: "/home" },
      { id: "inbox", label: "Inbox", icon: "inbox", href: "/inbox" },
      { id: "tasks", get label() { return tx("nav", "Tasks"); }, icon: "todo", href: "/tasks" },
      // Badge "So" on the review day (computed in the sidebar): the weekly review is the journal's week tab.
      { id: "journal", get label() { return t("Journal"); }, icon: "sun", href: JOURNAL_DAY_HREF },
      // The agent's page: start a job, see what waits, runs and is done, standing orders.
      { id: "agent", label: "Agent", icon: "sparkles", href: "/agent" },
    ],
  },
  {
    id: "tools",
    get label() {
      return tx("nav", "Tools");
    },
    items: [
      { id: "graph", label: "Graph", icon: "graph", href: "/graph" },
      { id: "flashcards", get label() { return tx("nav", "Cards"); }, icon: "cards", href: "/flashcards" },
      { id: "insights", label: "Insights", icon: "chart", href: "/insights" },
      { id: "archive", get label() { return t("Archive"); }, icon: "archive", href: "/archive" },
    ],
  },
];

/** Long labels for the short tool rows (tooltip). */
export const TOOL_LONG_LABEL: Record<string, string> = {
  insights: "Insights",
  get graph() {
    return t("Knowledge graph");
  },
  get flashcards() {
    return t("Flashcards");
  },
  get archive() {
    return t("Archive");
  },
};

/** Every fixed sidebar row, in order. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * Old routes of the daily routine that now live in the journal (bookmarks, old links, the desktop app's history).
 * Returns the new path with the query kept, or null when the path is not an old one.
 */
export function legacyJournalRedirect(pathname: string, search = ""): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const q = search && !search.startsWith("?") ? `?${search}` : search;
  if (path === "/review") return JOURNAL_WEEK_HREF + q;
  return null;
}
