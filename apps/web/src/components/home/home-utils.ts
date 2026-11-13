import { getLocale, msg, t } from "@/i18n";
import { HOME_SECTIONS, HOME_SECTION_KEYS } from "@/lib/mock/home";

/* Pure helpers of the Home bento (Tactile Craft v2), kept apart from the components for the tests. */

/** A section the "Anpassen" menu can hide. */
export interface HomeToggle {
  key: string;
  label: string;
}

/** Sections "Anpassen" can hide: the shared four (lib/mock/home) plus Life, the tab sessions and the Smart Mixes. */
export const HOME_TOGGLES: readonly HomeToggle[] = [
  { key: "t", get label() { return t("Daily stack"); } },
  ...HOME_SECTIONS,
  { key: "l", label: "Life" },
  { key: "d", get label() { return t("Due today"); } },
  { key: "s", get label() { return t("Where you left off (tab sessions)"); } },
  { key: "m", label: "Smart Knowledge Mixes" },
];
const TOGGLE_KEYS = new Set<string>([...HOME_SECTION_KEYS, "t", "l", "d", "s", "m"]);

/**
 * Bento sections in their default order (the briefing "b" sits in the hero and is not part of it). Feinschliff Live:
 * the Tagesstapel on top (3: what needs a decision today), "Heute im Überblick" full width, then "Heute fällig" (7) next to "Weiter, wo Du warst" (5); the sections the
 * prototype has no place for (Wiederentdecken, Life, Tab-Sessions, Mixes) follow below, so no feature is lost.
 */
export const BENTO_DEFAULT: readonly string[] = ["t", "c", "d", "j", "r", "l", "s", "m"];

/** Layout version of the saved order: an order saved for an older layout falls back to the new default (hidden stays). */
export const BENTO_LAYOUT = 3;

/** Natural width of a bento section on the 12-column grid. */
const BASE_SPAN: Record<string, number> = { t: 12, c: 12, d: 7, j: 5, r: 7, l: 5, s: 12, m: 12 };

/**
 * The user's bento order from storage: known keys in their saved order, missing ones appended in default order. An
 * order saved for an older layout (no `layout: BENTO_LAYOUT`) is ignored.
 */
export function parseOrder(raw: string | null): string[] {
  let saved: string[] = [];
  try {
    const v = raw ? (JSON.parse(raw) as { order?: unknown; layout?: unknown }) : null;
    if (Array.isArray(v?.order) && v.layout === BENTO_LAYOUT)
      saved = v.order.filter((k): k is string => typeof k === "string" && BENTO_DEFAULT.includes(k));
  } catch {
    /* corrupt */
  }
  const out = [...new Set(saved)];
  for (const k of BENTO_DEFAULT) if (!out.includes(k)) out.push(k);
  return out;
}

/** Moves `key` to the position of `before` (or to the end when `before` is null). */
export function moveKey(order: readonly string[], key: string, before: string | null): string[] {
  if (key === before) return [...order];
  const rest = order.filter((k) => k !== key);
  const at = before === null ? -1 : rest.indexOf(before);
  rest.splice(at < 0 ? rest.length : at, 0, key);
  return rest;
}

/**
 * Drop target of a drag in the "Anpassen" list → the `before` argument of moveKey. Dropped on a row
 * below the dragged one it lands after that row, above it lands before it. `undefined`: no move.
 */
export function dropBefore(order: readonly string[], drag: string, target: string | null): string | null | undefined {
  if (!target || target === drag) return undefined;
  const from = order.indexOf(drag);
  const to = order.indexOf(target);
  if (from < 0 || to < 0) return undefined;
  return from < to ? (order[to + 1] ?? null) : target;
}

/**
 * Column spans for the visible sections in order, so the grid has no holes: two narrow neighbours share a
 * row (7+5 as designed, otherwise 6+6), a narrow section without a partner takes the full row.
 */
export function bentoSpans(visible: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < visible.length; i++) {
    const a = visible[i]!;
    const wa = BASE_SPAN[a] ?? 12;
    const b = visible[i + 1];
    const wb = b ? (BASE_SPAN[b] ?? 12) : 12;
    if (b && wa < 12 && wb < 12) {
      const fits = wa + wb === 12;
      out[a] = fits ? wa : 6;
      out[b] = fits ? wb : 6;
      i++;
    } else out[a] = 12;
  }
  return out;
}

/** Hidden section keys from storage (`kortex.home.v1`); unknown keys (older versions) are dropped. */
export function parseHidden(raw: string | null): Set<string> {
  try {
    const v = raw ? (JSON.parse(raw) as { hidden?: unknown }) : null;
    if (Array.isArray(v?.hidden))
      return new Set(v.hidden.filter((k): k is string => typeof k === "string" && TOGGLE_KEYS.has(k)));
  } catch {
    /* corrupt */
  }
  return new Set();
}

/** Tint of an item type's glyph (Feinschliff Live `.glyph --gc`); unknown types get the note tint. */
const GLYPH_TINT: Record<string, string> = {
  note: "#A5B4FC",
  daily: "#FBBF24",
  meeting: "#FB7185",
  article: "#38BDF8",
  book: "#F59E0B",
  video: "#F472B6",
  podcast: "#C084FC",
  ai: "#818CF8",
  recipe: "#FB923C",
  person: "#34D399",
  project: "#818CF8",
  organization: "#38BDF8",
  concept: "#FACC15",
  tool: "#94A3B8",
  asset: "#2DD4BF",
  goal: "#F87171",
};
export const glyphTint = (type?: string | null): string => (type && GLYPH_TINT[type]) || GLYPH_TINT.note!;

/** Source word of a task row in "Heute fällig" ("Aufgabe · Meeting"). */
const SOURCE_WORD: Record<string, string> = { meeting: msg("Meeting"), note: msg("Note"), voice: msg("Voice note"), article: msg("Article"), ai: msg("AI chat") };

/** Second line of a due task: "Aufgabe · <source>" plus "überfällig" when it is from an earlier day. */
export function dueTaskLine(task: { due: string; sourceId?: string; sourceKind?: string }, day: string): string {
  const parts = [t("Task")];
  if (task.sourceId && task.sourceKind) parts.push(t(SOURCE_WORD[task.sourceKind] ?? "Note"));
  if (task.due < day) parts.push(t("overdue"));
  return parts.join(" · ");
}

/** Right column of a "Weiter, wo Du warst" row: what is left, from the progress. */
export function restLabel(pct: number | null): string {
  if (pct === null) return "";
  if (pct >= 100) return t("finished");
  return t("{n} % left", { n: Math.max(1, 100 - Math.round(pct)) });
}

/** "vor 7 Monaten gespeichert" / "vor einem Jahr gespeichert" from the day it was created; null under a month. */
export function savedAgo(date: Date | null, now: Date | null): string | null {
  if (!date || !now) return null;
  const months =
    (now.getFullYear() - date.getFullYear()) * 12 +
    now.getMonth() -
    date.getMonth() -
    (now.getDate() < date.getDate() ? 1 : 0);
  if (months >= 24) return t("saved {n} years ago", { n: Math.floor(months / 12) });
  if (months >= 12) return t("saved a year ago");
  if (months >= 2) return t("saved {n} months ago", { n: months });
  if (months === 1) return t("saved a month ago");
  return null;
}

/** A quote in the language's quotation marks („…“ / “…”), without the straight or curly quotes it came with. */
export function quoted(text: string): string {
  const bare = text
    .trim()
    .replace(/^["„“”«»']+|["„“”«»']+$/g, "")
    .trim();
  if (!bare) return "";
  return getLocale() === "de" ? `„${bare}“` : `“${bare}”`;
}

/**
 * Areas with their progress: live the Life scores (inactive areas left out), mock the prototype values. W-08: live
 * while the scores load or failed to load, `pct` is null (shown as "–"), never the prototype's numbers.
 */
export function lifeMiniRows<A extends { key: string; score: number | null }>(
  areas: readonly A[],
  scores: readonly { key: string; score: number; active?: boolean }[] | null,
  live = false,
): (A & { pct: number | null })[] {
  return areas
    .filter((a) => a.key !== "overview")
    .flatMap((a) => {
      if (!scores) return [{ ...a, pct: live ? null : (a.score ?? 0) }];
      const s = scores.find((x) => x.key === a.key);
      return s && s.active !== false ? [{ ...a, pct: s.score }] : [];
    });
}
