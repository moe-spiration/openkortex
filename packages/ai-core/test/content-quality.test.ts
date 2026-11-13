import { describe, expect, it } from "vitest";
import { renderOrganizerPrompt } from "../src/prompts/organizer";
import { isYouTubeClipUrl, parseYouTubeVideoId, resolveClipVideoId } from "../src/adapters/youtube.adapter";
import { renderMeetingMarkdown } from "../src/adapters/meeting.adapter";
import { renderMediaNote } from "../src/media/notes";
import { transcriptToggleLines } from "../src/util/transcript-toggle";
import { resolveItemType } from "../src/typed/resolve-type";

const base = { payloadType: "article", suggestedType: null, tags: [] as string[] };

describe("resolveItemType", () => {
  it("amazon /dp with an ISBN is a book even when the organizer was unsure", () => {
    expect(
      resolveItemType({ ...base, url: "https://www.amazon.de/Atomic-Habits/dp/0735211299", tags: ["buch"] }),
    ).toMatchObject({ extractAs: "book", reason: "url:amazon-isbn" });
  });
  it("imdb → movie, goodreads → book", () => {
    expect(resolveItemType({ ...base, url: "https://www.imdb.com/title/tt0133093/" }).extractAs).toBe("movie");
    expect(resolveItemType({ ...base, url: "https://www.goodreads.com/book/show/1" }).extractAs).toBe("book");
  });
  it("a youtube clip page that no adapter took becomes a video (no extraction)", () => {
    expect(resolveItemType({ ...base, url: "https://www.youtube.com/clip/UgkxAbCdEfGh" })).toMatchObject({
      extractAs: null,
      directType: "video",
    });
  });
  it("falls back from the tags (Buch → book) when no rule and no suggestion apply", () => {
    expect(resolveItemType({ ...base, url: "https://blog.example.com/x", tags: ["buch", "lernen"] })).toMatchObject({
      extractAs: "book",
      reason: "tag",
    });
  });
  it("the organizer's suggestion beats the tag fallback", () => {
    expect(resolveItemType({ ...base, suggestedType: "movie", tags: ["buch"] })).toMatchObject({
      extractAs: "movie",
      reason: "organizer",
    });
  });
  it("a client hint wins; conflicting tags do nothing; other types are never touched", () => {
    expect(resolveItemType({ ...base, url: "https://www.imdb.com/title/tt1/", typeHint: "book" }).extractAs).toBe("book");
    expect(resolveItemType({ ...base, tags: ["buch", "film"] })).toMatchObject({ extractAs: null, directType: null });
    expect(resolveItemType({ ...base, payloadType: "video", tags: ["buch"] }).extractAs).toBeNull();
  });
});

describe("organizer prompt", () => {
  it("carries the registry types and the type_confidence field", () => {
    const p = renderOrganizerPrompt({ existingClusters: [], existingTags: [], existingObjects: [], manualPlacement: false });
    expect(p).toContain('"book" (');
    expect(p).toContain("type_confidence");
    expect(p).not.toContain("{{TYPE_GUIDE}}");
  });
});

describe("youtube clip links", () => {
  it("are recognised and resolved to the video id from the clip page", async () => {
    const url = "https://www.youtube.com/clip/UgkxAbCdEfGh";
    expect(parseYouTubeVideoId(url)).toBeUndefined();
    expect(isYouTubeClipUrl(url)).toBe(true);
    expect(isYouTubeClipUrl("https://www.youtube.com/watch?v=abcDEF12345")).toBe(false);
    const fetchFn = async () => new Response('{"clip":{"videoId":"abcDEF12345"}}');
    expect(await resolveClipVideoId(url, fetchFn)).toBe("abcDEF12345");
    expect(await resolveClipVideoId(url, async () => new Response("", { status: 404 }))).toBeUndefined();
  });
});

describe("transcript toggle", () => {
  it("quotes every line under a folded toggle title", () => {
    expect(transcriptToggleLines("eins\n\nzwei")).toEqual(["> [!toggle]- Transkript", ">", "> eins", ">", "> zwei"]);
  });
  it("is empty without text", () => {
    expect(transcriptToggleLines("  \n ")).toEqual([]);
    expect(transcriptToggleLines([])).toEqual([]);
  });
});

describe("empty sections and placeholders", () => {
  const meta = { title: "Sync", date: "2026-10-21T10:00:00Z" };
  const t = { durationSec: 60, speakers: ["Max"], segments: [{ startSec: 1, text: "Hallo", speaker: "Max" }] };
  it("meeting: no '- Keine', empty sections are omitted, transcript is the last block", () => {
    const md = renderMeetingMarkdown(
      t as never,
      { executive_summary: "Kurz.", topics: [], decisions: [], risks: [] } as never,
      [],
      meta,
    );
    expect(md).not.toMatch(/Keine/);
    expect(md).not.toContain("## Getroffene Entscheidungen");
    expect(md).not.toContain("## Extrahierte Action Items");
    expect(md).not.toContain("## Besprochene Themenblöcke");
    expect(md.trimEnd().split("\n").at(-1)).toMatch(/^> .*Hallo/);
    expect(md).toContain("> [!toggle]- Transkript");
  });
  it("media note without transcript has no placeholder sentence; the description is clipped", () => {
    const longDesc = "Link zum Shop und Rabattcode. ".repeat(100);
    const r = renderMediaNote({ title: "T", facts: [], jump: () => null, notes: null, description: longDesc, segments: [] });
    expect(r.contentMd).not.toMatch(/Kein Transkript/);
    expect(r.contentMd.length).toBeLessThan(1000);
    expect(r.contentMd).toContain("[…]");
  });
  it("media note with model notes drops the raw description", () => {
    const notes = { summary: "S", chapters: [], key_takeaways: [], learnings: [], quotes: [], resources: [] };
    const r = renderMediaNote({ title: "T", facts: [], jump: () => null, notes, description: "Beschreibung X", segments: [] });
    expect(r.contentMd).not.toContain("Beschreibung X");
  });
});
