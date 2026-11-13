import { describe, expect, it } from "vitest";
import { DEFAULT_AUTO_PLACE_THRESHOLD, placementDecision, placementOf, thresholdOf } from "./placement";

describe("auto-placement", () => {
  it("reads metadata.placement", () => {
    expect(placementOf({ placement: { confidence: 0.82, folder_path: "10_Notes", source: "organizer" } })).toEqual({ confidence: 0.82, review: false, folderPath: "10_Notes" });
    expect(placementOf({ placement: { confidence: "x", review: true } })).toEqual({ confidence: null, review: true, folderPath: null });
    expect(placementOf({})).toBeNull();
    expect(placementOf(null)).toBeNull();
  });

  it("files confident and unknown placements, asks below the threshold or when flagged", () => {
    const p = (confidence: number | null, review = false) => ({ confidence, review, folderPath: null });
    expect(placementDecision(p(0.8), false)).toBe("auto");
    expect(placementDecision(p(0.7), false)).toBe("auto");
    expect(placementDecision(p(0.69), false)).toBe("review");
    expect(placementDecision(p(null), false)).toBe("auto");
    expect(placementDecision(null, false)).toBe("auto");
    expect(placementDecision(p(0.99, true), false)).toBe("review");
    expect(placementDecision(p(0.1), true)).toBe("manual");
    expect(placementDecision(p(0.8), false, 0.9)).toBe("review");
    expect(placementDecision(p(1), false, 1)).toBe("review");
    expect(placementDecision(null, false, 1)).toBe("review");
  });

  it("parses the threshold from the settings row", () => {
    expect(thresholdOf("0.85")).toBe(0.85);
    expect(thresholdOf(2)).toBe(1);
    expect(thresholdOf(undefined)).toBe(DEFAULT_AUTO_PLACE_THRESHOLD);
  });
});
