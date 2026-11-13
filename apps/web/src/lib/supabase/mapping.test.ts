import { describe, expect, it } from "vitest";
import { OBJECT_HUBS } from "@/lib/mock/workspace";
import {
  buildVaultTree,
  countHubs,
  dbTypeFor,
  localDateTime,
  tagLabel,
  tagName,
  toInboxJob,
  toKnowledgeItem,
  toProfile,
  uiType,
  wikiLinkTitles,
  type ItemRow,
} from "./mapping";

const row = (over: Partial<ItemRow>): ItemRow =>
  ({
    id: "a",
    user_id: "u",
    type: "note",
    title: "Alpha",
    slug: "alpha",
    summary: null,
    content_md: "",
    source_url: null,
    file_storage_path: null,
    cover_image_url: null,
    folder_path: "10_Notes",
    is_manual_placement: false,
    tags: [],
    related_item_ids: [],
    metadata: {},
    status: "processed",
    created_at: "2026-10-22T21:30:00Z",
    updated_at: "2026-10-22T21:30:00Z",
    ...over,
  }) as ItemRow;

describe("type mapping", () => {
  it("maps DB types onto the shell's content types and back", () => {
    expect(uiType("ai_chat")).toBe("ai");
    expect(uiType("epub")).toBe("book");
    expect(uiType("daily_note")).toBe("note");
    expect(uiType("person")).toBe("person");
    expect(dbTypeFor("book")).toBe("pdf");
    expect(dbTypeFor("book", "epub")).toBe("epub");
    expect(dbTypeFor("note", "daily_note")).toBe("daily_note");
    expect(dbTypeFor("ai", "note")).toBe("ai_chat");
    expect(dbTypeFor("goal")).toBe("goal");
  });
});

describe("tags", () => {
  it("adds and strips the leading #", () => {
    expect(tagLabel("ai/mcp")).toBe("#ai/mcp");
    expect(tagLabel("#ai/mcp")).toBe("#ai/mcp");
    expect(tagName("#ai/mcp")).toBe("ai/mcp");
  });
});

describe("toKnowledgeItem", () => {
  it("builds path, local date, tags, links from related ids and [[wiki-links]]", () => {
    const ctx = {
      timeZone: "Europe/Berlin",
      idByTitle: new Map([
        ["beta", "b"],
        ["alpha", "a"],
      ]),
      ids: new Set(["a", "b", "c"]),
      actionsBySource: new Map([["a", [{ id: "t1", text: "Do it", done: false }]]]),
    };
    const item = toKnowledgeItem(
      row({
        content_md: "Siehe [[Beta|die Beta]] und [[Unbekannt]].",
        tags: ["ai/mcp"],
        related_item_ids: ["c", "x"],
      }),
      ctx,
    );
    expect(item.path).toBe("10_Notes/alpha.md");
    expect(item.date).toBe("2026-10-22");
    expect(item.time).toBe("23:30");
    expect(item.tags).toEqual(["#ai/mcp"]);
    expect(item.links).toEqual(["c", "b"]);
    expect(item.actionItems).toHaveLength(1);
    expect(item.tldr).toContain("Siehe");
    expect(item.metadata).toEqual({});
  });

  it("keeps only domain fields as editable object metadata", () => {
    const ctx = {
      timeZone: "UTC",
      idByTitle: new Map(),
      ids: new Set<string>(),
      actionsBySource: new Map(),
    };
    const item = toKnowledgeItem(
      row({ type: "person", metadata: { role: "CTO", ingest: { x: 1 } } }),
      ctx,
    );
    expect(item.type).toBe("person");
    expect(item.metadata).toEqual({ role: "CTO" });
  });
});

describe("wikiLinkTitles", () => {
  it("handles embeds, aliases and heading anchors", () => {
    expect(wikiLinkTitles("![[A]] [[B|x]] [[C#Teil]]")).toEqual(["A", "B", "C"]);
  });
});

describe("buildVaultTree", () => {
  it("orders depth-first by sort_order and marks parents", () => {
    const tree = buildVaultTree([
      { id: "2", parent_id: null, name: "20_Meetings", folder_path: "20_Meetings", sort_order: 20 },
      { id: "1", parent_id: null, name: "10_Notes", folder_path: "10_Notes", sort_order: 10 },
      { id: "1d", parent_id: "1", name: "Daily", folder_path: "10_Notes/Daily", sort_order: 0 },
    ]);
    expect(tree.map((f) => f.id)).toEqual(["1", "1d", "2"]);
    expect(tree[0]).toMatchObject({ depth: 0, hasChildren: true });
    expect(tree[1]).toMatchObject({ depth: 1, parent: "1" });
  });
});

describe("counts, inbox, profile", () => {
  it("counts hubs over objects", () => {
    expect(countHubs(OBJECT_HUBS, ["person", "note"]).find((h) => h.type === "person")?.count).toBe(
      1,
    );
  });

  it("maps pipeline status to inbox jobs", () => {
    expect(toInboxJob({ title: "X", type: "article", status: "processing" })).toMatchObject({
      icon: "i-article",
      pct: 60,
    });
    // A meeting handed over by the Windows app sits here until it is processed: it keeps its id, so it opens and deletes.
    expect(
      toInboxJob({ id: "m1", title: "Sync", type: "meeting", status: "processing" }),
    ).toMatchObject({ itemId: "m1", icon: "i-meeting" });
  });

  it("derives a display name", () => {
    expect(toProfile({ email: "max@example.com", user_metadata: {} }, "founder")).toEqual({
      name: "Max",
      initial: "M",
      plan: "Kortex Founder",
    });
  });

  it("formats local time", () => {
    expect(localDateTime("2026-01-01T00:30:00Z", "Europe/Berlin")).toEqual({
      date: "2026-01-01",
      time: "01:30",
    });
  });
});
