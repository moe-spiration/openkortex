import { describe, expect, it } from "vitest";
import { folderLabel, lensOf, UNCLEAR_BELOW } from "./inboxLens";

describe("Ruhe inbox lenses", () => {
  it("counts a proposal without target or with low confidence as unclear", () => {
    expect(lensOf({ chosenTarget: "" }, undefined)).toBe("unclear");
    expect(lensOf({ chosenTarget: "30_Clippings/AI" }, UNCLEAR_BELOW - 1)).toBe("unclear");
    expect(lensOf({ chosenTarget: "30_Clippings/AI" }, UNCLEAR_BELOW)).toBe("suggested");
    expect(lensOf({ chosenTarget: "30_Clippings/AI" }, undefined)).toBe("suggested");
  });

  it("names a folder chip by its last path segment without the vault number", () => {
    expect(folderLabel("30_Clippings/AI_Engineering")).toBe("AI Engineering");
    expect(folderLabel("90_Digests/Weekly_Review")).toBe("Weekly Review");
    expect(folderLabel("60_Documents")).toBe("Books"); // a known target keeps its label
  });
});
