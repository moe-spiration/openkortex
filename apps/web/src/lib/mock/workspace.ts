import type {
  AutoSpace,
  InboxJob,
  LifeArea,
  LiveMeeting,
  ObjectHub,
  Profile,
  VaultFolder,
} from "./types";
import { CURATED_SPACES } from "@/lib/spaces";
import { PRODUCT_NAME, t, tx } from "@/i18n";

/* Sidebar and workspace mock data, taken from design/reference/WebApp.dc.html (renderVals()). */

export const PROFILE: Profile = { name: "Max", initial: "M", plan: `${PRODUCT_NAME} Pro` };

export const LIFE_AREAS: LifeArea[] = [
  { key: "overview", get label() { return tx("life", "Overview"); }, icon: "life", tone: "ai", score: null },
  { key: "health", get label() { return t("Health"); }, icon: "l-health", tone: "health", score: 82 },
  { key: "career", get label() { return t("Career"); }, icon: "l-career", tone: "strategy", score: 70 },
  { key: "finance", get label() { return t("Finances"); }, icon: "l-finance", tone: "finance", score: 61 },
  { key: "ventures", get label() { return t("Ventures"); }, icon: "l-ventures", tone: "ai", score: 76 },
  { key: "relations", get label() { return t("Relationships"); }, icon: "l-relations", tone: "food", score: 68 },
  { key: "growth", get label() { return t("Growth"); }, icon: "l-growth", tone: "strategy", score: 79 },
];

/** Prototype counts of the curated spaces (definitions: lib/spaces.ts, derived from the type registry). */
const MOCK_SPACE_COUNTS: Record<string, number> = { all: 148, notes: 42, meetings: 32, articles: 54, books: 11, videos: 19, ai: 29, recipes: 14 };

/** The label stays a getter (a spread would freeze it in the language of import time). */
export const AUTO_SPACES: AutoSpace[] = CURATED_SPACES.map((s) =>
  Object.defineProperty({ ...s, count: MOCK_SPACE_COUNTS[s.key] ?? 0 }, "label", { get: () => s.label, enumerable: true }),
);

/**
 * The 7 domain objects (CLAUDE.md, 70_Objects/). Not part of the prototype sidebar; rendered as an
 * extra group in the Spaces style. Counts are placeholders until @kortex/db delivers them.
 */
export const OBJECT_HUBS: ObjectHub[] = [
  { type: "person", get label() { return t("People"); }, folder: "People", count: 24 },
  { type: "project", get label() { return t("Projects"); }, folder: "Projects", count: 9 },
  { type: "organization", get label() { return t("Organizations"); }, folder: "Organizations", count: 12 },
  { type: "concept", get label() { return t("Concepts"); }, folder: "Concepts", count: 31 },
  { type: "tool", get label() { return t("Tools"); }, folder: "Tools", count: 18 },
  { type: "asset", get label() { return t("Assets"); }, folder: "Assets", count: 4 },
  { type: "goal", get label() { return t("Goals"); }, folder: "Goals", count: 7 },
];

export const VAULT_ROOT = "~/KortexVault";

export const VAULT_TREE: VaultFolder[] = [
  { id: "10", name: "10_Notes", path: "10_Notes", depth: 0, hasChildren: true },
  { id: "10d", name: "Daily", path: "10_Notes/Daily", depth: 1, parent: "10" },
  { id: "10i", name: "Ideas", path: "10_Notes/Ideas", depth: 1, parent: "10" },
  { id: "10r", name: "Recipes", path: "10_Notes/Recipes", depth: 1, parent: "10" },
  { id: "20", name: "20_Meetings", path: "20_Meetings", depth: 0, hasChildren: true },
  { id: "20a", name: "Work", path: "20_Meetings/Work", depth: 1, parent: "20" },
  { id: "30", name: "30_Web", path: "30_Web", depth: 0 },
  { id: "40", name: "40_AI_Memories", path: "40_AI_Memories", depth: 0 },
  { id: "50", name: "50_Media", path: "50_Media", depth: 0, hasChildren: true },
  { id: "50r", name: "Reels", path: "50_Media/Reels", depth: 1, parent: "50" },
  { id: "50p", name: "Podcasts", path: "50_Media/Podcasts", depth: 1, parent: "50" },
  { id: "60", name: "60_Documents", path: "60_Documents", depth: 0 },
  // Domain objects (CLAUDE.md), not in the prototype tree.
  { id: "70", name: "70_Objects", path: "70_Objects", depth: 0, hasChildren: true },
  ...OBJECT_HUBS.map((h) => ({ id: `70-${h.type}`, name: h.folder, path: `70_Objects/${h.folder}`, depth: 1, parent: "70" })),
];

/** Tree nodes expanded by default (prototype: open = { 10: true, 20: true, 50: false }). */
export const VAULT_OPEN_DEFAULT: Record<string, boolean> = { "10": true, "20": true, "50": false, "70": false };

/** Hashtags pinned in the sidebar (sideTagDefs). */
export const SIDEBAR_TAGS = ["#ai/mcp", "#it/platform", "#fitness/running", "#recipes/low-carb", "#real-estate", "#strategy/course"];

/** Captures still being processed by the Gardener (the inbox badge count). */
export const INBOX_ACTIVE: InboxJob[] = [
  { title: "Instagram Reel: Hill Sprint Technique", icon: "i-video", step: "Transcription and vision", pct: 68 },
  { title: "Claude Chat Export: Prompt Caching", icon: "i-ai", step: "Tagging", pct: 34 },
];

export const GARDENER_STATUS = { label: "AI Gardener · Vault in sync", detail: "2 clips processed, tags and links added" };

export const LIVE_MEETING: LiveMeeting = {
  title: "Q4 Architecture Sync",
  clock: "18:42",
  people: [
    { name: "Max", initial: "M" },
    { name: "Priya", initial: "P", tone: "strategy" },
    { name: "Tom", initial: "T", tone: "auto" },
  ],
  coaching: "Tom asks about conflict cases. Mention the SHA-256 checksum and the .conflict.md from doc 02.",
  noteId: "n2",
};

/** Today in the mock world (the prototype is frozen on Thursday, 22 Oct 2026). */
export const MOCK_TODAY = "2026-10-22";
