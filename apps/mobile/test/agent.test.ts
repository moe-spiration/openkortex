import { describe, expect, it } from "vitest";
import { parseChatStream } from "../src/api/chatStream";
import { skillOf, stepLine, undoOf } from "../src/lib/agent";

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
