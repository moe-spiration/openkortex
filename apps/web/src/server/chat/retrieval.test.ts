import { describe, expect, it } from "vitest";
import { LINKED_CHARS_EACH, LINKED_CHARS_TOTAL, pickLinkedSources } from "./retrieval";
import { LINKED_MAX_ITEMS } from "../../lib/shell/linked-context";

const row = (i: number, content: string, title = `Item ${i}`) => ({
  id: `id${i}`,
  title,
  type: "note",
  summary: null,
  content_md: content,
  folder_path: null,
  source_url: null,
});

describe("pickLinkedSources (ghost context)", () => {
  it("ranks by relevance to the question, ties by document order, capped", () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(i, i === 7 ? "Budget Planung Q4" : "nichts"));
    const order = rows.map((r) => r.title);
    const out = pickLinkedSources(rows, order, "Wie sieht die Budget Planung aus?");
    expect(out).toHaveLength(LINKED_MAX_ITEMS);
    expect(out[0]!.item_id).toBe("id7");
    expect(out[1]!.item_id).toBe("id0");
  });

  it("marks the passage as linked and keeps within the character budget", () => {
    const big = "x".repeat(10_000);
    const out = pickLinkedSources([row(1, big), row(2, big), row(3, big), row(4, big), row(5, big)], [], "x");
    expect(out.every((s) => s.text.startsWith("[Verlinkt aus der offenen Notiz]"))).toBe(true);
    expect(out.every((s) => s.text.length <= LINKED_CHARS_EACH)).toBe(true);
    expect(out.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(LINKED_CHARS_TOTAL);
  });

  it("returns nothing without candidates", () => {
    expect(pickLinkedSources([], [], "frage")).toEqual([]);
  });
});
