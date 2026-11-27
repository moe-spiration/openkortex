import { describe, expect, it } from "vitest";
import type { KnowledgeItem } from "@/lib/mock/types";
import { withLazyBody } from "./snapshot";

const item = (over: Partial<KnowledgeItem>): KnowledgeItem =>
  ({
    id: "a",
    type: "article",
    dbType: "article",
    title: "T",
    path: "30_Clippings/T.md",
    date: "2026-11-01",
    time: "10:00",
    tags: [],
    tldr: "Short.",
    links: ["b"],
    contentMd: "# T\n\nLong text.",
    cover: null,
    actionItems: [],
    metadata: {},
    manualPlacement: false,
    folderSuggestion: null,
    ...over,
  }) as KnowledgeItem;

describe("withLazyBody", () => {
  it("keeps the body of hot items", () => {
    const i = item({});
    expect(withLazyBody(i, new Set(["a"]))).toBe(i);
  });

  it("drops the body of cold items and marks them pending, keeping links and TL;DR", () => {
    const out = withLazyBody(item({}), new Set());
    expect(out.contentMd).toBe("");
    expect(out.bodyPending).toBe(true);
    expect(out.links).toEqual(["b"]);
    expect(out.tldr).toBe("Short.");
  });

  it("always keeps bodies the shell reads outside the note (daily notes, sessions, objects)", () => {
    for (const dbType of ["daily_note", "session", "person", "project"]) {
      expect(withLazyBody(item({ dbType }), new Set()).bodyPending).toBeUndefined();
    }
  });

  it("does not mark empty bodies as pending", () => {
    expect(withLazyBody(item({ contentMd: "" }), new Set()).bodyPending).toBeUndefined();
  });
});
