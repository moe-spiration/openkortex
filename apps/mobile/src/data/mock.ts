/* eslint-disable @typescript-eslint/no-require-imports -- Metro resolves bundled images through require() */
import type { ImageSourcePropType } from "react-native";
import type { CoverSource } from "../theme/cover";
import type { TagTone } from "../theme/tokens";
import { toneOfTag } from "./live";

/*
 * Mock content of the mobile app, taken 1:1 from design/reference/Mobile.dc.html (renderVals()).
 * Etappe 2: entries, areas and inbox jobs come from the API; the shapes stay. The texts are fictional English demo data.
 */

export const IMG = {
  home: require("../../assets/img/home.webp"),
  journal: require("../../assets/img/journal.webp"),
  meeting: require("../../assets/img/meeting.webp"),
  book: require("../../assets/img/book.webp"),
  ribbons: require("../../assets/img/ribbons.webp"),
  salmon: require("../../assets/img/salmon.webp"),
  hyrox: require("../../assets/img/hyrox.webp"),
  podcast: require("../../assets/img/podcast.webp"),
  desk: require("../../assets/img/desk.webp"),
  facade: require("../../assets/img/facade.webp"),
  runner: require("../../assets/img/runner.webp"),
  skyline: require("../../assets/img/skyline.webp"),
  stones: require("../../assets/img/stones.webp"),
  loft: require("../../assets/img/loft.webp"),
  dinner: require("../../assets/img/dinner.webp"),
  car: require("../../assets/img/car.webp"),
} satisfies Record<string, ImageSourcePropType>;

export type EntryKind = "note" | "meeting" | "read" | "ai" | "food" | "video" | "object";

export interface Entry {
  id: string;
  kind: EntryKind;
  type: string;
  when: string;
  img: CoverSource;
  title: string;
  tag: string;
  tldr: string;
  points: string[];
  /** Days ago (0 = today). */
  day: number;
  who: string[];
  /** Rank of "zuletzt geöffnet" (0 = most recent). */
  opened: number;
  time: string;
  /** Sort key: lower = newer. */
  ts: number;
  whenShort: string;
  /** Live: kortex.knowledge_items.is_favorite / folder_path. */
  fav?: boolean;
  /** Live: knowledge_items.type (raw) and metadata, for the Eigenschaften panel. */
  itemType?: string;
  meta?: Record<string, unknown>;
  /** Live: is_pinned ("Markiert"). */
  pinned?: boolean;
  /** Live: remind_at (ISO), the snooze of the Erinnerung row in the detail sheet. */
  remindAt?: string | null;
  /** Live: metadata.read_at is set ("Gelesen"). */
  read?: boolean;
  /** G4: status `archived` (only in the Archiv view). */
  archived?: boolean;
  folder?: string;
  /** Live: full Markdown (content_md), source link, processing error. */
  content?: string;
  url?: string | null;
  error?: string | null;
}

type Raw = Omit<Entry, "day" | "who" | "opened" | "time" | "ts" | "whenShort">;

const RAW: Raw[] = [
  { id: "e1", kind: "note", type: "Note", when: "Today, 08:12", img: IMG.journal, title: "Daily journal 2026-10-22", tag: "#side-project", tldr: "Energy 9 out of 10. Focus today: prepare the architecture sync and read chapter 3.", points: ["Prepare the architecture sync", "Mobility session and meal prep", "Read chapter 3 on contextual retrieval"] },
  { id: "e2", kind: "meeting", type: "Meeting", when: "Today, 11:00", img: IMG.meeting, title: "Q4 architecture sync", tag: "#it/platform", tldr: "Detect vault sync conflicts with SHA-256 and store them as .conflict.md. Users decide before anything is overwritten.", points: ["Send the checksum concept to Tom [14:20]", "Check the diff view in the conflict dialog", "Confirm the Q4 release plan"] },
  { id: "e3", kind: "read", type: "Book", when: "Yesterday, 21:30", img: IMG.book, title: "AI Engineering: Contextual Retrieval", tag: "#ai/agents", tldr: "Chunks lose their meaning without context. A short context in front of each chunk improves embeddings and BM25.", points: ["Context per chunk before embedding", "Combine BM25 with a reranker", "Prompt caching cuts the cost"] },
  { id: "e4", kind: "ai", type: "AI Memory", when: "Yesterday, 18:55", img: IMG.ribbons, title: "Coding agent session memory", tag: "#ai/mcp", tldr: "Session on connecting the vault over MCP: tool schema, permission model and open questions about sync.", points: ["Tool schema for vault.search", "Read-only access by default", "Leave sync conflicts to the vault service"] },
  { id: "e5", kind: "food", type: "Recipe", when: "Yesterday, 12:10", img: IMG.salmon, title: "Low-carb salmon and spinach roll", tag: "#recipes/low-carb", tldr: "A spinach and egg sheet rolled with salmon and cream cheese. About 30 minutes, easy to prepare ahead.", points: ["Bake the spinach and egg sheet for 12 min.", "Spread cream cheese, add salmon", "Chill for at least 1 hour"] },
  { id: "e6", kind: "video", type: "Reel", when: "Yesterday, 20:15", img: IMG.hyrox, title: "Hill sprint technique", tag: "#fitness/running", tldr: "Lean from the ankles, drive with the arms, short quick steps. Settle your breathing before the start.", points: ["Lean from the ankles", "Drive with the arms", "Short, quick steps"] },
  { id: "e7", kind: "video", type: "Podcast", when: "Mon, 07:30", img: IMG.podcast, title: "Podcast: Zone 2 training", tag: "#fitness/running", tldr: "Zone 2 builds the aerobic base. Three sessions a week are enough for noticeable progress.", points: ["Heart rate at talking pace", "3 times 45 minutes a week", "Lactate test every 8 weeks"] },
  { id: "e8", kind: "note", type: "Note", when: "Mon, 19:40", img: IMG.desk, title: "Blue Ocean notes", tag: "#strategy/course", tldr: "Sketched the value curve for Atlas: less setup and more automatic order than classic note apps.", points: ["Eliminate: manual folder upkeep", "Raise: auto-routing", "Create: live coaching in calls"] },
  { id: "e9", kind: "read", type: "Article", when: "Sun, 10:05", img: IMG.facade, title: "First home: how much mortgage is sensible?", tag: "#real-estate", tldr: "From net income to a safe monthly rate, step by step: budget, equity, fixed-rate period.", points: ["Work out the monthly budget", "Bring at least 20% equity", "Compare fixed-rate periods"] },
  { id: "e10", kind: "read", type: "Article", when: "Today, 09:30", img: IMG.car, title: "MCP servers in a logistics backend", tag: "#ai/mcp", tldr: "How an MCP server wraps tracking data and knowledge sources for agents in a logistics backend without loosening permissions.", points: ["Cut tools per domain", "Read-only access by default", "Audit log for every tool call"] },
  { id: "e11", kind: "meeting", type: "Meeting", when: "Mon, 14:00", img: IMG.skyline, title: "1:1 Priya", tag: "#strategy/course", tldr: "Priorities for Q4, the hiring plan and feedback on the team setup.", points: ["Hiring plan by Friday", "Feedback round in November", "Prepare the Q1 budget"] },
  { id: "e12", kind: "meeting", type: "Meeting", when: "Fri, 10:00", img: IMG.meeting, title: "Weekly with Tom", tag: "#it/platform", tldr: "Showed the sync prototype; open questions about conflicts and offline mode.", points: ["Collect conflict cases", "Test offline mode", "Demo in the Q4 sync"] },
];

/** [day, people, opened-rank] per entry (prototype META). */
const META: Record<string, [number, string[], number]> = {
  e1: [0, ["Max"], 0], e2: [0, ["Tom", "Priya"], 1], e3: [1, [], 2], e4: [1, [], 3], e5: [1, [], 6], e6: [1, [], 5],
  e7: [3, [], 7], e8: [3, [], 8], e9: [7, [], 10], e10: [0, [], 4], e11: [3, ["Priya"], 9], e12: [6, ["Tom"], 11],
};

export const ENTRIES: Entry[] = RAW.map((e) => {
  const [day, who, opened] = META[e.id]!;
  const time = e.when.split(", ")[1]!;
  const [hh, mm] = time.split(":").map(Number);
  return { ...e, day, who, opened, time, ts: day * 1440 - ((hh ?? 0) * 60 + (mm ?? 0)), whenShort: e.when.split(", ")[0]! };
});

export const entryById = (id: string): Entry | undefined => ENTRIES.find((e) => e.id === id);

/** Hashtag → colour tone (prototype TAGC). */
export const TAG_TONE: Record<string, TagTone> = {
  "#side-project": "ai",
  "#ai/mcp": "ai",
  "#ai/agents": "ai",
  "#it/platform": "auto",
  "#fitness/running": "health",
  "#recipes/low-carb": "food",
  "#strategy/course": "strategy",
  "#real-estate": "finance",
};
export const tagTone = (tag: string): TagTone => TAG_TONE[tag] ?? toneOfTag(tag);

export interface LifeArea {
  key: string;
  name: string;
  /** Colour of the area's dot (same domains as the web sidebar). */
  tone: TagTone;
  img: CoverSource;
  score: number;
  vision: string;
  goals: [string, number][];
}

export const AREAS: LifeArea[] = [
  { key: "health", tone: "health", name: "Health", img: IMG.runner, score: 82, vision: "Fit and resilient for the long run: a half marathon under 1:50, pain-free and with energy for everything else.", goals: [["Half marathon plan, 12 weeks", 58], ["Mobility 5 times a week", 80], ["Low-carb on weekdays", 72]] },
  { key: "career", tone: "strategy", name: "Career", img: IMG.skyline, score: 70, vision: "Lead technology teams that make an impact through products and people.", goals: [["Strategy course module", 65], ["Weekly leadership journal", 70]] },
  { key: "finance", tone: "finance", name: "Finance", img: IMG.stones, score: 61, vision: "A solid base of savings, investments and a first home of our own.", goals: [["Mortgage offer from Harbour Bank", 40], ["Monthly review", 75]] },
  { key: "ventures", tone: "ai", name: "Ventures", img: IMG.loft, score: 76, vision: "Build products that make my own day easier, and share them with others.", goals: [["Atlas MVP", 76], ["First 20 beta users", 35]] },
  { key: "relations", tone: "food", name: "Relationships", img: IMG.dinner, score: 68, vision: "Be there for the people who matter to me, with fixed time together.", goals: [["One evening together per week", 70], ["See friends once a month", 55]] },
  { key: "growth", tone: "strategy", name: "Growth", img: IMG.journal, score: 79, vision: "Think, write and decide a little more clearly every day.", goals: [["Journal streak of 30 days", 47], ["12 books a year", 66]] },
];

export const MODELS = ["Claude 3.7 Sonnet", "Gemini 2.5 Pro", "Gemini 2.5 Flash", "GPT-4o", "DeepSeek R1"];

/** Shopping list of the Home recipe card. */

/** "Jump back in" carousel. */
export const JUMP = [
  { title: "AI Engineering", meta: "Continue from p. 42", img: IMG.book, pct: 13, id: "e3" },
  { title: "Q4 architecture sync", meta: "Recording from 14:20", img: IMG.meeting, pct: 42, id: "e2" },
  { title: "Zone 2 training", meta: "23 min. left", img: IMG.podcast, pct: 61, id: "e7" },
  { title: "Blue Ocean notes", meta: "Last edited", img: IMG.desk, pct: 30, id: "e8" },
];

/** Active inbox jobs (progress ticks in the UI) and "processed today". */
export const INBOX_JOBS = [
  { title: "Reel: hill sprint drills", img: IMG.hyrox, steps: ["Transcribing the audio", "Analysing the frames", "Done, filed in Reels and videos"], start: 64, rate: 7 },
  { title: "Article: Contextual Retrieval", img: IMG.book, steps: ["Loading the full text", "Summary and tags", "Done, filed in Articles and web"], start: 28, rate: 5 },
];
export const PROCESSED: { title: string; space: string; id: string }[] = [
  { title: "Daily journal 2026-10-22", space: "Notes", id: "e1" },
  { title: "Low-carb salmon and spinach roll", space: "Recipes", id: "e5" },
  { title: "Coding agent session memory", space: "AI Memories", id: "e4" },
];

export const FILTER_CHIPS: [string, string][] = [
  ["all", "All"], ["note", "Notes"], ["meeting", "Meetings"], ["read", "Articles and books"], ["video", "Reels and podcasts"], ["food", "Recipes"], ["ai", "AI Memories"], ["object", "Objects"],
];
export const SORTS: [string, string][] = [["rel", "Relevance"], ["new", "Newest"], ["old", "Oldest"], ["open", "Recently opened"], ["az", "A to Z"]];

export const SEARCH_SUGGESTIONS = ["Meetings with Tom this week", "Low-carb recipes under 30 min.", "What did I save about MCP?"];
export const ASK_SUGGESTIONS = ["Summarise chapter 3", "Flashcards on MCP", "What did I learn this week?"];

export const NOTE_TAGS: [string, TagTone][] = [["#ai/mcp", "ai"], ["#fitness/running", "health"], ["#strategy/course", "strategy"]];
