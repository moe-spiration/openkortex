import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../src/adapters";
import {
  linkTasksToProjects,
  normalizeActionItems,
  type Enrichment,
  type ExistingObject,
} from "../src/enrichment/auto-organizer";
import { ingest, type IngestContext, type IngestDeps } from "../src/pipeline/ingest";
import { createMemoryStorageGateway } from "../src/storage";
import { ITEM_ID, mockEmbeddingModel, mockModel, staticRouter, USER_ID } from "./helpers";

// G9: priority and project/goal link of extracted tasks, down to the rows that land in
// kortex.action_items (priority, project_item_id).

const KORTEX = "44444444-4444-4444-8444-000000000001";
const HYROX = "44444444-4444-4444-8444-000000000002";
const objects: ExistingObject[] = [
  { id: KORTEX, title: "Kortex", type: "project", aliases: ["Second Brain"] },
  { id: HYROX, title: "Hyrox 2027", type: "goal" },
  { id: "44444444-4444-4444-8444-000000000003", title: "Sven", type: "person" },
];

const task = (over: Partial<Enrichment["action_items"][number]>): Enrichment["action_items"][number] => ({
  title: "Aufgabe",
  description: null,
  assignee: "Me",
  priority: "medium",
  due_date: null,
  source_timestamp_sec: null,
  ...over,
});

describe("normalizeActionItems: priority", () => {
  it("keeps low / medium / high / urgent and falls back to medium for anything else", () => {
    const out = normalizeActionItems(
      [
        task({ priority: "low" }),
        task({ priority: "high" }),
        task({ priority: "urgent" }),
        task({ priority: "kritisch" as never }),
      ],
      objects,
    );
    expect(out.map((a) => a.priority)).toEqual(["low", "high", "urgent", "medium"]);
  });
});

describe("linkTasksToProjects (adapter tasks without a model-named project)", () => {
  type T = {
    title: string;
    description: string | null;
    context?: string | null;
    project_item_id?: string | null;
    project_title?: string | null;
  };
  const base = { description: null, context: null } satisfies Partial<T>;
  it("links when exactly one project or goal is named (title or alias, whole words)", () => {
    const out = linkTasksToProjects<T>(
      [
        { ...base, title: "Release für Kortex planen" },
        { ...base, title: "Training", description: "Plan für Hyrox 2027 anpassen" },
        { ...base, title: "Notiz", context: "kommt aus dem Second Brain Sync" },
      ],
      objects,
    );
    expect(out.map((a) => a.project_item_id)).toEqual([KORTEX, HYROX, KORTEX]);
    expect(out[0]!.project_title).toBe("Kortex");
  });

  it("does not guess: ambiguous, partial-word, person or already linked stay as they are", () => {
    const out = linkTasksToProjects<T>(
      [
        { ...base, title: "Kortex und Hyrox 2027 abgleichen" }, // two hits
        { ...base, title: "Kortexion bauen" }, // not a whole word
        { ...base, title: "Sven anrufen" }, // person
        { ...base, title: "Kortex", project_item_id: HYROX }, // already linked
      ],
      objects,
    );
    expect(out.map((a) => a.project_item_id ?? null)).toEqual([null, null, null, HYROX]);
  });
});

describe("pipeline: priority and project reach the action_items rows", () => {
  const context: IngestContext = {
    existingTags: [],
    existingClusters: [],
    existingObjects: objects,
  };
  const enrichment: Enrichment = {
    title: "Planung",
    summary: "Planung für das Release.",
    cluster_name: null,
    suggested_folder_path: null,
    tags: ["planung/release", "kortex"],
    entities: [],
    action_items: [
      task({ title: "Release-Notes schreiben", priority: "urgent", project: "Kortex", timeframe: "today" }),
      task({ title: "Intervalle laufen", priority: "low", project: "hyrox 2027" }),
      task({ title: "Sven anrufen", priority: "high", project: "Sven" }),
    ],
  };

  it("urgent + project, low + goal, person never linked", async () => {
    const models = staticRouter({ fast: mockModel(enrichment), embedding: mockEmbeddingModel() });
    const deps: IngestDeps = {
      registry: createDefaultRegistry({ storage: createMemoryStorageGateway(), models }),
      models,
      generateId: () => ITEM_ID,
      now: () => new Date("2026-11-01T08:00:00Z"),
    };
    const res = await ingest({ userId: USER_ID, rawText: "Release planen, Intervalle laufen" }, context, deps);
    expect(res.actionItems.map((a) => [a.title, a.priority, a.project_item_id])).toEqual([
      ["Release-Notes schreiben", "urgent", KORTEX],
      ["Intervalle laufen", "low", HYROX],
      ["Sven anrufen", "high", null],
    ]);
    expect(res.actionItems[0]).toMatchObject({ source_item_id: ITEM_ID, user_id: USER_ID, timeframe: "today" });
  });
});
