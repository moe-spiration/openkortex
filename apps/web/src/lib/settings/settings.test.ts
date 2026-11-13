import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { t } from "@/i18n";
import { DEFAULT_AI_ROUTING, type EmbeddingLock } from "@kortex/db/routing";
import {
  EMBEDDINGS_LOCKED_ERROR,
  embeddingsPatchError,
  REEMBED_COMMAND,
  withoutEmbeddings,
} from "./embedding-lock";
import {
  generateMcpToken,
  hashMcpToken,
  mcpTokenHint,
  newMcpTokenRecord,
  verifyMcpToken,
} from "./mcp-token";
import { checkUserSettingsPatch, lifeAreas, mergeLifeAreas, USER_SETTINGS_WRITABLE } from "./patch";

describe("user_settings patch whitelist", () => {
  it("accepts the columns the settings UI edits", () => {
    const r = checkUserSettingsPatch({
      auto_tag_enabled: false,
      auto_cluster_enabled: true,
      weekly_digest_day: 6,
      enabled_connectors: ["web", "pdf", "web"],
      custom_taxonomy: [{ kind: "life_area", label: "Ventures" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.enabled_connectors).toEqual(["web", "pdf"]);
  });

  it("accepts an empty patch", () => {
    expect(checkUserSettingsPatch({})).toEqual({ ok: true, patch: {} });
  });

  it.each([
    "user_id",
    "subscription_tier",
    "ai_routing_config",
    "embedding_lock",
    "mcp_token_hash",
    "inbound_mail_token",
    "updated_at",
    "embedding_model",
  ])("refuses %s", (key) => {
    const r = checkUserSettingsPatch({ auto_tag_enabled: true, [key]: "x" });
    expect(r).toEqual({ ok: false, error: `Nicht änderbar: ${key}` });
  });

  it("never whitelists protected columns", () => {
    for (const k of ["user_id", "subscription_tier", "ai_routing_config", "embedding_lock"])
      expect(USER_SETTINGS_WRITABLE as readonly string[]).not.toContain(k);
  });

  it("validates values", () => {
    expect(checkUserSettingsPatch({ weekly_digest_day: 7 }).ok).toBe(false);
    expect(checkUserSettingsPatch({ weekly_digest_day: 1.5 }).ok).toBe(false);
    expect(checkUserSettingsPatch({ auto_tag_enabled: "yes" }).ok).toBe(false);
    expect(checkUserSettingsPatch({ enabled_connectors: [""] }).ok).toBe(false);
    expect(checkUserSettingsPatch({ custom_taxonomy: [{ label: "x" }] }).ok).toBe(false);
    expect(checkUserSettingsPatch(null).ok).toBe(false);
    expect(checkUserSettingsPatch([]).ok).toBe(false);
  });
});

describe("theme pack and accent", () => {
  it("accepts every pack id, presets and a custom hex", () => {
    expect(checkUserSettingsPatch({ theme_pack: "origami", accent: "teal" }).ok).toBe(true);
    expect(checkUserSettingsPatch({ accent: "#12aBef" }).ok).toBe(true);
  });

  it("rejects unknown packs, accents and malformed hex", () => {
    expect(checkUserSettingsPatch({ theme_pack: "neon" }).ok).toBe(false);
    expect(checkUserSettingsPatch({ accent: "chartreuse" }).ok).toBe(false);
    expect(checkUserSettingsPatch({ accent: "#12345" }).ok).toBe(false);
    expect(checkUserSettingsPatch({ accent: 3 }).ok).toBe(false);
  });

  it("both are writable columns", () => {
    expect(USER_SETTINGS_WRITABLE).toContain("theme_pack");
    expect(USER_SETTINGS_WRITABLE).toContain("accent");
  });
});

describe("custom_taxonomy life areas", () => {
  it("merges without dropping or duplicating existing entries", () => {
    const existing = [
      { kind: "life_area", label: "Ventures" },
      { kind: "project_area", label: "Kortex" },
      "legacy",
    ];
    const next = mergeLifeAreas(existing, [
      "ventures",
      "Health & Fitness",
      " ",
      "Health & Fitness",
    ]);
    expect(next).toEqual([...existing, { kind: "life_area", label: "Health & Fitness" }]);
    expect(lifeAreas(next)).toEqual(["Ventures", "Health & Fitness"]);
  });

  it("starts from an empty taxonomy when the column is null or not an array", () => {
    expect(mergeLifeAreas(null, ["Ventures"])).toEqual([{ kind: "life_area", label: "Ventures" }]);
    expect(mergeLifeAreas({ a: 1 }, [])).toEqual([]);
  });
});

describe("MCP token", () => {
  it("is 32 random bytes as base64url", () => {
    const t = generateMcpToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(generateMcpToken()).not.toBe(t);
  });

  it("stores only a SHA-256 hash and a 4-char hint", () => {
    expect(hashMcpToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(mcpTokenHint("abcdefgh")).toBe("efgh");
    const now = new Date("2026-10-26T10:00:00Z");
    const { token, columns } = newMcpTokenRecord(now);
    expect(columns).toEqual({
      mcp_token_hash: hashMcpToken(token),
      mcp_token_hint: token.slice(-4),
      mcp_token_created_at: now.toISOString(),
    });
    expect(JSON.stringify(columns)).not.toContain(token);
  });

  it("verifies a token against its hash", () => {
    const { token, columns } = newMcpTokenRecord();
    expect(verifyMcpToken(token, columns.mcp_token_hash)).toBe(true);
    expect(verifyMcpToken(token + "x", columns.mcp_token_hash)).toBe(false);
    expect(verifyMcpToken(token, null)).toBe(false);
    expect(verifyMcpToken(token, "nothex")).toBe(false);
  });

  it("matches the migration's check constraint shape", () => {
    const sql = readFileSync(
      fileURLToPath(
        new URL(
          "../../../../../packages/db/supabase/migrations/20261026000000_mcp_token.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(sql).toContain("kortex.user_settings");
    // DDL only on kortex.* (public.user_settings belongs to another app).
    expect(sql).not.toMatch(/(alter table|\bon)\s+public\./i);
    expect(new RegExp("^[0-9a-f]{64}$").test(newMcpTokenRecord().columns.mcp_token_hash)).toBe(
      true,
    );
  });
});

describe("embedding lock refusal", () => {
  const lock: EmbeddingLock = { provider: "openrouter", model_id: "fx/emb", dimensions: 1536 };

  it("refuses any patch touching embeddings while locked", () => {
    expect(embeddingsPatchError({ embeddings: { model_id: "other" } }, lock)).toBe(
      t(EMBEDDINGS_LOCKED_ERROR),
    );
    expect(
      embeddingsPatchError(
        { summarize: { model_id: null }, embeddings: { provider: "edenai" } },
        lock,
      ),
    ).toBe(t(EMBEDDINGS_LOCKED_ERROR));
  });

  it("lets other tasks save while locked, and everything without a lock", () => {
    expect(embeddingsPatchError({ summarize: { auto_mode: "balanced" } }, lock)).toBeNull();
    expect(embeddingsPatchError({ embeddings: { model_id: "other" } }, null)).toBeNull();
  });

  it("strips embeddings from a reset patch", () => {
    const p = withoutEmbeddings({ ...DEFAULT_AI_ROUTING });
    expect("embeddings" in p).toBe(false);
    expect(embeddingsPatchError(p, lock)).toBeNull();
    expect(Object.keys(p)).toHaveLength(Object.keys(DEFAULT_AI_ROUTING).length - 1);
  });

  it("names the md-sync reembed command", () => {
    expect(REEMBED_COMMAND()).toBe(
      "pnpm --filter @kortex/md-sync reembed -- --to <provider>:<model> --yes",
    );
  });
});
