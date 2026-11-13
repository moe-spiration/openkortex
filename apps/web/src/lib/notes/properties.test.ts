import { describe, expect, it } from "vitest";
import type { KnowledgeItem } from "@/lib/workspace-data";
import {
  durationOf,
  hasFirstParagraph,
  linkedObjects,
  moreProps,
  placementHint,
  sourceLine,
  statusPill,
  suggestTags,
  takeawaysOf,
  taskProgress,
} from "./properties";

const base = (over: Partial<KnowledgeItem> = {}): KnowledgeItem => ({
  id: "n1",
  type: "article",
  title: "Local-First",
  path: "30_Clippings/Tech/local-first.md",
  date: "2026-10-29",
  time: "09:12",
  tags: ["#kortex"],
  tldr: "",
  links: [],
  contentMd: "",
  cover: null,
  actionItems: [],
  metadata: {},
  manualPlacement: false,
  folderSuggestion: null,
  ...over,
});

describe("Smart Property Header: visibility and values", () => {
  it("puts Ordner and Objekte behind 'weitere', Aufgaben only when there are tasks", () => {
    expect(moreProps(base())).toEqual({ count: 2, names: ["Ordner", "Objekte"], label: "2 weitere: Ordner, Objekte" });
    const withTasks = base({ actionItems: [{ id: "a", text: "x", done: true }, { id: "b", text: "y", done: false }] });
    expect(moreProps(withTasks).label).toBe("3 weitere: Ordner, Objekte, Aufgaben");
    expect(taskProgress(withTasks)).toEqual({ done: 1, total: 2 });
    expect(taskProgress(base())).toBeNull();
  });

  it("shows the source domain with link, else file format or vault folder", () => {
    expect(sourceLine(base({ source: { url: "https://www.inkandswitch.com/local-first/" }, metadata: { reading_minutes: 14 } }))).toEqual({
      label: "inkandswitch.com",
      href: "https://www.inkandswitch.com/local-first/",
      extra: "14 Min.",
    });
    expect(sourceLine(base({ source: { url: null, file: { path: "a.pdf", mime: null, format: "pdf", sizeBytes: 1 }, pageCount: 530 } })).label).toBe("PDF · 530 Seiten");
    expect(sourceLine(base({ path: "10_Notes/idee.md" }))).toEqual({ label: "10_Notes", href: null, extra: null });
    // javascript: and other schemes never become links
    expect(sourceLine(base({ source: { url: "javascript:alert(1)" } })).href).toBeNull();
  });

  it("formats durations", () => {
    expect(durationOf({ duration_sec: 2530 })).toBe("42:10");
    expect(durationOf({ duration_sec: 4324 })).toBe("1:12:04");
    expect(durationOf({ duration: "47 Min." })).toBe("47 Min.");
    expect(durationOf({})).toBeNull();
  });

  it("maps the pipeline status to a pill", () => {
    expect(statusPill(base({ status: "inbox" }))).toEqual({ tone: "new", label: "Neu" });
    expect(statusPill(base({ status: "processing" }))?.tone).toBe("run");
    expect(statusPill(base())).toBeNull();
  });

  it("lists linked domain objects only", () => {
    const all = {
      p1: base({ id: "p1", type: "person", title: "Sven" }),
      n2: base({ id: "n2", type: "note", title: "Andere Notiz" }),
    };
    expect(linkedObjects(base({ links: ["n2", "p1", "missing"] }), all).map((o) => o.id)).toEqual(["p1"]);
  });

  it("says whether the folder was set by hand", () => {
    expect(placementHint({ manualPlacement: true })).toBe("manuell");
    expect(placementHint({ manualPlacement: false })).toBe("automatisch");
  });

  it("reads Key Takeaways from metadata", () => {
    expect(takeawaysOf({ metadata: { key_takeaways: ["Eins", " ", 3, "Zwei "] } })).toEqual(["Eins", "Zwei"]);
    expect(takeawaysOf({ metadata: { takeaways: ["A"] } })).toEqual(["A"]);
    expect(takeawaysOf({ metadata: {} })).toEqual([]);
  });

  it("suggests known tags that occur in the text and are not set yet", () => {
    const known = ["#kortex", "#ai/mcp", "#fitness/hyrox", "#real-estate", "#Kortex"];
    expect(suggestTags("Der MCP-Server für Kortex", known, ["#kortex"])).toEqual(["#ai/mcp"]);
    expect(suggestTags("Hyrox Training und Real Estate", known)).toEqual(["#real-estate", "#fitness/hyrox"]);
    expect(suggestTags("", known)).toEqual([]);
  });

  it("detects the first written paragraph", () => {
    expect(hasFirstParagraph("Kurz")).toBe(false);
    expect(hasFirstParagraph("Teilnehmende:\nAgenda:\n- ")).toBe(false);
    expect(hasFirstParagraph("Heute habe ich über den Sync-Daemon nachgedacht.")).toBe(true);
  });
});
