import { describe, expect, it } from "vitest";
import {
  appendWikiLinks,
  normalizeTag,
  organize,
  resolveFolderPath,
  resolveTags,
  type Enrichment,
  type OrganizerContext,
} from "../src/enrichment/auto-organizer";
import { mockModel } from "./helpers";

const ctx: OrganizerContext = {
  existingTags: ["ai/mcp", "automotive/transformation", "rezepte/low-carb"],
  existingClusters: ["Automotive & Enterprise AI", "Kochen & Ernährung"],
  existingObjects: [
    { id: "obj-supabase", title: "Supabase", type: "tool" },
    { id: "obj-sven", title: "Sven Krüger", type: "person", aliases: ["Sven"] },
    { id: "obj-kortex", title: "Kortex", type: "project" },
  ],
  folderPaths: ["10_Notes/Automotive"],
};

const answer: Enrichment = {
  title: "Q4 Architektur-Sync: Agentic Workflows & MCP",
  summary:
    "Das Team entscheidet sich für MCP als Agenten-Schnittstelle. Supabase bleibt Quelle der Wahrheit.",
  cluster_name: "automotive & enterprise ai",
  suggested_folder_path: "20_Meetings",
  tags: [
    "AI/MCP",
    "Architecture / Hybrid Search",
    "ai/mcp",
    "devops",
    "supabase",
    "extra-1",
    "extra-2",
  ],
  entities: [
    { name: "supabase", type: "tool" },
    { name: "Sven", type: "person" },
    { name: "Sven Krüger", type: "person" },
    { name: "Deepgram Nova-3", type: "tool" },
    { name: "Model Context Protocol", type: "concept" },
    { name: "Q4", type: "other" },
  ],
  action_items: [
    {
      title: "SQL-Schema für Hybrid-Search finalisieren",
      description: null,
      assignee: "Me",
      priority: "high",
      due_date: "2026-10-23",
      source_timestamp_sec: 72.4,
    },
    {
      title: "API-Keys für Deepgram einrichten",
      description: " ",
      assignee: "",
      priority: "medium",
      due_date: "nächste Woche",
      source_timestamp_sec: null,
    },
    {
      title: "  ",
      description: null,
      assignee: "Me",
      priority: "low",
      due_date: null,
      source_timestamp_sec: null,
    },
  ],
};

const baseInput = {
  type: "meeting" as const,
  sourcePlatform: "teams_wasapi",
  contentMd: "# Q4 Sync\n\nMax: Wir nehmen MCP. Sven richtet Deepgram ein.",
  isManualPlacement: false,
};

describe("organize", () => {
  it("sends existing tags, clusters and objects to the model and normalizes its answer", async () => {
    const model = mockModel(answer);
    const out = await organize({ ...baseInput, manualTags: ["Meeting/Q4"] }, ctx, { model });

    const call = model.doGenerateCalls[0];
    const system = JSON.stringify(call?.prompt.filter((m) => m.role === "system"));
    expect(system).toContain("ai/mcp");
    expect(system).toContain("Automotive & Enterprise AI");
    expect(system).toContain("person: Sven Krüger");
    expect(system).toContain("Manual placement active: no");
    expect(system).toContain("default German");
    expect(call?.responseFormat).toMatchObject({ type: "json" });

    expect(out.title).toBe(answer.title);
    expect(out.clusterName).toBe("Automotive & Enterprise AI"); // snapped to existing
    expect(out.folderPath).toBe("20_Meetings");
    // Manual tags first, then max 5 AI tags, snapped to existing and de-duplicated.
    expect(out.tags).toEqual([
      "meeting/q4",
      "ai/mcp",
      "architecture/hybrid-search",
      "devops",
      "supabase",
      "extra-1",
    ]);
    expect(out.entities).toEqual([
      "Supabase",
      "Sven Krüger",
      "Deepgram Nova-3",
      "Model Context Protocol",
      "Q4",
    ]);
    expect(out.linkedEntities).toEqual([
      { name: "Supabase", type: "tool", objectId: "obj-supabase", objectType: "tool" },
      { name: "Sven Krüger", type: "person", objectId: "obj-sven", objectType: "person" },
    ]);
    expect(out.suggestedObjects).toEqual([
      { name: "Deepgram Nova-3", type: "tool" },
      { name: "Model Context Protocol", type: "concept" },
    ]);
    expect(out.actionItems).toEqual([
      {
        title: "SQL-Schema für Hybrid-Search finalisieren",
        description: null,
        assignee: "Me",
        priority: "high",
        due_date: "2026-10-23",
        source_timestamp_sec: 72,
        project_item_id: null,
        project_title: null,
        timeframe: null,
        context: null,
      },
      {
        title: "API-Keys für Deepgram einrichten",
        description: null,
        assignee: "Me",
        priority: "medium",
        due_date: null,
        source_timestamp_sec: null,
        project_item_id: null,
        project_title: null,
        timeframe: null,
        context: null,
      },
    ]);
  });

  it("leaves folder and cluster untouched when is_manual_placement is true", async () => {
    const model = mockModel(answer);
    const out = await organize({ ...baseInput, isManualPlacement: true }, ctx, { model });
    expect(out.folderPath).toBeNull();
    expect(out.clusterName).toBeNull();
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "Manual placement active: yes",
    );
    // Tags and entities are still generated.
    expect(out.tags.length).toBeGreaterThan(0);
  });

  it("respects auto_tag_enabled = false and auto_cluster_enabled = false", async () => {
    const out = await organize(
      { ...baseInput, manualTags: ["privat"], autoTagEnabled: false, autoClusterEnabled: false },
      ctx,
      { model: mockModel(answer) },
    );
    expect(out.tags).toEqual(["privat"]);
    expect(out.clusterName).toBeNull();
  });

  it("truncates long content and clamps long titles", async () => {
    const model = mockModel({ ...answer, title: "Ein sehr langer Titel ".repeat(10) });
    const out = await organize({ ...baseInput, contentMd: "x".repeat(50_000) }, ctx, {
      model,
      maxContentChars: 1000,
    });
    expect(out.title.length).toBeLessThanOrEqual(80);
    expect(out.title.endsWith("…")).toBe(true);
    const user = JSON.stringify(model.doGenerateCalls[0]?.prompt.filter((m) => m.role === "user"));
    expect(user).toContain("(truncated)");
    expect(user.length).toBeLessThan(3000);
  });
});

describe("organizer rules", () => {
  it("normalizes tags", () => {
    expect(normalizeTag(" #Fitness / HYROX Training ")).toBe("fitness/hyrox-training");
    expect(normalizeTag("a/b/c/d")).toBe("a/b/c");
    expect(normalizeTag("Rezepte/Low-Carb!")).toBe("rezepte/low-carb");
    expect(resolveTags(["Rezepte/Low Carb"], [], ["rezepte/low-carb"], true)).toEqual([
      "rezepte/low-carb",
    ]);
  });

  it("only accepts known folders or sub-folders of them", () => {
    expect(resolveFolderPath("30_clippings", "article")).toBe("30_Clippings");
    expect(resolveFolderPath("10_Notes/Automotive/Mercedes-AMG", "note", ctx.folderPaths)).toBe(
      "10_Notes/Automotive/Mercedes-AMG",
    );
    expect(resolveFolderPath("/70_Objects/People/", "person")).toBe("70_Objects/People");
    expect(resolveFolderPath("Random/Folder", "recipe")).toBe("50_Recipes");
    expect(resolveFolderPath(null, "pdf")).toBe("60_Documents");
  });

  it("appends wiki-links for linked objects only", () => {
    expect(appendWikiLinks("Text\n", [])).toBe("Text\n");
    expect(
      appendWikiLinks("Text", [
        { name: "Supabase", type: "tool", objectId: "1", objectType: "tool" },
        { name: "supabase", type: "tool", objectId: "1", objectType: "tool" },
      ]),
    ).toBe("Text\n\n## Verknüpft\n\n- [[Supabase]]\n");
  });
});

describe("placement confidence (zero-setup auto-placement)", () => {
  const input = { type: "note" as const, sourcePlatform: "manual", contentMd: "x", isManualPlacement: false };

  it("passes the model's confidence through, clamped to 0..1", async () => {
    const { normalizeEnrichment } = await import("../src/enrichment/auto-organizer");
    expect(normalizeEnrichment({ ...answer, placement_confidence: 0.82 }, input, ctx).placementConfidence).toBe(0.82);
    expect(normalizeEnrichment({ ...answer, placement_confidence: null }, input, ctx).placementConfidence).toBeNull();
    expect(normalizeEnrichment({ ...answer }, input, ctx).placementConfidence).toBeNull();
  });

  it("caps it when the suggested folder could not be used, null for manual placement", async () => {
    const { normalizeEnrichment } = await import("../src/enrichment/auto-organizer");
    const unusable = normalizeEnrichment({ ...answer, suggested_folder_path: "99_Nowhere", placement_confidence: 0.95 }, input, ctx);
    expect(unusable.folderPath).toBe("10_Notes");
    expect(unusable.placementConfidence).toBe(0.5);
    expect(normalizeEnrichment({ ...answer, placement_confidence: 0.9 }, { ...input, isManualPlacement: true }, ctx).placementConfidence).toBeNull();
  });

  it("the fallback (model failed) always asks the user", async () => {
    const { fallbackEnrichment } = await import("../src/enrichment/auto-organizer");
    expect(fallbackEnrichment(input, ctx).placementConfidence).toBe(0);
  });
});
