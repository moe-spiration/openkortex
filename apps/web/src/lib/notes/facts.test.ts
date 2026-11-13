import { describe, expect, it } from "vitest";
import { initialsOf, keyFacts, peopleLabel, whenLine } from "./facts";

describe("note head facts", () => {
  it("lists filled typed fields with German labels and option labels, then the duration", () => {
    const facts = keyFacts({ type: "book", dbType: "book", metadata: { status: "reading", author: "Chip Huyen", duration_sec: 600 } });
    expect(facts.find((f) => f.key === "status")).toEqual({ key: "status", label: "Status", value: "Lese ich" });
    expect(facts.find((f) => f.key === "author")).toEqual({ key: "author", label: "Autor", value: "Chip Huyen" });
    expect(facts.at(-1)).toEqual({ key: "duration", label: "Dauer", value: "10:00" });
  });

  it("skips empty values, domain objects and free types", () => {
    expect(keyFacts({ type: "book", dbType: "book", metadata: { status: "", author: null } })).toEqual([]);
    expect(keyFacts({ type: "person", dbType: "person", metadata: { role: "Lead" } })).toEqual([]);
    expect(keyFacts({ type: "note", dbType: "note", metadata: {} })).toEqual([]);
  });

  it("writes the date line relative to today", () => {
    expect(whenLine("2026-11-07", "09:30", "2026-11-07")).toBe("Heute 09:30");
    expect(whenLine("2026-11-06", "21:30", "2026-11-07")).toBe("Gestern 21:30");
    expect(whenLine("2026-10-27", "10:00", "2026-11-07")).toMatch(/^Di\.?, 27\. Okt\.? 10:00$/);
    expect(whenLine("2025-10-27", "10:00", "2026-11-07")).toContain("2025");
  });

  it("builds initials and the people label", () => {
    expect(initialsOf("Sven Bauer")).toBe("SB");
    expect(initialsOf("Kortex")).toBe("K");
    expect(initialsOf("Dr. Louisa Weber")).toBe("LW");
    expect(peopleLabel(["Sven Bauer"])).toBe("Sven Bauer");
    expect(peopleLabel(["Sven Bauer", "Anna Roth"])).toBe("Sven, Anna");
    expect(peopleLabel(["Sven Bauer", "Dr. Louisa Weber"])).toBe("Sven, Louisa");
    expect(peopleLabel(["Sven Bauer", "Anna Roth", "Lea Lu", "Max M"])).toBe("Sven, Anna +2");
  });
});
