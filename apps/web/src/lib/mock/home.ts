/*
 * Mock content of the Home dashboard, taken 1:1 from design/reference/Home.dc.html (renderVals()).
 * Live mode replaces it with lib/data/home.ts (server/home/**); the shapes below are shared.
 * Note ids refer to lib/mock/notes.ts.
 */

import type { TagDomain } from "@kortex/ui";
import { t } from "@/i18n";

/** Hero and card images (copies of design/reference/assets, served from apps/web/public/home). */
export const HOME_IMG = {
  home: "/home/home.webp",
  journal: "/home/journal.webp",
  meeting: "/home/meeting.webp",
  book: "/home/book.webp",
  ribbons: "/home/ribbons.webp",
  salmon: "/home/salmon.webp",
  runner: "/home/runner.webp",
  hyrox: "/home/hyrox.webp",
  podcast: "/home/podcast.webp",
  desk: "/home/desk.webp",
  car: "/home/car.webp",
  skyline: "/home/skyline.webp",
  facade: "/home/facade.webp",
} as const;

/** Where a card leads: a note opens in the half-side drawer, the reader is a route (no id: the mock book). */
export type HomeTarget = { kind: "note"; id: string } | { kind: "reader"; id?: string };

const note = (id: string): HomeTarget => ({ kind: "note", id });
const reader: HomeTarget = { kind: "reader" };

/**
 * Sections the "Anpassen" menu can hide, in render order (v2: Quick Jump removed, Smart Mixes moved to Spaces).
 * Hidden keys persisted by older versions ("q", "m") are ignored.
 */
export type HomeSectionKey = "b" | "j" | "c" | "r";
export const HOME_SECTIONS: { key: HomeSectionKey; label: string }[] = [
  { key: "b", get label() { return t("Morning Briefing"); } },
  { key: "j", get label() { return t("Continue where you left off"); } },
  { key: "c", get label() { return t("Daily Check-in"); } },
  { key: "r", get label() { return t("Rediscover"); } },
];
export const HOME_SECTION_KEYS: readonly HomeSectionKey[] = HOME_SECTIONS.map((s) => s.key);

export interface BriefingItem {
  key: string;
  text: string;
  /** Recording timestamp of the action item ("[14:20]"). */
  ts: string | null;
  /** Live: the action_items id (ticking it completes the task) and its due day. */
  id?: string;
  due?: string | null;
}

export const BRIEFING = {
  title: "Morning Briefing",
  summary: "Q4 architecture sync at 11:00, 2 open action items from the last call.",
  meetingNoteId: "n2",
  items: [
    { key: "a", text: "Send the checksum concept (SHA-256) to Tom", ts: "14:20" },
    { key: "b", text: "Add the .conflict.md failure case to the spec", ts: "31:05" },
  ] satisfies BriefingItem[],
};

/** Seed of the Daily Check-in widget (habit and focus definitions, prototype defaults). */
export const DAILY_SEED = {
  heroImg: HOME_IMG.runner,
  streak: 14,
  energy: 9,
  habits: [
    { key: "mob", label: "Morning Mobility", done: true },
    { key: "carb", label: "Low-carb focus", done: true },
  ],
  focus: [
    { key: "a", text: "Prepare the architecture sync", done: false },
    { key: "b", text: "Mobility session and meal prep", done: false },
    { key: "c", text: "Read chapter 3, Contextual Retrieval", done: false },
  ],
};

export const REDISCOVER = {
  yearAgo: {
    title: "First sketch of a second brain",
    quote:
      "\"I don't want to file things any more, only drop them in. The system should sort, link and remind me at the right time.\"",
    since: "Since then: 148 entries, 6 life areas, a 14-day journal streak. The idea became a working second brain.",
  },
  flashcards: {
    deck: "AI Engineering",
    cards: [
      ["Why do chunks without context lose meaning?", "A sentence on its own names neither source nor topic, so its embedding matches vague questions less well."],
      ["Which indexes gain from the added context?", "Embeddings and BM25 alike, because both see the same extra context."],
      ["How do you cut the cost of writing the context?", "With prompt caching: the document is cached once and every chunk uses the cache."],
    ] as [question: string, answer: string][],
    doneHint: "Next review on Monday. Spaced repetition with SM-2.",
  },
  fitsToday: {
    eyebrow: "Fits today · 11:00 Q4 Architecture Sync",
    title: "Claude Code Session Memory",
    text: "Two days ago you decided that sync conflicts are handed to the vault service. That is exactly what Tom asks today.",
    img: HOME_IMG.ribbons,
    target: note("n4"),
  },
};

export interface BackInCard {
  title: string;
  meta: string;
  /** Own or extracted cover; null = the type tile of the active theme pack (resolved on the client). */
  img: string | null;
  /** Knowledge item type, for the pack tile fallback. */
  type?: string;
  /** Read / listen progress in percent; null hides the bar. */
  pct: number | null;
  target: HomeTarget;
}

export const JUMP_BACK_IN: BackInCard[] = [
  { title: "AI Engineering, Chapter 3", meta: "Continue from p. 42", img: HOME_IMG.book, pct: 13, target: reader },
  { title: "Q4 Architecture Sync", meta: "Recording from [14:20]", img: HOME_IMG.meeting, pct: 42, target: note("n2") },
  { title: "Podcast: Zone 2 Training", meta: "23 min left", img: HOME_IMG.podcast, pct: 61, target: note("n12") },
  { title: "Hill Sprint Technique", meta: "Reel, saved yesterday", img: HOME_IMG.hyrox, pct: 100, target: note("n7") },
  { title: "Blue Ocean Notes", meta: "Last edited", img: HOME_IMG.desk, pct: 30, target: note("n11") },
];

export interface SmartMix {
  title: string;
  short: string;
  tag: string;
  /** Tag colour domain for the cover gradient (`--tag-<tone>-dot`). */
  tone: TagDomain;
  img: string;
  /** Entries in the mix (live); mock tiles count the mock notes. */
  count?: number;
}

export const SMART_MIXES: SmartMix[] = [
  { title: "MCP and Agents", short: "MCP", tag: "#ai/mcp", tone: "ai", img: HOME_IMG.car },
  { title: "Running Week", short: "Running", tag: "#fitness/running", tone: "health", img: HOME_IMG.hyrox },
  { title: "Low-Carb Kitchen", short: "Low-Carb", tag: "#recipes/low-carb", tone: "food", img: HOME_IMG.salmon },
  { title: "Strategy Course", short: "Strategy", tag: "#strategy/course", tone: "strategy", img: HOME_IMG.skyline },
  { title: "First Home Learning Path", short: "Real Estate", tag: "#real-estate", tone: "finance", img: HOME_IMG.facade },
];
