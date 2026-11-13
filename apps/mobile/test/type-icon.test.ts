import { describe, expect, it } from "vitest";
import { REGISTERED_TYPES, typeIcon } from "@kortex/db/type-registry";
import { LUCIDE, typeIconName } from "../src/ui/typeIcon";

describe("type icons", () => {
  it("maps every registry icon onto the app's icon set", () => {
    for (const t of REGISTERED_TYPES) expect(LUCIDE[typeIcon(t)], `${t} → ${typeIcon(t)}`).toBeTruthy();
    expect(typeIconName("movie")).toBe("clapperboard");
    expect(typeIconName("unknown")).toBe("note");
  });
});
