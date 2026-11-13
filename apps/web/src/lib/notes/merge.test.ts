import { describe, expect, it } from "vitest";
import type { KnowledgeItem } from "@/lib/mock/types";
import { mergeSnapshotItems } from "./merge";

const item = (id: string, over: Partial<KnowledgeItem> = {}): KnowledgeItem => ({
  id,
  type: "note",
  title: id,
  path: `10_Notes/${id}.md`,
  date: "2026-10-24",
  time: "10:00",
  tags: [],
  tldr: "",
  links: [],
  contentMd: "",
  cover: null,
  actionItems: [],
  metadata: {},
  manualPlacement: false,
  folderSuggestion: null,
  updatedAt: "2026-10-24T10:00:00Z",
  ...over,
});

describe("mergeSnapshotItems", () => {
  it("adds items captured after the first load (they used to open empty)", () => {
    const local = { a: item("a") };
    const next = mergeSnapshotItems(local, [item("a"), item("b", { contentMd: "Neu erfasst" })]);
    expect(next?.b?.contentMd).toBe("Neu erfasst");
    expect(next?.a).toBe(local.a);
  });

  it("takes newer server copies, keeps unsaved local edits", () => {
    const local = { a: item("a", { contentMd: "lokal" }), b: item("b", { contentMd: "lokal" }) };
    const incoming = [
      item("a", { contentMd: "server", updatedAt: "2026-10-24T11:00:00Z" }),
      item("b", { contentMd: "server", updatedAt: "2026-10-24T11:00:00Z" }),
    ];
    const next = mergeSnapshotItems(local, incoming, new Set(["b"]));
    expect(next?.a?.contentMd).toBe("server");
    expect(next?.b?.contentMd).toBe("lokal");
  });

  it("returns null when nothing changed (same or older server copies)", () => {
    const local = { a: item("a", { updatedAt: "2026-10-24T12:00:00Z" }) };
    expect(mergeSnapshotItems(local, [item("a", { updatedAt: "2026-10-24T11:00:00Z" })])).toBeNull();
    expect(mergeSnapshotItems(local, [])).toBeNull();
  });
});
