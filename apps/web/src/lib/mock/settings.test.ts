import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AI_TASKS, DEFAULT_AI_ROUTING, parseAiRouting } from "@kortex/db/routing";
import * as settingsMock from "./settings";
import { CONNECTORS, MOCK_USER_SETTINGS } from "./settings";

describe("settings catalogs", () => {
  it("routes every task like DEFAULT_AI_ROUTING, all on Auto (ADR-06: no hardcoded model ids)", () => {
    const cfg = parseAiRouting(MOCK_USER_SETTINGS.ai_routing_config);
    expect(cfg).toEqual(DEFAULT_AI_ROUTING);
    for (const t of AI_TASKS) expect(cfg[t].model_id).toBeNull();
  });

  it("no longer ships a hardcoded model list", () => {
    expect(Object.keys(settingsMock)).not.toEqual(expect.arrayContaining(["CHAT_MODELS"]));
    expect("EMBEDDING_MODELS" in settingsMock).toBe(false);
  });

  it("leaves the deprecated model columns empty (only ai_routing_config is read)", () => {
    expect(MOCK_USER_SETTINGS.preferred_chat_model).toBe("");
    expect(MOCK_USER_SETTINGS.preferred_fast_model).toBe("");
    expect(MOCK_USER_SETTINGS.embedding_model).toBe("");
  });

  it("enables the connectors kortex.user_settings enables by default", () => {
    // The newest migration that sets the column default wins (initial schema, then later changes).
    const dir = fileURLToPath(
      new URL("../../../../../packages/db/supabase/migrations/", import.meta.url),
    );
    let defaults: string[] = [];
    for (const f of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = readFileSync(`${dir}${f}`, "utf8");
      const m =
        /enabled_connectors text\[\] default array\[([^\]]+)\]/.exec(sql) ??
        /alter column enabled_connectors\s+set default array\[([^\]]+)\]/.exec(sql);
      if (m) defaults = m[1]!.split(",").map((s) => s.trim().replace(/'/g, ""));
    }
    expect(defaults).toContain("vision");
    expect([...(MOCK_USER_SETTINGS.enabled_connectors ?? [])].sort()).toEqual(defaults.sort());
    // every enabled connector has a row in the settings list
    for (const id of defaults) expect(CONNECTORS.some((c) => c.id === id)).toBe(true);
  });
});
