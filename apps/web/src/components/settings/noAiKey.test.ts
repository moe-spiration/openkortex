import { describe, expect, it } from "vitest";
import { noAiKey } from "./noAiKey";

describe("noAiKey", () => {
  it("is true only when the status is known and every key is missing", () => {
    expect(noAiKey({ anthropic: false, openrouter: false, edenai: false })).toBe(true);
    expect(noAiKey({ anthropic: true, openrouter: false, edenai: false })).toBe(false);
    expect(noAiKey({ anthropic: false, openrouter: false, edenai: true })).toBe(false);
    expect(noAiKey(null)).toBe(false);
    expect(noAiKey(undefined)).toBe(false);
  });
});
