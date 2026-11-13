import { describe, expect, it } from "vitest";
import {
  connectorForType,
  isConnectorEnabled,
  placementDecision,
  placementOf,
  thresholdOf,
} from "./gates";

describe("gates", () => {
  it("decides placement like the web inbox", () => {
    const p = placementOf({ placement: { confidence: 0.5, folder_path: "10_Notes/Work" } });
    expect(p).toEqual({ confidence: 0.5, review: false, folderPath: "10_Notes/Work" });
    expect(placementDecision(p, false, 0.7)).toBe("review");
    expect(placementDecision(p, false, 0.4)).toBe("auto");
    expect(placementDecision(p, true, 0.7)).toBe("manual");
    expect(placementDecision(null, false, 1)).toBe("review");
    expect(thresholdOf("0.85")).toBe(0.85);
    expect(thresholdOf(null)).toBe(0.7);
  });

  it("maps item types to connectors", () => {
    expect(connectorForType("ai_chat")).toBe("ai_chat");
    expect(connectorForType("note")).toBeNull();
    expect(isConnectorEnabled("ai_chat", ["web"])).toBe(false);
    expect(isConnectorEnabled("ai_chat", null)).toBe(true);
    expect(isConnectorEnabled(null, [])).toBe(true);
  });
});
