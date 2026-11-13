import type { Hashtag, ItemType, NoteSummary, NoteTypeMeta } from "./types";
import { t } from "@/i18n";

/* Mock knowledge items, taken 1:1 from design/reference/WebApp.dc.html (notes()). The type labels are interface texts (getters, translated); the items themselves are fictional English demo content (also the browser demo of the open-source edition). */

export const NOTE_TYPES: Record<ItemType, NoteTypeMeta> = {
  note: { get label() { return t("Note"); }, icon: "i-note", tone: "ai" },
  meeting: { get label() { return t("Meeting"); }, icon: "i-meeting", tone: "auto" },
  article: { get label() { return t("Article"); }, icon: "i-article", tone: "auto" },
  book: { get label() { return t("Book"); }, icon: "i-book", tone: "strategy" },
  video: { get label() { return t("Reel"); }, icon: "i-video", tone: "health" },
  podcast: { get label() { return t("Podcast"); }, icon: "i-video", tone: "health" },
  ai: { get label() { return t("AI Memory"); }, icon: "i-ai", tone: "ai" },
  recipe: { get label() { return t("Recipe"); }, icon: "i-recipe", tone: "food" },
  // Domain objects: tones follow ObjectBadge in @kortex/ui
  person: { get label() { return t("Person"); }, icon: "o-person", tone: "auto" },
  project: { get label() { return t("Project"); }, icon: "o-project", tone: "ai" },
  organization: { get label() { return t("Organization"); }, icon: "o-organization", tone: "auto" },
  concept: { get label() { return t("Concept"); }, icon: "o-concept", tone: "strategy" },
  tool: { get label() { return t("Tool"); }, icon: "o-tool", tone: "checkin" },
  asset: { get label() { return t("Asset"); }, icon: "o-asset", tone: "food" },
  goal: { get label() { return t("Goal"); }, icon: "o-goal", tone: "health" },
};

/** Hashtag colour domains as the prototype assigns them (TGC). */
export const HASHTAGS: Hashtag[] = [
  { label: "#ai/mcp", tone: "ai" },
  { label: "#ai/agents", tone: "ai" },
  { label: "#side-project", tone: "ai" },
  { label: "#it/platform", tone: "auto" },
  { label: "#cloud", tone: "auto" },
  { label: "#fitness/running", tone: "health" },
  { label: "#mobility", tone: "health" },
  { label: "#recipes/low-carb", tone: "food" },
  { label: "#high-protein", tone: "food" },
  { label: "#real-estate", tone: "finance" },
  { label: "#finance/invest", tone: "finance" },
  { label: "#strategy/course", tone: "strategy" },
  { label: "#leadership", tone: "strategy" },
  { label: "#family", tone: "food" },
];

const n = (
  id: string,
  type: ItemType,
  title: string,
  path: string,
  date: string,
  time: string,
  tags: string[],
  tldr: string,
  links: string[],
): NoteSummary => ({ id, type, title, path, date, time, tags, tldr, links });

export const NOTES: NoteSummary[] = [
  n("n1", "note", "Daily Journal 2026-10-22", "10_Notes/Daily/2026-10-22.md", "2026-10-22", "08:12", ["#side-project", "#mobility"],
    "Energy 9/10, two habits done. Focus today: prepare the architecture sync, meal prep and read chapter 3.", ["n2", "n3", "n13"]),
  n("n2", "meeting", "Q4 Architecture Sync", "20_Meetings/Work/2026-10-22_Q4-Architecture-Sync.md", "2026-10-22", "09:05", ["#it/platform", "#ai/mcp"],
    "Sync protocol for the vault backend: a SHA-256 checksum per file, conflicts as .conflict.md. Two open action items from the last call.", ["n4", "n13", "n15"]),
  n("n3", "book", "AI Engineering: Contextual Retrieval", "60_Documents/AI_Engineering_Book.md", "2026-10-21", "21:30", ["#ai/agents", "#ai/mcp"],
    "Chunks lose their meaning without context. A short context in front of every chunk improves embeddings and BM25 at the same time.", ["n4", "n14", "n13"]),
  n("n4", "ai", "Claude Code Session Memory", "40_AI_Memories/2026-10-21_Claude-Code-Session.md", "2026-10-21", "18:55", ["#ai/mcp", "#side-project"],
    "Session on connecting the vault over MCP: tool schema, permission model and a first test with read-only access.", ["n2", "n14", "n13"]),
  n("n5", "recipe", "Low-Carb Salmon Spinach Roll", "10_Notes/Recipes/Salmon-Spinach-Roll.md", "2026-10-21", "12:10", ["#recipes/low-carb", "#high-protein"],
    "Savoury roll of spinach and egg batter with salmon and cream cheese. About 30 minutes, easy to prepare ahead.", ["n16", "n1"]),
  n("n6", "video", "Runner Mobility Reel", "50_Media/Reels/Runner-Mobility.md", "2026-10-22", "07:40", ["#fitness/running", "#mobility"],
    "Four mobility drills for hips and upper back before long runs.", ["n7", "n12", "n1"]),
  n("n7", "video", "Hill Sprint Technique", "50_Media/Reels/Hill-Sprints.md", "2026-10-21", "20:15", ["#fitness/running"],
    "Lean into the hill, short quick steps, drive the arms. Match the breathing to the step rhythm.", ["n6", "n12"]),
  n("n8", "article", "MCP Servers for Support Knowledge", "30_Web/MCP-Support-Knowledge.md", "2026-10-22", "09:30", ["#ai/mcp", "#it/platform"],
    "How an MCP server wraps tickets, manuals and logs as sources for agents without loosening permissions.", ["n2", "n4", "n9"]),
  n("n9", "article", "Platform Strategy: Build, Partner or Buy", "30_Web/Platform-Strategy.md", "2026-10-20", "16:00", ["#it/platform", "#cloud"],
    "Three ways to set up a software platform: build it yourself, share it in an alliance or buy it in.", ["n8", "n15"]),
  n("n10", "article", "Apartment Viewing Checklist", "30_Web/Apartment-Checklist.md", "2026-10-13", "11:20", ["#real-estate", "#finance/invest"],
    "What to check before buying: service charges, repair backlog, energy rating and the financing frame.", ["n17", "n18"]),
  n("n11", "note", "Blue Ocean Notes (Strategy Course)", "10_Notes/Ideas/Blue-Ocean-Course.md", "2026-10-22", "08:50", ["#strategy/course", "#leadership"],
    "Four-actions grid for a value curve comparison in the strategy course, with an example from a logistics platform.", ["n18", "n15"]),
  n("n12", "podcast", "Podcast: Zone 2 Training", "50_Media/Podcasts/Zone-2.md", "2026-10-20", "19:30", ["#fitness/running"],
    "Why easy base training carries a half marathon and how much of it makes sense per week.", ["n6", "n7"]),
  n("n13", "note", "Gardener Pipeline Idea", "10_Notes/Ideas/Gardener-Pipeline.md", "2026-10-22", "08:30", ["#side-project", "#ai/agents"],
    "The AI gardener sorts incoming clips: transcribe, tag, link, add context.", ["n3", "n4", "n2"]),
  n("n14", "ai", "Claude Chat: Prompt Caching Strategy", "40_AI_Memories/2026-10-20_Prompt-Caching.md", "2026-10-20", "15:45", ["#ai/agents"],
    "Chat export on which prompt parts stay stable and how to build the cache.", ["n3", "n4"]),
  n("n15", "meeting", "Delivery Team Retro", "20_Meetings/Work/2026-10-20_Delivery-Retro.md", "2026-10-20", "17:00", ["#leadership", "#it/platform"],
    "Retro of the last iteration: clear dependencies earlier, keep demos short, write decisions down.", ["n2", "n11"]),
  n("n16", "recipe", "Low-Carb Almond Bread", "10_Notes/Recipes/Almond-Bread.md", "2026-10-18", "09:00", ["#recipes/low-carb"],
    "Moist bread from almond flour, yoghurt and eggs. Ten minutes of preparation.", ["n5"]),
  n("n17", "note", "Calculating Rental Yield", "10_Notes/Ideas/Rental-Yield.md", "2026-10-12", "07:55", ["#real-estate"],
    "Formula and worked example for gross and net yield, including buying costs and reserves.", ["n10"]),
  n("n18", "book", "Leading Through Change", "60_Documents/Leading-Through-Change.pdf", "2026-10-16", "14:10", ["#leadership", "#strategy/course"],
    "Whitepaper on leading large change programmes: clarity, rhythm and visible decisions.", ["n11", "n15"]),
  n("n19", "note", "Daily Journal 2026-10-21", "10_Notes/Daily/2026-10-21.md", "2026-10-21", "21:50", ["#mobility"],
    "Energy 7/10. MCP session done, watched the hill sprint reel, early night.", ["n4", "n7", "n1"]),
  n("n20", "note", "Half Marathon Test Run: Lessons", "10_Notes/Training/Test-Run.md", "2026-10-14", "10:05", ["#fitness/running"],
    "Test run over 15 km: the pace holds, the hills cost the most time and the fuelling came too late.", ["n7", "n12"]),
  n("n21", "note", "Weekly Review Week 41", "10_Notes/Reviews/2026-W41.md", "2026-10-11", "18:30", ["#leadership"],
    "Good week for focused work, too many context switches on Wednesday. Next week: block two deep work slots.", ["n1", "n19"]),
  n("n22", "meeting", "Platform Steering Committee", "20_Meetings/Work/2026-10-08_Steering.md", "2026-10-08", "14:00", ["#it/platform", "#cloud"],
    "Steering on the platform roadmap: decision for a shared integration layer, the Q1 budget is still open.", ["n9", "n15"]),
  n("n23", "meeting", "Mortgage Meeting", "20_Meetings/Personal/2026-10-06_Mortgage.md", "2026-10-06", "16:30", ["#real-estate", "#finance/invest"],
    "First meeting on financing a flat: deposit size and fixed-rate period are the levers.", ["n10", "n17"]),
  n("n24", "ai", "Vision Model Test for Reels", "40_AI_Memories/2026-10-02_Vision-Test.md", "2026-10-02", "21:10", ["#ai/agents", "#side-project"],
    "Test whether a vision model reliably recognises exercises in fitness reels. Result: good with a steady camera, weak with fast cuts.", ["n13", "n6"]),
  n("n25", "note", "Plan a Day Trip to the Lake", "10_Notes/Ideas/Lake-Day-Trip.md", "2026-10-18", "11:00", ["#family"],
    "Ideas for a day out at the lake: a walk, lunch, back early.", ["n1"]),
];

/** "Recently opened" in the command palette. */
export const RECENT_NOTE_IDS = ["n2", "n3", "n4", "n1"];
