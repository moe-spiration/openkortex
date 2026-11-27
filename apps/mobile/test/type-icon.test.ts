import { describe, expect, it } from "vitest";
import { REGISTERED_TYPES, typeIcon } from "@kortex/db/type-registry";
import { LUCIDE, typeIconName } from "../src/ui/typeIcon";

describe("type icons", () => {
  it("maps every registry icon onto the app's icon set", () => {
    for (const t of REGISTERED_TYPES) expect(LUCIDE[typeIcon(t)], `${t} → ${typeIcon(t)}`).toBeTruthy();
    expect(typeIconName("movie")).toBe("clapperboard");
    // Unknown types fall back to the registry's file-text, drawn as the Lucide file-text shape since the Ruhe icons (2026-11-27).
    expect(typeIconName("unknown")).toBe("fileText");
  });
});
