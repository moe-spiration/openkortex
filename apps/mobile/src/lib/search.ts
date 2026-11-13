import type { Entry } from "../data/mock";
import { intlLocale, t, tn, tx } from "../i18n";

/*
 * Smart search (Mobile.dc.html): natural language is split into filters (type, person, time, tag) plus free text.
 * The rules understand German and English words whatever the app language is; the labels follow the app language.
 */

type Kind = "type" | "who" | "time" | "tag" | "dur";
interface Rule {
  re: RegExp;
  kind: Kind;
  val: string | number | [number, number];
  /** Chip text in the current language (resolved when shown, never at module level). */
  label: () => string;
}

const RULES: Rule[] = [
  { re: /\b(meetings?|calls?|termine?|appointments?)\b/i, kind: "type", val: "meeting", label: () => "Meetings" },
  { re: /\b(rezepte?|kochen|essen|recipes?|cooking|food)\b/i, kind: "type", val: "food", label: () => t("Recipes") },
  { re: /\b(notizen?|journal|notes?)\b/i, kind: "type", val: "note", label: () => tx("search", "Notes") },
  { re: /\b(artikel|bücher|buch|lesen|articles?|books?|reading)\b/i, kind: "type", val: "read", label: () => t("Articles and books") },
  { re: /\b(reels?|podcasts?|videos?)\b/i, kind: "type", val: "video", label: () => t("Reels and podcasts") },
  { re: /\b(memor(y|ies)|chats?)\b/i, kind: "type", val: "ai", label: () => "AI Memories" },
  { re: /\btom\b/i, kind: "who", val: "Tom", label: () => t("with {name}", { name: "Tom" }) },
  { re: /\bpriya\b/i, kind: "who", val: "Priya", label: () => t("with {name}", { name: "Priya" }) },
  { re: /\b(heute|today)\b/i, kind: "time", val: [0, 0], label: () => t("Today") },
  { re: /\b(gestern|yesterday)\b/i, kind: "time", val: [1, 1], label: () => t("Yesterday") },
  { re: /\b(diese woche|this week)\b/i, kind: "time", val: [0, 3], label: () => t("This week") },
  { re: /\b(letzte woche|last week)\b/i, kind: "time", val: [4, 10], label: () => t("Last week") },
  { re: /\b(mcp|claude|agenten?|ki)\b/i, kind: "tag", val: "#ai/mcp", label: () => "#ai/mcp" },
  { re: /\b(running|laufen|training|fitness)\b/i, kind: "tag", val: "#fitness/running", label: () => "#fitness/running" },
  { re: /\b(low-?carb)\b/i, kind: "tag", val: "#recipes/low-carb", label: () => "#recipes/low-carb" },
  { re: /\b(immobilien?|mortgage|hypothek|home)\b/i, kind: "tag", val: "#real-estate", label: () => "#real-estate" },
  { re: /\b(unter|under) 30 min\.?/i, kind: "dur", val: 30, label: () => t("under 30 min") },
];

const STOP =
  /\b(mit|von|zu|zum|zur|der|die|das|den|dem|und|was|habe|hab|ich|gespeichert|alle|meine?|in|im|über|für|zeig|mir|with|from|to|the|and|what|have|saved|all|my|about|for|show|me)\b/gi;

export interface QueryChip {
  label: string;
  kind: Kind | "text";
  /** Tag chips carry their hashtag so the UI can colour them. */
  tag?: string;
}

export interface SearchState {
  hits: Rule[];
  rest: string;
  chips: QueryChip[];
}

export const SORT_IDS = ["rel", "new", "old", "open", "az"] as const;
export type SortId = (typeof SORT_IDS)[number];

export function parseQuery(q: string): SearchState {
  const raw = q.trim();
  const hits = RULES.filter((r) => r.re.test(raw));
  let rest = raw;
  hits.forEach((r) => {
    rest = rest.replace(r.re, " ");
  });
  rest = rest.replace(STOP, " ").replace(/[?.,!]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const chips: QueryChip[] = hits.map((h) => ({ label: h.label(), kind: h.kind, tag: h.kind === "tag" ? (h.val as string) : undefined }));
  if (rest) chips.push({ label: `"${rest}"`, kind: "text" });
  return { hits, rest, chips };
}

/** Removes one chip's words from the query string (tap on a chip). */
export function dropChip(q: string, chip: QueryChip): string {
  const hit = RULES.find((r) => r.label() === chip.label && r.kind === chip.kind);
  if (hit) return q.replace(hit.re, " ").replace(/\s+/g, " ").trim();
  if (chip.kind === "text") {
    let out = q;
    chip.label
      .slice(1, -1)
      .split(" ")
      .forEach((w) => {
        out = out.replace(new RegExp(w, "i"), " ");
      });
    return out.replace(/\s+/g, " ").trim();
  }
  return q;
}

export interface SearchResult {
  list: Entry[];
  state: SearchState;
  /** Summary sentence of the smart search card; empty without hits. */
  answer: string;
}

export function searchEntries(entries: Entry[], q: string, chip: string, sort: SortId): SearchResult {
  const state = parseQuery(q);
  const { hits, rest } = state;
  const fType = hits.filter((h) => h.kind === "type").map((h) => h.val as string);
  const fWho = hits.filter((h) => h.kind === "who").map((h) => h.val as string);
  const fTime = hits.filter((h) => h.kind === "time").map((h) => h.val as [number, number])[0];
  const fTag = hits.filter((h) => h.kind === "tag").map((h) => h.val as string);

  const score = (e: Entry) => {
    let sc = 0;
    if (rest) {
      const hay = `${e.title} ${e.tldr} ${e.tag}`.toLowerCase();
      rest.split(" ").forEach((w) => {
        if (w.length > 2 && hay.includes(w)) sc += 2;
      });
    }
    return sc + (fTag.includes(e.tag) ? 3 : 0) + (fWho.length ? 2 : 0);
  };

  let list = entries.filter(
    (e) =>
      (chip === "all" || e.kind === chip) &&
      (!fType.length || fType.includes(e.kind)) &&
      (!fWho.length || fWho.every((w) => e.who.includes(w))) &&
      (!fTime || (e.day >= fTime[0] && e.day <= fTime[1])) &&
      (!fTag.length || fTag.includes(e.tag)) &&
      (!rest || score(e) > 0 || (hits.length > 0 && rest.length < 3)),
  );

  const sorters: Record<SortId, (a: Entry, b: Entry) => number> = {
    rel: (a, b) => score(b) - score(a) || a.ts - b.ts,
    new: (a, b) => a.ts - b.ts,
    old: (a, b) => b.ts - a.ts,
    open: (a, b) => a.opened - b.opened,
    az: (a, b) => a.title.localeCompare(b.title, intlLocale()),
  };
  list = [...list].sort(sorters[sort]);

  const top = list[0];
  const found = hits.length
    ? tn(list.length, "{n} hit for {filters}", "{n} hits for {filters}", { filters: hits.map((h) => h.label()).join(", ") })
    : tn(list.length, "{n} hit", "{n} hits");
  const answer = top ? t("{found}. Most relevant: {title} ({when}). {tldr}", { found, title: top.title, when: top.when, tldr: top.tldr }) : "";
  return { list, state, answer };
}

/** Timeline groups (Today / Yesterday / This week / Last week), newest first. */
export function groupByRecency(list: Entry[]): { label: string; items: Entry[] }[] {
  const label = (d: number) => (d === 0 ? t("Today") : d === 1 ? t("Yesterday") : d <= 3 ? t("This week") : t("Last week"));
  const groups: { label: string; items: Entry[] }[] = [];
  [...list]
    .sort((a, b) => a.ts - b.ts)
    .forEach((e) => {
      const l = label(e.day);
      let g = groups.find((x) => x.label === l);
      if (!g) {
        g = { label: l, items: [] };
        groups.push(g);
      }
      g.items.push(e);
    });
  return groups;
}
