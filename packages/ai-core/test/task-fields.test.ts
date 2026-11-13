import { describe, expect, it } from "vitest";
import {
  normalizeActionItems,
  organize,
  type Enrichment,
  type ExistingObject,
  type OrganizerContext,
} from "../src/enrichment/auto-organizer";
import { renderMeetingMarkdown } from "../src/adapters/meeting.adapter";
import { renderOrganizerPrompt } from "../src/prompts/organizer";
import { mockModel } from "./helpers";

const objects: ExistingObject[] = [
  { id: "obj-kortex", title: "Kortex", type: "project", aliases: ["Second Brain"] },
  { id: "obj-hyrox", title: "Hyrox 2027", type: "goal" },
  { id: "obj-sven", title: "Sven", type: "person" },
];

const item = (
  over: Partial<Enrichment["action_items"][number]>,
): Enrichment["action_items"][number] => ({
  title: "Aufgabe",
  description: null,
  assignee: "Me",
  priority: "medium",
  due_date: null,
  source_timestamp_sec: null,
  ...over,
});

describe("normalizeActionItems: project, timeframe, context", () => {
  it("links a named project or goal (by title or alias, fuzzy) to its object id", () => {
    const out = normalizeActionItems(
      [
        item({ project: "kortex" }),
        item({ project: "Second-Brain" }),
        item({ project: "hyrox 2027" }),
      ],
      objects,
    );
    expect(out.map((a) => a.project_item_id)).toEqual(["obj-kortex", "obj-kortex", "obj-hyrox"]);
    expect(out[0]!.project_title).toBe("Kortex");
  });

  it("never links a person, an unknown name or no project", () => {
    const out = normalizeActionItems(
      [
        item({ project: "Sven" }),
        item({ project: "Unbekannt" }),
        item({ project: null }),
        item({}),
      ],
      objects,
    );
    expect(out.every((a) => a.project_item_id === null && a.project_title === null)).toBe(true);
  });

  it("normalizes the timeframe and trims the context", () => {
    const out = normalizeActionItems(
      [
        item({ timeframe: "this_week", context: "  Aus dem   Sync\nvom Montag " }),
        item({ timeframe: "2026-11-05" }),
        item({ timeframe: "irgendwann" }),
        item({ context: "x".repeat(400) }),
      ],
      objects,
    );
    expect(out.map((a) => a.timeframe)).toEqual(["this_week", "2026-11-05", null, null]);
    expect(out[0]!.context).toBe("Aus dem Sync vom Montag");
    expect(out[3]!.context).toHaveLength(300);
  });
});

describe("organize with rich action items", () => {
  const ctx: OrganizerContext = {
    existingTags: [],
    existingClusters: [],
    existingObjects: objects,
  };

  it("passes the new fields through the model schema and the prompt asks for them", async () => {
    const model = mockModel({
      title: "Sync",
      summary: "s",
      cluster_name: null,
      suggested_folder_path: null,
      tags: ["a", "b"],
      entities: [],
      action_items: [
        item({
          title: "Release planen",
          project: "Kortex",
          timeframe: "today",
          context: "Beim Sync besprochen",
        }),
        // Old-style answer without the new keys must still validate.
        {
          title: "Alt",
          description: null,
          assignee: "Me",
          priority: "low",
          due_date: null,
          source_timestamp_sec: null,
        },
      ],
    });
    const out = await organize(
      {
        type: "note",
        sourcePlatform: "manual",
        contentMd: "Release planen",
        isManualPlacement: false,
      },
      ctx,
      { model },
    );
    expect(out.actionItems[0]).toMatchObject({
      project_item_id: "obj-kortex",
      timeframe: "today",
      context: "Beim Sync besprochen",
    });
    expect(out.actionItems[1]).toMatchObject({
      project_item_id: null,
      timeframe: null,
      context: null,
    });
    const system = JSON.stringify(
      model.doGenerateCalls[0]?.prompt.filter((m) => m.role === "system"),
    );
    expect(system).toContain("timeframe");
    expect(system).toContain("project");
  });

  it("keeps the instruction not to invent projects", () => {
    expect(
      renderOrganizerPrompt({
        existingClusters: [],
        existingTags: [],
        existingObjects: [],
        manualPlacement: false,
      }),
    ).toContain("never invent a project");
  });
});

describe("meeting markdown parity", () => {
  it("writes timeframe and context of an action item into its checklist line", () => {
    const md = renderMeetingMarkdown(
      { segments: [], speakers: [], durationSec: 0 } as never,
      { title: "T", executive_summary: "s", topics: [], decisions: [], risks: [], action_items: [] },
      [
        {
          title: "Folien senden",
          description: null,
          assignee: "Max",
          priority: "high",
          due_date: "2026-11-05",
          source_timestamp_sec: 72,
          timeframe: "this_week",
          context: "Beim Sync besprochen",
        },
      ],
      { title: "Sync", date: "2026-11-01" },
    );
    expect(md).toContain(
      "- [ ] @Max: Folien senden (Due: 2026-11-05) · [00:01:12] · Zeitrahmen: diese Woche · Kontext: Beim Sync besprochen",
    );
  });
});
