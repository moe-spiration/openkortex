import { describe, expect, it } from "vitest";
import { inboundMailRow } from "../src/data/settings";

// Mail an Kortex on the phone: read-only row (address is created and rotated in the web).
describe("inboundMailRow", () => {
  it("shows the address to copy", () => {
    expect(inboundMailRow({ configured: true, domain: "in.k.test", address: "abc@in.k.test", rotatedAt: null })).toEqual({ help: "abc@in.k.test", value: "Kopieren" });
  });
  it("points to the web while there is no address, and says when the server is not set up", () => {
    expect(inboundMailRow({ configured: true, domain: "in.k.test", address: null, rotatedAt: null }).value).toBe("Im Web");
    expect(inboundMailRow({ configured: false, domain: null, address: null, rotatedAt: null }).value).toBe("Aus");
    expect(inboundMailRow(null).help).toBe("Wird geladen");
  });
});
