/*
 * Living dossiers (Lebende Akten): the entry of a person, company or project carries three sections
 * in plain Markdown. "Where things stand" and "Open points" are kept up to date by the agent, "My
 * notes" belongs to the user and is never written by code. The headings are stored in the user's
 * language and read in both, so a dossier stays a portable note. Pure, covered by tests.
 */

export type DossierKey = "state" | "open" | "own";
/** The sections the agent may write. */
export type AgentDossierKey = Exclude<DossierKey, "own">;

export const DOSSIER_TYPES = ["person", "organization", "project"] as const;
export const isDossierType = (type: string): boolean => (DOSSIER_TYPES as readonly string[]).includes(type);

export const DOSSIER_HEADINGS: Record<DossierKey, { en: string; de: string }> = {
  state: { en: "Where things stand", de: "Stand der Dinge" },
  open: { en: "Open points", de: "Offene Punkte" },
  own: { en: "My notes", de: "Eigene Notizen" },
};
const ORDER: readonly DossierKey[] = ["state", "open", "own"];

const norm = (s: string) =>
  s
    .replace(/[*_`]/g, "")
    .replace(/[:：]\s*$/, "")
    .trim()
    .toLowerCase();
const keyOf = (heading: string): DossierKey | null => {
  const h = norm(heading);
  return ORDER.find((k) => norm(DOSSIER_HEADINGS[k].en) === h || norm(DOSSIER_HEADINGS[k].de) === h) ?? null;
};

interface Section {
  key: DossierKey;
  /** Line of the heading. */
  start: number;
  /** First line after the section. */
  end: number;
}

/** The dossier sections of a note: from their heading to the next heading of the same or a higher level. */
function sections(lines: readonly string[]): Section[] {
  const heads: { line: number; level: number; key: DossierKey | null }[] = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) heads.push({ line: i, level: m[1]!.length, key: keyOf(m[2]!) });
  });
  const out: Section[] = [];
  heads.forEach((h, i) => {
    if (!h.key || out.some((s) => s.key === h.key)) return;
    const next = heads.slice(i + 1).find((n) => n.level <= h.level);
    out.push({ key: h.key, start: h.line, end: next ? next.line : lines.length });
  });
  return out;
}

export interface Dossier {
  /** "Where things stand" as Markdown; "" when the section is missing or empty. */
  state: string;
  /** The open points, one per list item (ticked items are left out). */
  open: string[];
  /** The user's own notes as Markdown. */
  own: string;
  /** Which sections exist in the note. */
  has: Record<DossierKey, boolean>;
}

export function parseDossier(md: string): Dossier {
  const lines = md.split("\n");
  const found = sections(lines);
  const body = (key: DossierKey) => {
    const s = found.find((x) => x.key === key);
    return s
      ? lines
          .slice(s.start + 1, s.end)
          .join("\n")
          .trim()
      : "";
  };
  const open = body("open")
    .split("\n")
    .map((l) => /^\s*(?:[-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s+)?(.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m && !m[1]?.trim())
    .map((m) => m[2]!.trim());
  return {
    state: body("state"),
    open,
    own: body("own"),
    has: { state: found.some((s) => s.key === "state"), open: found.some((s) => s.key === "open"), own: found.some((s) => s.key === "own") },
  };
}

/** Line where a first section goes: after a leading title (H1) and the quote under it (TL;DR). */
function topOf(lines: readonly string[]): number {
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  if (i >= lines.length || !/^#\s+/.test(lines[i]!)) return 0;
  i++;
  let j = i;
  while (j < lines.length && !lines[j]!.trim()) j++;
  if (j < lines.length && lines[j]!.startsWith(">")) {
    while (j < lines.length && lines[j]!.startsWith(">")) j++;
    return j;
  }
  return i;
}

/**
 * Writes one agent section: replaces its body when the section exists, otherwise inserts it in
 * dossier order (state, open, own). Everything else in the note stays as it is; free text below a
 * first section gets the heading of the user's own notes.
 */
export function setSection(md: string, key: AgentDossierKey, body: string, locale: "en" | "de"): string {
  const lines = md.split("\n");
  const found = sections(lines);
  const text = body.trim();
  const here = found.find((s) => s.key === key);
  let next: string[];
  if (here) {
    const tail = lines.slice(here.end);
    next = [...lines.slice(0, here.start + 1), "", ...(text ? [text, ""] : []), ...tail];
  } else {
    const block = [`## ${DOSSIER_HEADINGS[key][locale]}`, "", ...(text ? [text, ""] : [])];
    const later = found.filter((s) => ORDER.indexOf(s.key) > ORDER.indexOf(key)).sort((a, b) => a.start - b.start)[0];
    const earlier = found.filter((s) => ORDER.indexOf(s.key) < ORDER.indexOf(key)).sort((a, b) => b.end - a.end)[0];
    const at = later ? later.start : earlier ? earlier.end : topOf(lines);
    const head = lines.slice(0, at);
    while (head.length && !head[head.length - 1]!.trim()) head.pop();
    const rest = lines.slice(at);
    while (rest.length && !rest[0]!.trim()) rest.shift();
    // Free text that would follow the new section becomes the user's own notes, so a later update of
    // the section can never overwrite it.
    const loose = !later && !earlier && rest.length > 0 && !/^#{1,2}\s+/.test(rest[0]!);
    next = [...head, ...(head.length ? [""] : []), ...block, ...(loose ? [`## ${DOSSIER_HEADINGS.own[locale]}`, ""] : []), ...rest];
  }
  return next.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}

export interface DossierUpdate {
  /** New text of "Where things stand". */
  state?: string;
  /** The complete new list of open points. */
  open?: readonly string[];
}

/** Applies the agent's update. The user's own notes and every other part of the note are kept. */
export function updateDossier(md: string, update: DossierUpdate, locale: "en" | "de"): string {
  let next = md;
  if (update.state !== undefined) next = setSection(next, "state", update.state, locale);
  if (update.open !== undefined) {
    const points = update.open.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
    // Plain bullets, not "- [ ]": a checklist item would be synced into the task list.
    next = setSection(next, "open", points.map((p) => `- ${p}`).join("\n"), locale);
  }
  return next;
}

export interface TimelineEntryLike {
  id: string;
  title: string;
  type: string;
  date: string;
  time?: string;
}

/** The dossier's history: linked meetings and mentions, newest first. */
export function dossierTimeline<T extends TimelineEntryLike>(meetings: readonly T[], mentions: readonly T[], max = 6): T[] {
  return [...meetings, ...mentions].sort((a, b) => (b.date + (b.time ?? "")).localeCompare(a.date + (a.time ?? ""))).slice(0, max);
}
