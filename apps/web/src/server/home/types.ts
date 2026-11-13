/*
 * Payloads of the live Home dashboard (server/home/actions.ts → lib/data/home.ts). Type-only, so
 * client code can import it without pulling server modules into the bundle.
 */

/** "Weiter, wo Du warst": a recently opened or edited item. */
export interface HomeBackInItem {
  id: string;
  type: string;
  title: string;
  /** "Weiterlesen ab S. 42", "Zuletzt bearbeitet · gestern", … */
  meta: string;
  /** knowledge_items.cover_image_url; null = the client picks artwork by type. */
  img: string | null;
  /** Reading progress 0..100 (pdf/epub with reading_state); null hides the bar. */
  pct: number | null;
  /** Opens in the split reader (stored pdf/epub) instead of the note drawer. */
  reader: boolean;
}

/** "Heute vor einem Jahr" or, without such an item, an older one from the archive. */
export interface HomeArchiveItem {
  id: string;
  title: string;
  quote: string;
  /** ISO timestamp the item was created. */
  createdAt: string;
  /** Created within a few days of exactly one year ago. */
  yearAgo: boolean;
  /** Items created since then (null when unknown). */
  since: number | null;
}

export interface HomeFlashDeck {
  itemId: string;
  deck: string;
  cards: [question: string, answer: string][];
}

/** "Passt zu heute": an older item the hybrid search ties to recent activity. */
export interface HomeFitsToday {
  id: string;
  type: string;
  title: string;
  text: string;
  img: string | null;
  /** Title of the recent item or focus it relates to. */
  seed: string;
  reader: boolean;
}

/** The most recent meeting item of the last 24 hours (feeds the meeting card). */
export interface HomeMeeting {
  id: string;
  title: string;
  startedAt: string | null;
  durationSec: number | null;
  people: string[];
  /** First decision, else the summary. */
  coaching: string | null;
  status: string;
}

/** Smart Mix: a hashtag that at least two items share. */
export interface HomeMix {
  /** Tag without "#", e.g. "fitness/hyrox". */
  tag: string;
  count: number;
  /** Cluster most of the tagged items belong to (null when mixed or "General"). */
  cluster: string | null;
  img: string | null;
}

export interface HomeData {
  backIn: HomeBackInItem[];
  archive: HomeArchiveItem | null;
  flashcards: HomeFlashDeck | null;
  fitsToday: HomeFitsToday | null;
  meeting: HomeMeeting | null;
  mixes: HomeMix[];
}

export interface HomeBriefingTask {
  id: string;
  text: string;
  /** Recording timestamp of a meeting action item ("14:20"). */
  ts: string | null;
  /** YYYY-MM-DD */
  due: string | null;
  sourceItemId: string | null;
}

/**
 * - `ai`: generated today by the summarize route
 * - `template`: nothing to brief yet (no model call)
 * - `fallback`: the model call failed; a plain sentence from the counts
 */
export type BriefingKind = "ai" | "template" | "fallback";

/** The per-day cached part of the briefing (the client keeps a copy in localStorage). */
export interface BriefingSummary {
  date: string;
  summary: string;
  /** Task ids the model ranked first. */
  taskIds: string[];
  kind: BriefingKind;
  /** "<provider>:<model>" of the summarize route, null without a model call. */
  model: string | null;
  generatedAt: string;
}

export interface HomeBriefing extends BriefingSummary {
  /** Open tasks, freshly loaded on every call (up to 3). */
  tasks: HomeBriefingTask[];
  openTaskCount: number;
  /** Today's meeting, else the source item of the first task. */
  noteId: string | null;
  noteIsMeeting: boolean;
}
