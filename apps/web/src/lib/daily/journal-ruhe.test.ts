import { describe, expect, it } from "vitest";
import { energyLevel, energyOfLevel, joinEntry, splitEntry } from "./journal-ruhe";

describe("journal ruhe", () => {
  it("splits and joins the entry without losing lines", () => {
    const text = "Review prepared\nWofür bin ich dankbar? Morning run\nLong day";
    const s = splitEntry(text);
    expect(s).toEqual({ important: "Review prepared\nLong day", grateful: "Morning run" });
    expect(joinEntry(s.important, s.grateful, "Wofür bin ich dankbar?")).toBe("Review prepared\nLong day\nWofür bin ich dankbar? Morning run");
    expect(splitEntry("What am I grateful for? Sun").grateful).toBe("Sun");
    expect(joinEntry("", "", "Wofür bin ich dankbar?")).toBe("");
    expect(joinEntry("a", "", "Wofür bin ich dankbar?")).toBe("a");
  });
  it("maps the energy 1..10 to 1..5 and back", () => {
    expect(energyLevel(9)).toBe(5);
    expect(energyLevel(7)).toBe(4);
    expect(energyLevel(1)).toBe(1);
    expect(energyLevel(null)).toBeNull();
    expect(energyOfLevel(4)).toBe(8);
    expect(energyOfLevel(1)).toBe(2);
    expect(energyLevel(energyOfLevel(3))).toBe(3);
  });
});
