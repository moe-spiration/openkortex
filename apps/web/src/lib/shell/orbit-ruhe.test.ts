import { describe, expect, it } from "vitest";
import { dropKindLabel, withContextLink } from "./orbit";

describe("orbit (Ruhe)", () => {
  it("links the open entry once", () => {
    expect(withContextLink("Mag Zahlen lieber als Folien", "Jonas Weber")).toBe("Mag Zahlen lieber als Folien [[Jonas Weber]]");
    expect(withContextLink("Frage an [[Jonas Weber]]", "Jonas Weber")).toBe("Frage an [[Jonas Weber]]");
    expect(withContextLink("  ", "Jonas Weber")).toBe("");
  });

  it("names the dragged kind", () => {
    expect(dropKindLabel(["application/pdf"])).toBe("PDF");
    expect(dropKindLabel(["image/png", "image/jpeg"])).toBe("2 Bilder");
    expect(dropKindLabel(["image/png", "application/pdf"])).toBe("2 Dateien");
    expect(dropKindLabel([])).toBe("Datei");
  });
});
