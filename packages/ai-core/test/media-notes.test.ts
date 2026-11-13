import { describe, expect, it } from "vitest";
import { createYouTubeAdapter, type YouTubeDataSource } from "../src/adapters/youtube.adapter";
import { NOTES_TRANSCRIPT_CHARS, normalizeMediaNotes, type MediaNotes } from "../src/media/notes";
import { mockModel, staticRouter, USER_ID } from "./helpers";

// Video/podcast notes: one routed `summarize` call over a (condensed) transcript, JSON validated by
// Zod, Markdown rendered in code. The model is mocked; no network, no real AI call.

const VIDEO_ID = "dQw4w9WgXcQ";

/** ~2.5 h talk: one caption line every 4 s (≈ 2250 lines, ≈ 250k chars). */
const longTranscript = () =>
  Array.from({ length: 2250 }, (_, i) => ({
    startSec: i * 4,
    text: `Abschnitt ${i}: Wir sprechen über Second Brains, MCP-Server und wie Agenten Wissen finden und nutzen.`,
  }));

const source: YouTubeDataSource = {
  getVideoInfo: async () => ({
    videoId: VIDEO_ID,
    title: "Second Brain Deep Dive",
    channel: "Kortex Talks",
    durationSec: 9000,
    description: "Ein langer Talk.",
    captionTracks: [{ baseUrl: "x", languageCode: "de" }],
  }),
  getTranscript: async () => longTranscript(),
};

const notes: MediaNotes = {
  summary: "  Ein Deep Dive in Second Brains mit MCP.  ",
  chapters: [
    { title: "Einstieg", start_sec: 0 },
    { title: "MCP in der Praxis", start_sec: 3600 },
    { title: "Fragen", start_sec: 7800 },
  ],
  key_takeaways: [
    "- Wissen wird erst nützlich, wenn Agenten es finden.",
    "MCP standardisiert den Zugriff auf Werkzeuge.",
    "MCP standardisiert den Zugriff auf Werkzeuge.",
    ...Array.from({ length: 10 }, (_, i) => `Weiterer Punkt ${i + 1}.`),
  ],
  learnings: [
    "1. Den eigenen Vault per MCP für Agenten freigeben.",
    "MCP standardisiert den Zugriff auf Werkzeuge.", // repeats a Kernpunkt: dropped
    "Notizen beim Erfassen sofort taggen.",
  ],
  quotes: [{ text: "„Ein Archiv ohne Zugriff ist tot.“", speaker: " Max ", time_sec: 3605 }],
  resources: ["Supabase", "supabase", "Obsidian"],
};

describe("media notes", () => {
  it("long YouTube transcript: one condensed summarize call, synthesis on top, transcript below", async () => {
    const fast = mockModel(notes);
    const out = await createYouTubeAdapter({
      dataSource: source,
      models: staticRouter({ fast }),
    }).extract({ userId: USER_ID, url: `https://www.youtube.com/watch?v=${VIDEO_ID}` });

    // One call over the transcript, condensed under the budget, start and end of the talk in it.
    expect(fast.doGenerateCalls).toHaveLength(1);
    const prompt = JSON.stringify(fast.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain("gleichmäßig gekürzt");
    expect(prompt).toContain("[0:00] Abschnitt 0:");
    expect(prompt).toMatch(/\[2:2\d:\d\d\] Abschnitt 22\d\d:/);
    expect(prompt.length).toBeLessThan(NOTES_TRANSCRIPT_CHARS + 8000);

    const md = out.contentMd;
    expect(md.match(/^## .+$/gm)).toEqual([
      "## Executive Summary",
      "## Kernpunkte",
      "## Learnings",
      "## Kapitel",
      "## Zitate",
      "## Erwähnte Ressourcen",
    ]);
    expect(md).toContain("\n> [!toggle]- Transkript\n>\n> ### ");
    expect(md).toContain("## Executive Summary\n\nEin Deep Dive in Second Brains mit MCP.\n\n## Kernpunkte");
    // Lists are cleaned, de-duplicated and capped in code (8 Kernpunkte).
    const kern = md.slice(md.indexOf("## Kernpunkte"), md.indexOf("## Learnings")).match(/^- .+$/gm)!;
    expect(kern).toHaveLength(8);
    expect(kern.slice(0, 2)).toEqual([
      "- Wissen wird erst nützlich, wenn Agenten es finden.",
      "- MCP standardisiert den Zugriff auf Werkzeuge.",
    ]);
    expect(md).toContain(
      "## Learnings\n\n- Den eigenen Vault per MCP für Agenten freigeben.\n- Notizen beim Erfassen sofort taggen.\n\n## Kapitel",
    );
    expect(md).toContain(
      `> „Ein Archiv ohne Zugriff ist tot.“ — Max [1:00:05](https://www.youtube.com/watch?v=${VIDEO_ID}&t=3605s)`,
    );
    expect(md).toContain("## Erwähnte Ressourcen\n\n- Supabase\n- Obsidian\n");
    // The full transcript stays, apart from the synthesis, grouped by chapter with jump links.
    expect(md).toContain(
      `> [!toggle]- Transkript\n>\n> ### [0:00](https://www.youtube.com/watch?v=${VIDEO_ID}&t=0s) Einstieg`,
    );
    expect(md).toContain("Abschnitt 2249:");
    expect(md).not.toMatch(/\n{3,}/);
    expect(out.metadata).toMatchObject({
      chapters_source: "ai",
      learnings: ["Den eigenen Vault per MCP für Agenten freigeben.", "Notizen beim Erfassen sofort taggen."],
    });
    expect(out.structuralChunks?.[0]).toMatchObject({ heading: "Executive Summary" });
    expect(out.structuralChunks?.[0]?.text).toContain("Notizen beim Erfassen sofort taggen.");
  });

  it("without a model the note is the transcript only (no empty synthesis headings)", async () => {
    const out = await createYouTubeAdapter({ dataSource: source }).extract({
      userId: USER_ID,
      url: `https://youtu.be/${VIDEO_ID}`,
    });
    expect(out.contentMd).not.toMatch(/## (Executive Summary|Kernpunkte|Learnings)/);
    expect(out.contentMd).toContain("> [!toggle]- Transkript");
  });

  it("normalizeMediaNotes is stable for already clean notes", () => {
    const clean = normalizeMediaNotes(notes);
    expect(normalizeMediaNotes(clean)).toEqual(clean);
    expect(clean.quotes).toEqual([{ text: "Ein Archiv ohne Zugriff ist tot.", speaker: "Max", time_sec: 3605 }]);
  });
});
