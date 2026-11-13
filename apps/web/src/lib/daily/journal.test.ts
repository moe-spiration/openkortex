import { describe, expect, it } from "vitest";
import { appendPrompt, averageLabel, entryWhen, heatCells, isoWeekNumber, mindDumpOf, topHashtags, weekRangeLabel, writingLevel } from "./journal";

describe("journal helpers (Tagebuch)", () => {
  it("reads the Mind Dump section of a daily note", () => {
    const md = ["# Daily Journal 2026-11-05", "", "## Check-in", "- Energie: 7/10", "", "## Mind Dump", "- Erster Gedanke", "- Wofür bin ich dankbar? Ruhe", "", "## Voice Check-ins", "- 08:12 · 0:30"].join("\n");
    expect(mindDumpOf(md)).toEqual(["Erster Gedanke", "Wofür bin ich dankbar? Ruhe"]);
    expect(mindDumpOf("# Daily\n\n## Check-in\n- [x] Mobility")).toEqual([]);
    expect(mindDumpOf(undefined)).toEqual([]);
  });

  it("grades the writing of a day", () => {
    expect(writingLevel(false, "")).toBe(0);
    expect(writingLevel(true, "")).toBe(1);
    expect(writingLevel(true, "kurz notiert")).toBe(2);
    expect(writingLevel(false, Array.from({ length: 40 }, () => "wort").join(" "))).toBe(3);
  });

  it("builds twelve Monday-based weeks ending with the current one", () => {
    // 2026-11-05 is a Thursday: the last column holds Mo 2.11. … So 8.11., Fr to So are future cells.
    const cells = heatCells("2026-11-05", (d) => (d === "2026-11-02" ? 2 : 0));
    expect(cells).toHaveLength(84);
    expect(cells[0]!.date).toBe("2026-08-17");
    expect(cells[77]!.date).toBe("2026-11-02");
    expect(cells[77]!.level).toBe(2);
    expect(cells.filter((c) => c.isToday).map((c) => c.date)).toEqual(["2026-11-05"]);
    expect(cells.filter((c) => c.isFuture).map((c) => c.date)).toEqual(["2026-11-06", "2026-11-07", "2026-11-08"]);
  });

  it("labels weeks and entries in German", () => {
    expect(isoWeekNumber("2026-10-22")).toBe(43);
    expect(isoWeekNumber("2027-01-01")).toBe(53);
    expect(weekRangeLabel("2026-10-19")).toBe("19. bis 25. Oktober 2026");
    expect(weekRangeLabel("2026-10-26")).toBe("26. Oktober bis 1. November 2026");
    expect(entryWhen("2026-11-04", "21:50", "2026-11-05")).toBe("Gestern, 21:50");
    expect(entryWhen("2026-11-02", "22:10", "2026-11-05")).toBe("Mo, 22:10");
    expect(entryWhen("2026-10-17", "19:40", "2026-11-05")).toBe("17. Okt., 19:40");
  });

  it("appends a prompt on its own line", () => {
    expect(appendPrompt("", "Was nehme ich mit?")).toBe("Was nehme ich mit? ");
    expect(appendPrompt("Gedanke", "Was nehme ich mit?")).toBe("Gedanke\nWas nehme ich mit? ");
  });

  it("computes the week's facts", () => {
    expect(topHashtags([{ tags: ["#ai/mcp", "#daily"] }, { tags: ["#ai/mcp", "#fitness/hyrox"] }, { tags: ["#fitness/hyrox", "#ai/mcp"] }])).toEqual(["#ai/mcp", "#fitness/hyrox"]);
    expect(averageLabel([6, 8, null, 7.5])).toBe("7,2");
    expect(averageLabel([8, 8])).toBe("8");
    expect(averageLabel([null])).toBeNull();
  });
});
