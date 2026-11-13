import { describe, expect, it } from "vitest";
import { TOPIC_IDS } from "@kortex/theme-packs";
import { routeInfo } from "@/lib/shell/routes";
import { isTauri } from "@/lib/shell/window-controls";
import { backdropTopic, FRAME_BACKDROP_TOPIC } from "./backdrop";

describe("frame backdrop topic (W3: stable across routes)", () => {
  it("is the same motif on every route", () => {
    expect(backdropTopic()).toBe(FRAME_BACKDROP_TOPIC);
    expect(FRAME_BACKDROP_TOPIC).toBe("home");
  });
  it("names a topic the packs have", () => {
    expect(TOPIC_IDS).toContain(backdropTopic());
  });
});

describe("routes: hashtags is its own view (the sidebar marks it, not Home)", () => {
  it("/hashtags", () => {
    expect(routeInfo("/hashtags")).toMatchObject({ view: "hashtags", tabKey: "hashtags", tabLabel: "Hashtags", tabIcon: "hash", doc: false });
  });
});

describe("routes: the new-note editor is a document tab", () => {
  it("/notes/new", () => {
    const r = routeInfo("/notes/new");
    expect(r).toMatchObject({ view: "notes", tabKey: "note:new", tabLabel: "Ohne Titel", doc: true });
  });
});

describe("window controls only in the desktop app", () => {
  it("detects Tauri v1 and v2 globals", () => {
    expect(isTauri({})).toBe(false);
    expect(isTauri(undefined)).toBe(false);
    expect(isTauri({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(isTauri({ __TAURI__: {} })).toBe(true);
  });
});
