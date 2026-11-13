import { describe, expect, it } from "vitest";
import { AI_ACTIONS, aiActionRequest, aiActionsFor, isTextAction, mockAiResult } from "./ai-actions";

describe("status action", () => {
  it("is offered only for registry types with a status enum and always saves", () => {
    expect(aiActionsFor("movie").map((a) => a.id)).toContain("status");
    expect(aiActionsFor("book").map((a) => a.id)).toContain("status");
    expect(aiActionsFor("note").map((a) => a.id)).not.toContain("status");
    expect(aiActionsFor(undefined)).toBe(AI_ACTIONS);
    expect(isTextAction("status")).toBe(false);
    expect(aiActionRequest("status", { itemId: "n1" })).toEqual({ action: "status", item_id: "n1", save: true });
  });
});

describe("AI_ACTIONS", () => {
  it("lists the five actions of the header menu and the selection toolbar, in order", () => {
    expect(AI_ACTIONS.map((a) => a.label)).toEqual(["Umformulieren", "Kürzen", "Fortsetzen", "Zusammenfassen", "Frage dazu stellen"]);
  });

  it("marks only the text actions as text actions", () => {
    expect(AI_ACTIONS.filter((a) => isTextAction(a.id)).map((a) => a.id)).toEqual(["rewrite", "shorten", "continue"]);
  });
});

describe("aiActionRequest", () => {
  it("rewrite on the whole note", () => {
    expect(aiActionRequest("rewrite", { itemId: "n1" })).toEqual({ action: "rewrite", item_id: "n1" });
  });

  it("shorten and continue use the server's own actions", () => {
    expect(aiActionRequest("shorten", { contentMd: "Text" })).toEqual({ action: "shorten", content_md: "Text" });
    expect(aiActionRequest("continue", { itemId: "n1" })).toEqual({ action: "continue", item_id: "n1" });
  });

  it("summarize maps to the summarize action, ask has no request", () => {
    expect(aiActionRequest("summarize", { itemId: "n1", contentMd: "x" })).toEqual({ action: "summarize", item_id: "n1", content_md: "x" });
    expect(aiActionRequest("ask", { itemId: "n1" })).toBeNull();
  });
});

describe("mockAiResult", () => {
  const md = "# Titel\n\nErster Absatz. Mit zwei Sätzen.\n\nZweiter Absatz.\n\nDritter Absatz.\n\nVierter Absatz.";

  it("shorten keeps the first half of the paragraphs, without headings", () => {
    expect(mockAiResult("shorten", md)).toBe("Erster Absatz. Mit zwei Sätzen.\n\nZweiter Absatz.");
  });

  it("shorten on one paragraph keeps the first half of its sentences", () => {
    expect(mockAiResult("shorten", "Eins. Zwei. Drei. Vier.")).toBe("Eins. Zwei.");
    expect(mockAiResult("shorten", "Nur ein Satz.")).toBe("Nur ein Satz.");
  });

  it("continue answers with the new paragraph only, like the server", () => {
    const r = mockAiResult("continue", md);
    expect(r).not.toContain("Erster Absatz");
    expect(r.length).toBeGreaterThan(0);
  });

  it("summarize prefers the stored summary, else the first sentences", () => {
    expect(mockAiResult("summarize", md, "Gespeichert.")).toBe("Gespeichert.");
    expect(mockAiResult("summarize", md)).toBe("Erster Absatz. Mit zwei Sätzen.");
    expect(mockAiResult("summarize", "")).toMatch(/zu wenig Inhalt/);
  });
});

describe("mock sentences", () => {
  it("does not split inside file names", () => {
    expect(mockAiResult("shorten", "Es entsteht eine .conflict.md daneben. Zweiter Satz. Dritter. Vierter.")).toBe("Es entsteht eine .conflict.md daneben. Zweiter Satz.");
  });
});
