import { describe, expect, it } from "vitest";
import { appendPrompt, dailyNotes } from "../src/lib/journal";

describe("journal", () => {
  it("appends a prompt on its own line", () => {
    expect(appendPrompt("", "Wofür bin ich dankbar?")).toBe("Wofür bin ich dankbar? ");
    expect(appendPrompt("Gut geschlafen", "Was war schwer?")).toBe("Gut geschlafen\nWas war schwer? ");
    expect(appendPrompt("x\n", "P")).toBe("x\nP ");
  });
  it("finds daily notes by folder and date, newest first", () => {
    const list = dailyNotes([
      { id: "a", title: "Daily Journal 2026-11-10", folder: "10_Notes/Daily", day: 2 },
      { id: "b", title: "Daily Journal 2026-11-12", folder: "10_Notes/Daily", day: 0 },
      { id: "c", title: "Meeting 2026-11-12", folder: "20_Meetings", day: 0 },
      { id: "d", title: "Ohne Datum", folder: "10_Notes/Daily", day: 1 },
    ]);
    expect(list.map((e) => [e.id, e.date])).toEqual([["b", "2026-11-12"], ["a", "2026-11-10"]]);
  });
});

describe("heat map", () => {
  it("has twelve weeks ending with this week, future days empty", async () => {
    const { heatCells, writingLevel } = await import("../src/lib/journal");
    const cells = heatCells("2026-11-12", (d) => (d === "2026-11-10" ? 2 : 0));
    expect(cells).toHaveLength(84);
    expect(cells[0]!.date).toBe("2026-08-24");
    expect(cells.at(-1)).toMatchObject({ date: "2026-11-15", isFuture: true, level: 0 });
    expect(cells.find((c) => c.isToday)!.date).toBe("2026-11-12");
    expect(cells.find((c) => c.date === "2026-11-10")!.level).toBe(2);
    expect([writingLevel(false, ""), writingLevel(true, ""), writingLevel(true, "two words"), writingLevel(true, "w ".repeat(40))]).toEqual([0, 1, 2, 3]);
  });
});
