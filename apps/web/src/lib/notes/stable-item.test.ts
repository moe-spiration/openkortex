import { describe, expect, it } from "vitest";
import type { KnowledgeItem } from "@/lib/mock/types";
import { groupBacklinks, sameBacklinkGroups } from "./backlinks";
import { sameExceptText } from "./stable-item";
import { buildWikiTargets, sameLinkTargets } from "./wiki-targets";

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

/** What the notes store does on a keystroke: new text, links re-derived into a new array with the same ids. */
const keystroke = (i: KnowledgeItem, md: string): KnowledgeItem => ({ ...i, contentMd: md, links: [...i.links] });

describe("note sheet render stability (fx2-perf)", () => {
  it("sameExceptText: a keystroke keeps the header item, any other change does not", () => {
    const a = item("a", { links: ["b"], tags: ["#x"] });
    expect(sameExceptText(a, keystroke(a, "Hallo"))).toBe(true);
    expect(sameExceptText(a, { ...keystroke(a, "Hallo"), links: ["b", "c"] })).toBe(false);
    expect(sameExceptText(a, { ...a, title: "Neu" })).toBe(false);
    expect(sameExceptText(a, { ...a, tags: ["#y"] })).toBe(false);
    expect(sameExceptText(a, { ...a, metadata: { status: "done" } })).toBe(false);
    expect(sameExceptText(a, item("b"))).toBe(false);
  });

  it("sameLinkTargets: typing in the open note keeps the [[ list; a new title, path or item rebuilds it", () => {
    const items = { a: item("a"), b: item("b"), c: item("c") };
    expect(sameLinkTargets(items, { ...items, a: keystroke(items.a, "neu") }, "a")).toBe(true);
    // The open note's own title is not a target.
    expect(sameLinkTargets(items, { ...items, a: { ...items.a, title: "A2" } }, "a")).toBe(true);
    expect(sameLinkTargets(items, { ...items, b: { ...items.b, contentMd: "x" } }, "a")).toBe(true);
    expect(sameLinkTargets(items, { ...items, b: { ...items.b, title: "B2" } }, "a")).toBe(false);
    expect(sameLinkTargets(items, { ...items, b: { ...items.b, path: "20_Meetings/b.md" } }, "a")).toBe(false);
    expect(sameLinkTargets(items, { ...items, d: item("d") }, "a")).toBe(false);
    expect(sameLinkTargets(items, { a: items.a, b: items.b }, "a")).toBe(false);
    expect(buildWikiTargets(items, "a")).toEqual([
      { id: "b", title: "b", path: "10_Notes/b.md" },
      { id: "c", title: "c", path: "10_Notes/c.md" },
    ]);
  });

  it("sameBacklinkGroups: typing in the note keeps the footer, a change in a linked item does not", () => {
    const m = item("m", { type: "meeting", links: ["a"], actionItems: [{ id: "t1", text: "Anrufen", done: false } as KnowledgeItem["actionItems"][number]] });
    const items = { a: item("a"), m };
    const before = groupBacklinks(items.a, items);
    const typed = { ...items, a: keystroke(items.a, "neu") };
    expect(sameBacklinkGroups(before, groupBacklinks(typed.a, typed))).toBe(true);
    const done = { ...items, m: { ...m, actionItems: [{ ...m.actionItems[0]!, done: true }] } };
    expect(sameBacklinkGroups(before, groupBacklinks(done.a, done))).toBe(false);
  });
});
