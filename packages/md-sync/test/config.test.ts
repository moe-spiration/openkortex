import { describe, expect, it } from "vitest";
import { readIngestConfig } from "../src/config";

describe("readIngestConfig: ADR-06 key gate", () => {
  it.each([
    ["ANTHROPIC_API_KEY", { ANTHROPIC_API_KEY: "a" }],
    ["CLAUDE_API_KEY (legacy alias)", { CLAUDE_API_KEY: "a" }],
    ["OPENROUTER_API_KEY", { OPENROUTER_API_KEY: "o" }],
    ["EDENAI_API_KEY", { EDENAI_API_KEY: "e" }],
  ])("any provider key turns ingest on: %s", (_name, env) => {
    expect(readIngestConfig(env)).toMatchObject({ enabled: true, disabledReason: null });
  });

  it("no key (or only placeholders) keeps it off with a reason naming all three", () => {
    for (const env of [{}, { OPENROUTER_API_KEY: "<DEIN_OPENROUTER_API_KEY>" }]) {
      const cfg = readIngestConfig(env);
      expect(cfg.enabled).toBe(false);
      expect(cfg.disabledReason).toMatch(/ANTHROPIC_API_KEY.*OPENROUTER_API_KEY.*EDENAI_API_KEY/);
    }
  });

  it("KORTEX_SYNC_INGEST=0 wins over keys", () => {
    expect(readIngestConfig({ KORTEX_SYNC_INGEST: "0", OPENROUTER_API_KEY: "o" }).enabled).toBe(false);
  });
});
