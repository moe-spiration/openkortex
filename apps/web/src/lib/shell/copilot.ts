import { t, tx } from "@/i18n";
import { NOTES, noteById } from "@/lib/workspace-data";

/*
 * Mock Hybrid-RAG copilot and capture routing (WebApp.dc.html: answerFor, chipAction, ROUTES).
 * Etappe 2+ replaces these with @kortex/ai-core calls; the message shape stays.
 * The fixed demo conversation and demo answers are mock content about the English mock notes (also the
 * browser demo of the open-source edition); the sentence frames around real titles and the labels are translated.
 */

export type MsgPart = { text: string } | { cite: number; id: string };
export type CopilotMsg =
  | { role: "me"; text: string }
  | { role: "ai"; parts: MsgPart[]; sources: { n: number; id: string }[] };

export const INITIAL_MSGS: CopilotMsg[] = [
  { role: "me", text: "What did I note about conflicts in the vault sync?" },
  {
    role: "ai",
    parts: [
      { text: "Every file carries a SHA-256 checksum. If the checksums differ, a .conflict.md appears next to the original " },
      { cite: 1, id: "n2" },
      { text: ". Tuesday's MCP session adds read access to the checksums " },
      { cite: 2, id: "n4" },
      { text: ". Still open is what happens when two devices rename at once " },
      { cite: 1, id: "n2" },
      { text: "." },
    ],
    sources: [
      { n: 1, id: "n2" },
      { n: 2, id: "n4" },
      { n: 3, id: "n13" },
    ],
  },
];

/** Keyword retrieval over the mock notes; returns the question and the answer. */
export function answerFor(q: string): CopilotMsg[] {
  const words = q
    .toLowerCase()
    .split(/[^a-zäöüß0-9/-]+/)
    .filter((w) => w.length > 2);
  const scored = NOTES.map((n) => {
    const hay = (n.title + " " + n.tldr + " " + n.tags.join(" ")).toLowerCase();
    return { n, sc: words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0) };
  }).sort((a, b) => b.sc - a.sc);
  const top = (scored[0] && scored[0].sc > 0 ? scored.slice(0, 3).map((x) => x.n) : ["n2", "n4", "n13"].map((id) => noteById(id)!))
    .filter(Boolean);
  const [a, b, c] = top;
  return [
    { role: "me", text: q },
    {
      role: "ai",
      parts: [
        { text: t("Closest to your question is “{title}”", { title: a!.title }) + " " },
        { cite: 1, id: a!.id },
        { text: ": " + a!.tldr + " " + t("In addition") + " " },
        { cite: 2, id: b!.id },
        { text: " " + t("and") + " " },
        { cite: 3, id: c!.id },
        { text: "." },
      ],
      sources: top.map((n, i) => ({ n: i + 1, id: n.id })),
    },
  ];
}

export type ChipId = "tldr" | "tasks" | "cards";

export const CHIPS: { id: ChipId; label: string; icon: "zap" | "todo" | "cards" }[] = [
  { id: "tldr", get label() { return t("TL;DR"); }, icon: "zap" },
  { id: "tasks", get label() { return t("Extract tasks"); }, icon: "todo" },
  { id: "cards", get label() { return tx("chip", "Flashcards"); }, icon: "cards" },
];

/** Quick-chip answers. `ctx` is the current view or note title, `noteId` the open note if any. */
export function chipAnswer(chip: ChipId, ctx: string, noteId: string | null): { msgs: CopilotMsg[]; toast?: string } {
  const note = noteId ? noteById(noteId) : undefined;
  if (chip === "tldr") {
    const tl = note
      ? note.tldr
      : "Today brings the Q4 architecture sync at 11:00, three priorities and your check-in. Two clips are processed, two are still running.";
    const src = note ? [note.id, ...note.links.slice(0, 2)] : ["n2", "n1", "n13"];
    return {
      msgs: [
        { role: "me", text: t("TL;DR for: {context}", { context: ctx }) },
        { role: "ai", parts: [{ text: tl + " " }, { cite: 1, id: src[0]! }], sources: src.map((id, i) => ({ n: i + 1, id })) },
      ],
    };
  }
  if (chip === "tasks") {
    return {
      msgs: [
        { role: "me", text: t("Extract tasks: {context}", { context: ctx }) },
        {
          role: "ai",
          parts: [
            { text: "I found two tasks and added them to Tasks: send the retro results " },
            { cite: 1, id: "n15" },
            { text: " and set the Zone 2 plan " },
            { cite: 2, id: "n12" },
            { text: "." },
          ],
          sources: [
            { n: 1, id: "n15" },
            { n: 2, id: "n12" },
          ],
        },
      ],
      toast: t("2 tasks created in Tasks"),
    };
  }
  return {
    msgs: [
      { role: "me", text: t("Flashcards: {context}", { context: ctx }) },
      {
        role: "ai",
        parts: [
          { text: "Card 1: Why do chunks without context lose meaning? Card 2: Which indexes gain from the added context? Answer: embeddings and BM25 " },
          { cite: 1, id: "n3" },
          { text: "." },
        ],
        sources: [{ n: 1, id: "n3" }],
      },
    ],
    toast: t("2 flashcards created"),
  };
}

// Demo routing: English and German keywords, the space names are interface texts.
const ROUTES: [RegExp, () => string, string][] = [
  [/meeting|call|sync|minutes|protokoll/i, () => t("Meetings"), "#it/platform"],
  [/recipe|cook|shopping|salmon|rezept|kochen|einkauf|lachs/i, () => t("Recipes"), "#recipes/low-carb"],
  [/run|training|mobility|fitness|lauf/i, () => t("Health"), "#fitness/running"],
  [/mcp|claude|agent|ki|ai|rag/i, () => t("Notes"), "#ai/mcp"],
  [/apartment|mortgage|rent|finance|immobilie|miete|finanz/i, () => t("Finances"), "#real-estate"],
  [/strategy|course|customer|market|strategie|kunde|markt/i, () => t("Notes"), "#strategy/course"],
];

/** Auto-routing preview for a captured thought: target space and tag. */
export function routeFor(text: string): { space: string; tag: string } {
  for (const [re, space, tag] of ROUTES) if (re.test(text)) return { space: space(), tag };
  return { space: t("Notes"), tag: "#inbox" };
}

export const fmtSec = (n: number) => Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
