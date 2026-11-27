/*
 * Command palette, Ruhe look (W6): entries first, each with a grey subtitle "Typ · Detail", then actions for the
 * active entry (ask the agent with Tab, briefing, favourite, move). Pure helpers, so the wording is unit-tested.
 */

/** Object types the palette offers a briefing for (dossier-like entries). */
const BRIEFABLE = new Set(["person", "organization", "project"]);

export const canBrief = (type: string | undefined): boolean => !!type && BRIEFABLE.has(type);

/** "14.10." (de) or "10/14" (en): the short day an entry belongs to. */
export function shortDay(iso: string, locale: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  // ICU versions differ on the German trailing dot ("14.10" vs "14.10."): normalise it.
  const s = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(d).replace(/\.$/, "");
  return locale.startsWith("de") ? s + "." : s;
}

export interface SubtitleInput {
  type: string;
  typeLabel: string;
  date?: string;
  /** Object metadata: role and organization for people, status for projects. */
  metadata?: Record<string, unknown>;
  /** Matching passage from the hybrid search. */
  snippet?: string;
  today: string;
  locale: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Grey subtitle after the title: "Person · CTO, Nordlicht Systems", "Meeting · 14.10.", "Notiz · <passage>".
 * The type always leads; the detail is the object's role, a search passage, or the day (not for today).
 */
export function entrySubtitle(x: SubtitleInput): string {
  const role = [str(x.metadata?.role), str(x.metadata?.organization)].filter(Boolean).join(", ");
  const detail = role || str(x.snippet) || (x.date && x.date !== x.today ? shortDay(x.date, x.locale) : "");
  return detail ? `${x.typeLabel} · ${detail}` : x.typeLabel;
}

/** A query of one word is a name or a topic: the agent is asked what is open there; longer text goes as typed. */
export const isSingleTerm = (q: string): boolean => !!q && !/\s/.test(q.trim()) && !/[?？]$/.test(q.trim());

/** Folders for "Verschieben nach …": match on name or path, shallow ones first, at most `limit`. */
export function matchFolders<T extends { name: string; path: string; depth: number }>(folders: readonly T[], q: string, limit = 8): T[] {
  const ql = q.trim().toLowerCase();
  const hits = ql ? folders.filter((f) => f.path.toLowerCase().includes(ql) || f.name.toLowerCase().includes(ql)) : [...folders];
  return hits.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)).slice(0, limit);
}
