import { describe, expect, it } from "vitest";
import { NOTES } from "@/lib/workspace-data";
import { NOTE_COVER } from "@/lib/mock/views";
import { noteEntry } from "./entries";

/*
 * Theme packs: entries carry only an own or extracted cover. The type tile of the active pack is resolved on the
 * client (useCoverOf), so there is no hash-picked stock photo any more.
 */
describe("noteEntry cover", () => {
  const base = NOTES[0]!;

  it("keeps a bundled mock cover as own cover", () => {
    const id = Object.keys(NOTE_COVER)[0]!;
    const n = NOTES.find((x) => x.id === id) ?? { ...base, id };
    expect(noteEntry(n).cover).toMatch(/^\/views\/.+\.webp$/);
  });

  it("uses the extracted medium of a live item", () => {
    const n = { ...base, id: "live-article-1", cover: "https://img.example/a.jpg" };
    expect(noteEntry(n).cover).toBe("https://img.example/a.jpg");
  });

  it("is null without any medium (the pack tile is chosen on the client)", () => {
    const n = { ...base, id: "live-note-without-cover", cover: null };
    expect(noteEntry(n).cover).toBeNull();
  });
});
