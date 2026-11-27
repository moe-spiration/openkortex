import { describe, expect, it } from "vitest";
import { parseChatStream } from "../src/api/chatStream";
import { cleanSpoken, skillOf, stepLine, undoOf } from "../src/lib/agent";

const sse = (...parts: unknown[]) => parts.map((p) => `data: ${JSON.stringify(p)}`).join("\n") + "\n";

describe("agent stream parts", () => {
  it("collects steps, the latest proposal and done results", () => {
    const a = parseChatStream(
      sse(
        { type: "data-step", data: { kind: "search", label: "Gesucht: Hyrox", count: 4 } },
        { type: "data-step", data: { kind: "read", label: "Gelesen: Plan" } },
        { type: "data-proposal", id: "proposal", data: { actions: [{ kind: "note_create", title: "A", markdown: "" }], labels: ["Notiz „A“ anlegen"] } },
        { type: "data-proposal", id: "proposal", data: { actions: [{ kind: "note_create", title: "A", markdown: "" }, { kind: "task_create", title: "B" }], labels: ["x", "y"] } },
        { type: "data-done", id: "done", data: { results: [{ ok: true, label: "Aufgabe angelegt", undo: { kind: "task_create", task_id: "t" } }] } },
        { type: "text-delta", delta: "Fertig." },
      ),
    );
    expect(a.steps.map(stepLine)).toEqual(["Gesucht: Hyrox · 4", "Gelesen: Plan"]);
    expect(a.proposal?.actions).toHaveLength(2);
    expect(a.proposal?.labels).toEqual(["x", "y"]);
    expect(undoOf(a.done)).toEqual([{ kind: "task_create", task_id: "t" }]);
    expect(a.text).toBe("Fertig.");
  });

  it("has no proposal for plain answers", () => {
    const a = parseChatStream(sse({ type: "text-delta", delta: "Hi" }));
    expect(a.proposal).toBeNull();
    expect(a.steps).toEqual([]);
    expect(a.done).toEqual([]);
  });
});

describe("skillOf", () => {
  it("maps English and German slash words", () => {
    expect(skillOf("/akte Jonas Weber")).toBe("dossier");
    expect(skillOf("/Recherche MCP")).toBe("research");
    expect(skillOf("/aufräumen")).toBe("tidy");
    expect(skillOf("/week")).toBe("week");
  });
  it("ignores other text and unknown commands", () => {
    expect(skillOf("Was ist neu?")).toBeUndefined();
    expect(skillOf("/status Dune 9/10")).toBeUndefined();
  });
});

describe("undoOf", () => {
  it("keeps only successful results that can be undone", () => {
    expect(undoOf([{ ok: false, label: "x", undo: { kind: "note_create", item_id: "1" } }, { ok: true, label: "y" }])).toEqual([]);
  });
});

describe("agent text blocks", () => {
  it("puts text the agent writes between tool calls on its own paragraph", () => {
    const a = parseChatStream(
      sse(
        { type: "text-start", id: "a" },
        { type: "text-delta", id: "a", delta: "Ich suche erst." },
        { type: "text-end", id: "a" },
        { type: "data-step", data: { kind: "search", label: "Hyrox" } },
        { type: "text-start", id: "b" },
        { type: "text-delta", id: "b", delta: "Gefunden [1]." },
        { type: "text-end", id: "b" },
      ),
    );
    expect(a.text).toBe("Ich suche erst.\n\nGefunden [1].");
  });
});

describe("spoken questions", () => {
  it("drops leading fillers and keeps the question as spoken", () => {
    expect(cleanSpoken("  Hey Kortex,  was habe ich\n diese Woche gespeichert? ")).toBe("Was habe ich diese Woche gespeichert?");
    expect(cleanSpoken("Ähm, okay, welche Aufgaben sind offen?")).toBe("Welche Aufgaben sind offen?");
    expect(cleanSpoken("Kortex Release vorbereiten")).toBe("Kortex Release vorbereiten");
  });
  it("turns a spoken slash into the command", () => {
    expect(cleanSpoken("Slash Briefing, Jonas Weber")).toBe("/briefing Jonas Weber");
    expect(cleanSpoken("Schrägstrich Akte Jonas Weber.")).toBe("/akte Jonas Weber.");
    expect(skillOf(cleanSpoken("Schrägstrich Akte Jonas Weber."))).toBe("dossier");
  });
  it("finds a skill named at the start without a slash", () => {
    expect(skillOf("Briefing für Jonas Weber")).toBe("briefing");
    expect(skillOf("Recherche zu Hyrox")).toBe("research");
    expect(skillOf("Wochenrückblick.")).toBe("week");
    expect(skillOf("Briefings sind toll")).toBeUndefined();
    expect(skillOf("Was steht in der Akte?")).toBeUndefined();
  });
});
