/* Mock Hybrid-RAG answers of the Ask tab and the auto-routing of quick notes (Mobile.dc.html). */

export interface AskAnswer {
  text: string;
  /** Entry ids cited as sources. */
  ids: string[];
}

export function answerFor(question: string): AskAnswer {
  const x = question.toLowerCase();
  if (/kapitel|chapter|rag|engineering/.test(x)) {
    return {
      text: "Chapter 3 shows that chunks lose their meaning without context. The fix: put a short context in front of every chunk before embedding, and combine BM25 with a reranker.",
      ids: ["e3", "e4"],
    };
  }
  if (x.includes("flashcard") || x.includes("mcp")) {
    return {
      text: "Created 3 flashcards: What does an MCP tool schema describe? Why read-only access by default? Who resolves sync conflicts? They are in 40_AI_Memories/Flashcards.",
      ids: ["e4"],
    };
  }
  if (/woche|week|gelernt|learn/.test(x)) {
    return {
      text: "This week: contextual retrieval, zone 2 training and the Blue Ocean value curve for Atlas. Your strongest topic was AI engineering with 6 new entries.",
      ids: ["e3", "e7", "e8"],
    };
  }
  if (/tom|konflikt|conflict/.test(x)) {
    return {
      text: "Tom wanted to know how vault sync conflicts are resolved. You agreed on SHA-256 checksums and .conflict.md; the diff view is still open.",
      ids: ["e2"],
    };
  }
  return {
    text: "I found three matching entries in your vault. The key point: plan the week around the architecture sync and your long run.",
    ids: ["e2", "e6", "e1"],
  };
}

export const INITIAL_ASK = {
  question: "What's on today?",
  answer: {
    text: "At 11:00 there is the Q4 architecture sync with Priya and Tom. The checksum concept for Tom is still open. The salmon and spinach roll fits tonight; you already have one of the four ingredients. Your running plan has hill sprints today.",
    ids: ["e2", "e5", "e6"],
  } satisfies AskAnswer,
};

/** Where auto-routing would file a quick note. */
export function routeOf(text: string): string {
  const x = text.toLowerCase();
  if (/meeting|call|sync/.test(x)) return "Meetings";
  if (/rezept|kochen|einkauf|recipe|cook|grocer|shopping/.test(x)) return "Recipes";
  if (/training|lauf|run|mobility/.test(x)) return "Health";
  if (/mcp|claude|ki|ai|agent/.test(x)) return "Notes, #ai/mcp";
  return "Notes";
}

/** "0:07" clock of the recorder. */
export const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
