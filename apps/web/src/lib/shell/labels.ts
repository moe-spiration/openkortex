/*
 * Long forms of the short sidebar labels (V2-04a). Shown as tooltip, the short label stays the visible name
 * and the page title. Keys: nav ids, life area keys and space keys of lib/mock/workspace.ts.
 * The tables hold the English sources, translated when a label is read.
 */

import { msg, t } from "@/i18n";

const NAV: Record<string, string> = {
  home: msg("Home & check-in"),
  journal: msg("Journal: day (check-in, Mind Dump) and week (weekly review)"),
  inbox: msg("Universal Inbox"),
  tasks: msg("Tasks & weekly digests"),
  reminders: msg("Due reminders and watched pages"),
  graph: msg("2D knowledge graph"),
  flashcards: msg("Flashcards to review"),
  favorites: msg("Starred entries"),
  archive: msg("Archived entries: restore or delete for good"),
  insights: msg("Insights: statistics and trends"),
};

const LIFE: Record<string, string> = {
  overview: msg("All life areas"),
  health: msg("Health & fitness"),
  career: msg("Career & leadership"),
  finance: msg("Finances & investments"),
  relations: msg("Relationships & family"),
  growth: msg("Personal growth"),
};

const SPACES: Record<string, string> = {
  notes: msg("Notes & ideas"),
  meetings: msg("Meetings & calls"),
  articles: msg("Articles & web"),
  books: msg("PDF & EPUB books"),
  videos: msg("Videos, reels & podcasts"),
  recipes: msg("Recipes & food"),
};

const long = (table: Record<string, string>, key: string, label: string) => (table[key] ? t(table[key]) : label);

export const navLongLabel = (id: string, label: string) => long(NAV, id, label);
export const lifeLongLabel = (key: string, label: string) => long(LIFE, key, label);
export const spaceLongLabel = (key: string, label: string) => long(SPACES, key, label);
