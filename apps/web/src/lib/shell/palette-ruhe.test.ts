import { describe, expect, it } from "vitest";
import { canBrief, entrySubtitle, isSingleTerm, matchFolders, shortDay } from "./palette-ruhe";

const base = { today: "2026-11-26", locale: "de-DE" };

describe("palette (Ruhe)", () => {
  it("leads with the type, then role, passage or day", () => {
    expect(entrySubtitle({ ...base, type: "person", typeLabel: "Person", metadata: { role: "CTO", organization: "Nordlicht Systems" } })).toBe(
      "Person · CTO, Nordlicht Systems",
    );
    expect(entrySubtitle({ ...base, type: "meeting", typeLabel: "Meeting", date: "2026-10-14" })).toBe("Meeting · 14.10.");
    expect(entrySubtitle({ ...base, type: "note", typeLabel: "Notiz", date: "2026-11-26", snippet: "erwähnt Jonas" })).toBe("Notiz · erwähnt Jonas");
    expect(entrySubtitle({ ...base, type: "note", typeLabel: "Notiz", date: "2026-11-26" })).toBe("Notiz");
  });

  it("formats the short day per language", () => {
    expect(shortDay("2026-10-14", "de-DE")).toBe("14.10.");
    expect(shortDay("2026-10-14", "en-US")).toBe("10/14");
    expect(shortDay("nope", "de-DE")).toBe("");
  });

  it("knows briefable types and single terms", () => {
    expect(canBrief("person")).toBe(true);
    expect(canBrief("meeting")).toBe(false);
    expect(isSingleTerm("Jonas")).toBe(true);
    expect(isSingleTerm("Was ist offen?")).toBe(false);
    expect(isSingleTerm("Jonas?")).toBe(false);
  });

  it("matches folders shallow first", () => {
    const f = [
      { name: "Ideen", path: "10_Notes/Ideen", depth: 1 },
      { name: "10_Notes", path: "10_Notes", depth: 0 },
      { name: "Work", path: "20_Meetings/Work", depth: 1 },
    ];
    expect(matchFolders(f, "notes").map((x) => x.path)).toEqual(["10_Notes", "10_Notes/Ideen"]);
    expect(matchFolders(f, "", 2)).toHaveLength(2);
  });
});
