import { describe, expect, it } from "vitest";
import { uniqueTitle } from "./unique-title";

describe("uniqueTitle (W-06: sub-pages no longer share 'Neue Unterseite')", () => {
  it("keeps a free title and numbers taken ones", () => {
    expect(uniqueTitle("Neue Unterseite", ["Andere"])).toBe("Neue Unterseite");
    expect(uniqueTitle("Neue Unterseite", ["neue unterseite"])).toBe("Neue Unterseite 2");
    expect(uniqueTitle("Neue Unterseite", ["Neue Unterseite", "Neue Unterseite 2"])).toBe("Neue Unterseite 3");
    expect(uniqueTitle("  ", [])).toBe("Unbenannt");
  });
});
