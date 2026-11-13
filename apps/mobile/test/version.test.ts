import { describe, expect, test } from "vitest";
import { versionLabel } from "../src/lib/version";

describe("versionLabel", () => {
  test("embedded build: version, versionCode, SDK major", () => {
    expect(versionLabel({ version: "0.4.0", versionCode: 5, sdkVersion: "58.0.0" })).toBe(
      "Kortex 0.4.0 (5) · Expo SDK 58 · Build ohne Update",
    );
  });
  test("running an EAS update: short id, date and channel", () => {
    expect(
      versionLabel({
        version: "0.4.0",
        versionCode: 5,
        sdkVersion: "58.0.0",
        updateId: "1a2b3c4d-0000-4000-8000-000000000000",
        updateCreatedAt: new Date("2026-11-01T09:30:00Z"),
        channel: "production",
      }),
    ).toBe("Kortex 0.4.0 (5) · Expo SDK 58 · Update 1a2b3c4d vom 2026-11-01 · production");
  });
  test("missing optional fields are left out", () => {
    expect(versionLabel({ version: "1.2.3", updateId: "abcdef1234", updateCreatedAt: new Date("nope") })).toBe(
      "Kortex 1.2.3 · Update abcdef12",
    );
  });
});
