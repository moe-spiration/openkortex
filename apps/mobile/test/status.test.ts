import { describe, expect, it } from "vitest";
import { statusCommand, statusSummary } from "../src/data/status";

describe("copilot status action", () => {
  it("recognises /status and Status: commands", () => {
    expect(statusCommand("/status Dune gelesen, 9 von 10")).toBe("Dune gelesen, 9 von 10");
    expect(statusCommand("Status: Oppenheimer gesehen")).toBe("Oppenheimer gesehen");
    expect(statusCommand("/status")).toBeNull();
    expect(statusCommand("Wie ist der Status von X?")).toBeNull();
  });

  it("summarises the change in German, preview vs saved", () => {
    const r = { item_id: "1", title: "Dune", type: "book", metadata: { status: "read", rating: 9, feedback: "stark" }, saved: false };
    expect(statusSummary(r)).toBe("Dune (Buch): Status Gelesen · Bewertung 9/10 · Feedback „stark“. Übernehmen?");
    expect(statusSummary({ ...r, saved: true })).toMatch(/^Gespeichert: Dune \(Buch\)/);
  });
});
