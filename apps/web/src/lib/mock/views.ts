import type { ObjectType } from "@kortex/ui";
import { t } from "@/i18n";

/*
 * Mock data of the multi-view pages (spaces, object hubs, vault folders, Universal Inbox, tasks hub).
 * Cover images and the task list are taken from design/reference/WebApp.dc.html (IMG / IMGOF / taskDefs);
 * domain objects are not part of the prototype and follow the wireframe 3.2 of the UX spec.
 * Etappe 2: replace with @kortex/db queries (knowledge_items, action_items); keep the shapes.
 */

/* ------------------------------------------------------------------ covers */

export const COVER_FILES = {
  book: "dce371d5fe87d39ead096ad81beaa92b",
  car: "ad14d540b13a070e990df8fd58f0eb71",
  desk: "f1fb2d33b2667ac5aedddd8d788ea8e8",
  facade: "4be5e25d35d274bedc615029a4354e78",
  hyrox: "8cedce7fec1b571a217275ef3b8a5b24",
  journal: "dd1fcc570d1beb5c5e756f81aad5c4ef",
  loft: "e05c890d386cfa7c52180fddd8ae7c69",
  meeting: "5c727846c5fc882a6cde5030a4ea3471",
  podcast: "935f1137fe43d1a7349677fa5fb32534",
  ribbons: "58ae650219e2d4d1bb350f6eb3bacdcf",
  runner: "6cd926479e9c9d39f38deae4f982cb0a",
  salmon: "334a2153df8743c937d48857e24af501",
  skyline: "a7824420aed9d782aefce419b2dcb4a9",
  stones: "5e3a4d73e58b25218867bbb011a5d618",
  dinner: "ef84a28e7f9e6b9f641b44170044aa9d",
} as const;

export type CoverKey = keyof typeof COVER_FILES;

export const coverSrc = (key: CoverKey): string => `/views/${COVER_FILES[key]}.webp`;

/** Cover of each note (prototype IMGOF). */
export const NOTE_COVER: Record<string, CoverKey> = {
  n1: "journal", n2: "meeting", n3: "book", n4: "ribbons", n5: "salmon", n6: "runner", n7: "hyrox", n8: "car", n9: "skyline",
  n10: "facade", n11: "desk", n12: "podcast", n13: "loft", n14: "ribbons", n15: "meeting", n16: "salmon", n17: "stones",
  n18: "skyline", n19: "journal", n20: "hyrox", n21: "journal", n22: "skyline", n23: "stones", n24: "ribbons", n25: "dinner",
};

/* ------------------------------------------------------------------ domain objects */

export type DomainType = Exclude<ObjectType, "note">;

export type ObjectMeta =
  | { type: "person"; role: string; org: string }
  | { type: "organization"; kind: string; industry: string; contacts: number }
  | { type: "project"; status: "Planning" | "In Progress" | "Review" | "Done"; progress: number; due: string }
  | { type: "concept"; kind: string; links: number }
  | { type: "tool"; category: string; version: string; inStack: boolean }
  /** `status` and the organization `kind` are stored enum values (lib/objects/schema.ts, shown through objectOptionLabel). */
  | { type: "asset"; kind: string; value: number; status: string }
  | { type: "goal"; period: string; progress: number; metric: string };

export type DomainObject = {
  id: string;
  /** Vault path in 70_Objects/<Type>/. */
  path: string;
  title: string;
  date: string;
  time: string;
  tags: string[];
  tldr: string;
  cover: CoverKey;
  /** Mock note the object was last mentioned in (becomes its backlink in the note sheet). */
  noteId: string;
  meta: ObjectMeta;
};

const o = (
  id: string,
  folder: string,
  file: string,
  title: string,
  date: string,
  time: string,
  tags: string[],
  tldr: string,
  cover: CoverKey,
  noteId: string,
  meta: ObjectMeta,
): DomainObject => ({ id, path: `70_Objects/${folder}/${file}.md`, title, date, time, tags, tldr, cover, noteId, meta });

export const OBJECTS: DomainObject[] = [
  o("o-p1", "People", "Priya-Shah", "Dr. Priya Shah", "2026-10-22", "08:30", ["#it/platform", "#ai/mcp"],
    "Agreed on an architecture review for the MCP rollout. Contact for the platform strategy.", "desk", "n2",
    { type: "person", role: "VP Engineering", org: "Northwind Logistics" }),
  o("o-p2", "People", "Tom-Becker", "Tom Becker", "2026-10-22", "09:05", ["#it/platform"],
    "Asks about conflict cases in the architecture sync. Waiting for the SHA-256 checksum concept.", "meeting", "n2",
    { type: "person", role: "Principal Architect", org: "Northwind Logistics" }),
  o("o-p3", "People", "Elena-Ruiz", "Elena Ruiz", "2026-10-06", "16:30", ["#real-estate", "#finance/invest"],
    "Adviser in the mortgage meeting. Sends the document checklist and rates for 10 to 15 years fixed.", "stones", "n23",
    { type: "person", role: "Mortgage adviser", org: "Harbour Bank" }),
  o("o-p4", "People", "Jonas-Berg", "Jonas Berg", "2026-10-14", "10:05", ["#fitness/running"],
    "Running coach. Recommends hill sprints twice a week and a solid Zone 2 base.", "hyrox", "n20",
    { type: "person", role: "Running coach", org: "Riverside Runners" }),

  o("o-pr1", "Projects", "Atlas-App", "Atlas Reading App", "2026-10-22", "10:15", ["#side-project", "#ai/mcp"],
    "Side project: a reading app that turns highlights into notes. Next step: the library views.", "loft", "n13",
    { type: "project", status: "In Progress", progress: 62, due: "Dec 31" }),
  o("o-pr2", "Projects", "Gardener-Pipeline", "Gardener Pipeline", "2026-10-22", "08:30", ["#side-project", "#ai/agents"],
    "The AI gardener sorts clips: transcribe, tag, link, add context. Prototype planned for next week.", "ribbons", "n13",
    { type: "project", status: "Planning", progress: 20, due: "Nov 15" }),
  o("o-pr3", "Projects", "Blue-Ocean-Canvas", "Blue Ocean Canvas (Strategy Course)", "2026-10-22", "08:50", ["#strategy/course", "#leadership"],
    "Four-actions grid and value curve for the strategy course, with an example from a logistics platform.", "desk", "n11",
    { type: "project", status: "Review", progress: 85, due: "Oct 25" }),
  o("o-pr4", "Projects", "First-Home", "First Home", "2026-10-13", "11:20", ["#real-estate", "#finance/invest"],
    "Apartment search with a checklist, yield calculation and the mortgage meeting. Viewings still open.", "facade", "n10",
    { type: "project", status: "In Progress", progress: 35, due: "Jun 30" }),

  o("o-o1", "Organizations", "Northwind-Logistics", "Northwind Logistics", "2026-10-22", "09:05", ["#it/platform", "#cloud"],
    "Employer (fictional). Platform programme with a weekly steering committee and architecture sync.", "skyline", "n9",
    { type: "organization", kind: "Arbeitgeber", industry: "Logistics", contacts: 6 }),
  o("o-o2", "Organizations", "Atlas-Labs", "Atlas Labs", "2026-10-21", "18:55", ["#side-project", "#ai/agents"],
    "Side venture around the Atlas reading app. Focus: capture, MCP server and web app.", "loft", "n4",
    { type: "organization", kind: "Venture", industry: "Software", contacts: 3 }),
  o("o-o3", "Organizations", "Harbour-Bank", "Harbour Bank", "2026-10-06", "16:30", ["#real-estate", "#finance/invest"],
    "Mortgage partner for the first home. The terms depend heavily on deposit and term.", "stones", "n23",
    { type: "organization", kind: "Bank", industry: "Finance", contacts: 1 }),

  o("o-c1", "Concepts", "Contextual-Retrieval", "Contextual Retrieval", "2026-10-21", "21:30", ["#ai/agents", "#ai/mcp"],
    "Every chunk gets context in front of it. Improves embeddings and BM25 at the same time.", "book", "n3",
    { type: "concept", kind: "Framework", links: 7 }),
  o("o-c2", "Concepts", "Blue-Ocean-Strategy", "Blue Ocean Strategy", "2026-10-22", "08:50", ["#strategy/course"],
    "New markets instead of competition: value curve, four-actions grid, eliminate and reduce.", "desk", "n11",
    { type: "concept", kind: "Strategy framework", links: 4 }),
  o("o-c3", "Concepts", "Zone-2-Training", "Zone 2 Training", "2026-10-20", "19:30", ["#fitness/running"],
    "Easy base training as the foundation for a half marathon: weekly volume and heart rate range.", "podcast", "n12",
    { type: "concept", kind: "Training method", links: 3 }),

  o("o-t1", "Tools", "Supabase", "Supabase", "2026-10-21", "18:55", ["#side-project"],
    "Postgres with pgvector, auth, storage and realtime. Self-hosted with Docker.", "ribbons", "n4",
    { type: "tool", category: "Database", version: "Postgres 15", inStack: true }),
  o("o-t2", "Tools", "Deepgram-Nova-3", "Deepgram Nova-3", "2026-10-22", "09:05", ["#side-project", "#ai/mcp"],
    "Live transcription of meetings in 16 kHz stereo with speaker separation.", "meeting", "n2",
    { type: "tool", category: "Transcription", version: "Nova-3", inStack: true }),
  o("o-t3", "Tools", "OpenRouter", "OpenRouter", "2026-10-20", "15:45", ["#ai/agents"],
    "Gateway for switchable models, zero data retention by default.", "ribbons", "n14",
    { type: "tool", category: "LLM gateway", version: "API v1", inStack: true }),

  o("o-a1", "Assets", "Savings-Account", "Home Deposit Savings", "2026-10-21", "19:40", ["#real-estate", "#finance/invest"],
    "Savings for the deposit on the first home. Grows monthly with a standing order.", "facade", "n10",
    { type: "asset", kind: "Savings", value: 48000, status: "Aktiv" }),
  o("o-a2", "Assets", "ETF-Savings-Plan", "World ETF Savings Plan", "2026-10-12", "07:55", ["#finance/invest"],
    "Monthly savings plan into a global equity ETF, rebalanced once a year.", "stones", "n17",
    { type: "asset", kind: "Securities", value: 42300, status: "Aktiv" }),
  o("o-a3", "Assets", "Atlas-Domain", "Atlas Name & Domain", "2026-10-02", "21:10", ["#side-project"],
    "Domain and social handles for the side venture.", "loft", "n24",
    { type: "asset", kind: "Intangible", value: 350, status: "In Prüfung" }),

  o("o-g1", "Goals", "Atlas-100-Users", "Atlas: 100 Paying Users", "2026-10-22", "10:15", ["#strategy/course", "#side-project"],
    "Milestone for Q4 2026: pro plan live, first paying readers, mobile app in beta.", "skyline", "n13",
    { type: "goal", period: "Q4 2026", progress: 70, metric: "70 of 100 users" }),
  o("o-g2", "Goals", "Half-Marathon", "Half Marathon under 1:50 h", "2026-10-14", "10:05", ["#fitness/running"],
    "The test run shows: hills and fuelling cost the most time.", "hyrox", "n20",
    { type: "goal", period: "Spring 2027", progress: 40, metric: "1:58 h now" }),
  o("o-g3", "Goals", "Buy-First-Home", "Buy a First Home", "2026-10-13", "11:20", ["#real-estate"],
    "Settle deposit, fixed-rate period and the shortlist by mid 2027.", "facade", "n10",
    { type: "goal", period: "2027", progress: 25, metric: "Budget is set" }),
];

/* ------------------------------------------------------------------ action items */

export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskSourceKind = "meeting" | "note" | "voice" | "article" | "ai";

export type ActionItem = {
  id: string;
  title: string;
  tag: string;
  /** ISO day. */
  due: string;
  /** HH:mm, shown instead of "heute" when set. */
  dueTime?: string;
  priority: TaskPriority;
  done: boolean;
  /** Extracted by the Gardener rather than typed by hand ("von KI erkannt"). */
  ai: boolean;
  /** An AI suggestion the user took over (action_items.status "in_progress"). */
  accepted?: boolean;
  assignee: string;
  /** knowledge_items.id the task was extracted from. */
  sourceId: string;
  sourceKind: TaskSourceKind;
  /** Seconds into the source meeting / voice note (action_items.source_timestamp_sec). */
  sourceSec?: number;
  /** knowledge_items.id of the linked project / goal (action_items.project_item_id). */
  projectId?: string;
  /** "today" | "this_week" | "later" | YYYY-MM-DD (action_items.timeframe). */
  timeframe?: string;
  /** Short why / where-from sentence (action_items.context). */
  context?: string;
  /** ISO timestamp the task was handed over to another tool ("überführt"); action_items.exported_at. */
  exportedAt?: string;
  /** Id in an external task tool, reserved for an adapter (action_items.external_ref). */
  externalRef?: string;
};

export const SOURCE_KIND_LABEL: Record<TaskSourceKind, string> = {
  get meeting() { return t("Meeting"); },
  get note() { return t("Note"); },
  get voice() { return t("Voice memo"); },
  get article() { return t("Article"); },
  get ai() { return t("AI Memory"); },
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  get urgent() { return t("Urgent"); },
  get high() { return t("High"); },
  get medium() { return t("Medium"); },
  get low() { return t("Low"); },
};

const task = (
  id: string,
  title: string,
  tag: string,
  due: string,
  dueTime: string | undefined,
  priority: TaskPriority,
  sourceId: string,
  sourceKind: TaskSourceKind,
  extra: Partial<ActionItem> = {},
): ActionItem => ({ id, title, tag, due, dueTime, priority, done: false, ai: false, assignee: "Max", sourceId, sourceKind, ...extra });

/** Prototype taskDefs t1..t8 plus tasks from the notes' own todo lists (Today is Thu, 22 Oct 2026). */
export const ACTION_ITEMS: ActionItem[] = [
  task("t1", "Update the architecture sync slides", "#it/platform", "2026-10-22", "11:00", "high", "n2", "meeting"),
  task("t2", "Send the SHA-256 checksum concept to Tom", "#ai/mcp", "2026-10-22", "14:20", "urgent", "n2", "meeting", { ai: true, sourceSec: 14 * 60 + 20 }),
  task("t3", "Add the .conflict.md failure case to the spec", "#it/platform", "2026-10-22", undefined, "high", "n2", "meeting", { ai: true, sourceSec: 31 * 60 + 5 }),
  task("t4", "Finish the mobility session", "#fitness/running", "2026-10-22", undefined, "low", "n6", "note"),
  task("t5", "Go through the viewing checklist with Sam", "#real-estate", "2026-10-23", undefined, "medium", "n10", "article"),
  task("t6", "Review the chapter 3 flashcards", "#ai/agents", "2026-10-23", undefined, "medium", "n3", "note"),
  task("t7", "Blue Ocean canvas for the strategy course", "#strategy/course", "2026-10-25", undefined, "medium", "n11", "note"),
  task("t8", "Write the low-carb shopping list", "#recipes/low-carb", "2026-10-22", undefined, "low", "n5", "note", { done: true }),
  task("t9", "Prepare the Q1 budget proposal", "#it/platform", "2026-10-21", undefined, "urgent", "n22", "meeting", { ai: true, sourceSec: 22 * 60 + 40 }),
  task("t10", "Send the retro results to the delivery team", "#leadership", "2026-10-24", undefined, "medium", "n15", "meeting", { ai: true, sourceSec: 41 * 60 + 12 }),
  task("t11", "Collect the documents for the mortgage meeting", "#real-estate", "2026-10-26", undefined, "high", "n23", "meeting", { ai: true, sourceSec: 18 * 60 + 3 }),
  task("t12", "Set the Zone 2 plan for next week", "#fitness/running", "2026-10-25", undefined, "low", "n12", "voice", { ai: true, sourceSec: 3 * 60 + 48 }),
  task("t13", "Agree on a date for the day trip", "#family", "2026-10-24", undefined, "low", "n25", "voice", { sourceSec: 52 }),
  task("t14", "Plan hill sprints twice a week", "#fitness/running", "2026-10-21", undefined, "medium", "n20", "note", { done: true }),
];


/* ------------------------------------------------------------------ inbox triage (V2-09) */

/**
 * Vault folders the Gardener can propose and the detail panel offers ("Ziel ändern").
 * `label` is the breadcrumb shown in the UI, `path` the vault folder an accepted item is moved to.
 */
export interface InboxTarget {
  path: string;
  label: string;
  icon: "heart" | "ai" | "note" | "meeting" | "article" | "video" | "book" | "recipe";
}

export const INBOX_TARGETS: InboxTarget[] = [
  { path: "10_Notes/Training", label: "Health › Training", icon: "heart" },
  { path: "10_Notes/Ideas", label: "Notes", icon: "note" },
  { path: "10_Notes/Recipes", label: "Recipes", icon: "recipe" },
  { path: "20_Meetings/Work", label: "Meetings › Work", icon: "meeting" },
  { path: "30_Web", label: "Articles", icon: "article" },
  { path: "40_AI_Memories", label: "AI Memories", icon: "ai" },
  { path: "50_Media/Reels", label: "Videos › Reels", icon: "video" },
  { path: "60_Documents", label: "Books", icon: "book" },
];

export const inboxTarget = (path: string): InboxTarget | undefined => INBOX_TARGETS.find((t) => t.path === path);

export type InboxKind = "video" | "ai" | "image";

/** An item waiting for review: what Kortex captured plus what the Gardener proposes. */
export interface InboxProposal {
  id: string;
  kind: InboxKind;
  title: string;
  /** "Reel · Instagram · 0:48". */
  source: string;
  summary: string;
  cover: CoverKey;
  /** Proposed vault folder (an INBOX_TARGETS path) and hashtags (with #). */
  target: string;
  tags: string[];
  /** Extra hint shown instead of tags in the proposal line ("Text erkannt, 2 Links"). */
  hint?: string;
  /** Titles of the notes the Gardener linked it to. */
  links: string[];
  /** knowledge_items.id once the capture exists in the database (live mode); mock items have none. */
  itemId?: string;
  /** Live mode: the item’s own cover image (wins over `cover`). */
  coverUrl?: string;
}

export const INBOX_REVIEW: InboxProposal[] = [
  {
    id: "ib1",
    kind: "video",
    title: "Hill Sprint Technique",
    source: "Reel · Instagram · 0:48",
    summary: "Lean in from the ankles, short quick steps, drive the arms. Breathe with the step rhythm, eyes two metres ahead.",
    cover: "hyrox",
    target: "10_Notes/Training",
    tags: ["#fitness/running", "#technique"],
    links: ["Runner Mobility Reel", "Running plan week 9"],
  },
  {
    id: "ib2",
    kind: "ai",
    title: "Claude Chat: Prompt Caching Strategy",
    source: "Chat · Claude · 14 messages",
    summary: "Which prompt parts stay stable, how the cache is built and when it expires. Open question: one cache per user or per vault.",
    cover: "ribbons",
    target: "40_AI_Memories",
    tags: ["#ai/claude"],
    links: ["Claude Code Session Memory", "Gardener Pipeline Idea"],
  },
  {
    id: "ib3",
    kind: "image",
    title: "Screenshot Oct 22, 09:41",
    source: "Image · Screenshot · 1170 × 2532",
    summary: "Whiteboard photo with an architecture sketch: vault, sync service and conflict queue. Text recognised, two links in the sketch.",
    cover: "meeting",
    target: "10_Notes/Ideas",
    tags: [],
    hint: "Text recognised, 2 links",
    links: ["Q4 Architecture Sync"],
  },
];

/** What the user decided for a proposal (kept in localStorage until the live inbox ships; shape matches the items the API will return). */
export interface InboxDecision {
  id: string;
  /** Chosen vault folder. */
  target: string;
  tags: string[];
  /** ISO timestamp of "Übernehmen". */
  acceptedAt: string;
}

/** Inbox page state that survives a reload (mock persistence). */
export interface InboxPersisted {
  /** Edits of the detail panel for proposals that are still open. */
  drafts: Record<string, { target?: string; tags?: string[] }>;
  accepted: Record<string, InboxDecision>;
  /** "Heute einsortiert" collapsed. */
  hideDone: boolean;
}

export const EMPTY_INBOX: InboxPersisted = { drafts: {}, accepted: {}, hideDone: false };

/** "Heute einsortiert" of the mock day (prototype: n6, n7, n14); accepted proposals are added on top. */
export const INBOX_PROCESSED_IDS = ["n6", "n7", "n14"];
