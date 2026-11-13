import { describe, expect, it, vi } from "vitest";
import { createDefaultRegistry } from "../src/adapters";
import {
  createSocialShortAdapter,
  detectSocialPlatform,
  pickKeyframes,
  type SocialMediaBundle,
  type SocialMediaDownloader,
} from "../src/adapters/social-short.adapter";
import { JINA_READER_URL } from "../src/adapters/web-article.adapter";
import type { AudioTranscriber } from "../src/audio/transcriber";
import { ExtractionError } from "../src/errors";
import { ingest } from "../src/pipeline/ingest";
import { createMemoryStorageGateway } from "../src/storage";
import { PNG_1PX } from "./fixtures/make-epub";
import {
  fakeFetch,
  ITEM_ID,
  json,
  mockEmbeddingModel,
  mockModel,
  staticRouter,
  USER_ID,
} from "./helpers";

const REEL = "https://www.instagram.com/reel/C9xYz123AbC/";

const bundle = (over: Partial<SocialMediaBundle> = {}): SocialMediaBundle => ({
  platform: "instagram",
  url: REEL,
  caption: "Keto-Pancakes in 5 Minuten 🥞 #lowcarb",
  author: "lowcarblisa",
  durationSec: 45,
  thumbnailUrl: "https://cdn.example/thumb.jpg",
  audio: { data: new Uint8Array([1, 2]), mimeType: "audio/mp4", fileName: "reel.m4a" },
  keyframes: [0, 9, 18, 27, 36, 44].map((t) => ({
    timeSec: t,
    image: PNG_1PX,
    mimeType: "image/png",
  })),
  ...over,
});

const ocr = {
  overlays: [
    { frame: 1, text: "2 Eier + 50 g Frischkäse" },
    { frame: 3, text: "3 Min. pro Seite" },
    { frame: 4, text: " " },
  ],
  visual_summary: "Pancakes werden in einer Pfanne gebraten.",
};

const note = {
  title: "Keto-Pancakes in 5 Minuten",
  kind: "recipe",
  summary: "Pancakes aus Eiern und Frischkäse, low carb.",
  steps: ["Eier und Frischkäse mixen", "3 Minuten pro Seite braten"],
  ingredients: ["2 Eier", "50 g Frischkäse"],
  key_points: ["Unter 2 g Kohlenhydrate"],
  tools_mentioned: ["Thermomix"],
};

const transcriber = (): AudioTranscriber => ({
  id: "groq-whisper",
  transcribe: vi.fn(async () => [
    { startSec: 0, text: "Heute machen wir Keto-Pancakes." },
    { startSec: 12.4, text: "Einfach Eier und Frischkäse mixen." },
  ]),
});

describe("social-short helpers", () => {
  it.each([
    ["https://www.instagram.com/reel/C9xYz123AbC/", "instagram"],
    ["https://instagram.com/p/C9xYz123AbC/?igsh=1", "instagram"],
    ["https://www.tiktok.com/@chef/video/7351234567890123456", "tiktok"],
    ["https://vm.tiktok.com/ZMabc123/", "tiktok"],
    ["https://www.instagram.com/lowcarblisa/", undefined],
    ["https://www.youtube.com/shorts/abcDEF12345", undefined],
  ])("%s → %s", (url, platform) => expect(detectSocialPlatform(url)).toBe(platform));

  it("thins keyframes out evenly to 4", () => {
    expect(pickKeyframes([0, 1, 2, 3, 4, 5, 6])).toEqual([0, 2, 4, 6]);
    expect(pickKeyframes([0, 1])).toEqual([0, 1]);
  });
});

describe("social-short adapter", () => {
  it("combines transcript, 4-keyframe OCR and caption into a structured note", async () => {
    const downloader: SocialMediaDownloader = { fetch: vi.fn(async () => bundle()) };
    const vision = mockModel(ocr);
    const fast = mockModel(note);
    const storage = createMemoryStorageGateway();
    const t = transcriber();
    const adapter = createSocialShortAdapter({
      downloader,
      transcriber: t,
      models: staticRouter({ vision, fast }),
      storage,
    });
    const input = { userId: USER_ID, itemId: ITEM_ID, url: REEL };
    expect(adapter.canHandle(input)).toBe(true);

    const out = await adapter.extract(input);
    expect(downloader.fetch).toHaveBeenCalledWith(REEL, "instagram");
    expect(t.transcribe).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "audio/mp4" }));

    // Exactly 4 frames went to the vision model.
    const parts = vision.doGenerateCalls[0]?.prompt.find((m) => m.role === "user")
      ?.content as Array<{ type: string }>;
    expect(parts.filter((p) => p.type === "file")).toHaveLength(4);
    // The synthesis saw all three sources.
    const synth = JSON.stringify(fast.doGenerateCalls[0]?.prompt);
    for (const s of [
      "Keto-Pancakes in 5 Minuten",
      "Einfach Eier und Frischkäse mixen",
      "2 Eier + 50 g Frischkäse",
      "@lowcarblisa",
    ]) {
      expect(synth).toContain(s);
    }

    expect(out.type).toBe("recipe"); // kind "recipe" lands with the recipes
    expect(out.sourcePlatform).toBe("instagram");
    expect(out.titleHint).toBe("Keto-Pancakes in 5 Minuten");
    const md = out.contentMd;
    expect(md).toMatch(
      /^# Keto-Pancakes in 5 Minuten\n\n> Instagram Reel · @lowcarblisa · 00:45 · \[Original\]\(https:\/\/www\.instagram\.com\/reel\/C9xYz123AbC\/\)/,
    );
    expect(md).toContain("**TL;DR:** Pancakes aus Eiern und Frischkäse, low carb.");
    expect(md).toContain("## Zutaten\n\n- [ ] 2 Eier\n- [ ] 50 g Frischkäse");
    expect(md).toContain(
      "## Schritte\n\n1. Eier und Frischkäse mixen\n2. 3 Minuten pro Seite braten",
    );
    // Frames 0, 18, 27, 44 were picked; overlay frame 3 → 27 s.
    expect(md).toContain(
      "## Text-Overlays\n\n- [00:00:00] 2 Eier + 50 g Frischkäse\n- [00:00:27] 3 Min. pro Seite",
    );
    expect(md).toContain(
      "> [!toggle]- Transkript\n>\n> [00:00:00] Heute machen wir Keto-Pancakes.\n>\n> [00:00:12] Einfach Eier",
    );
    expect(md).toContain("## Caption\n\nKeto-Pancakes in 5 Minuten 🥞 #lowcarb");

    expect([...storage.files.keys()]).toEqual([`kortex-media/${USER_ID}/${ITEM_ID}.png`]);
    expect(out.metadata).toMatchObject({
      platform: "instagram",
      author: "@lowcarblisa",
      kind: "recipe",
      keyframes_analyzed: 4,
      overlay_count: 2,
      transcript_source: "groq-whisper",
      tools_mentioned: ["Thermomix"],
      cover_storage_path: `${USER_ID}/${ITEM_ID}.png`,
    });
  });

  it("works with partial media and records what was missing", async () => {
    const downloader: SocialMediaDownloader = {
      fetch: async () =>
        bundle({
          platform: "tiktok",
          url: "https://www.tiktok.com/@chef/video/1",
          audio: undefined,
          keyframes: [],
        }),
    };
    const out = await createSocialShortAdapter({
      downloader,
      models: staticRouter({ fast: mockModel({ ...note, kind: "tips" }) }),
    }).extract({
      userId: USER_ID,
      url: "https://www.tiktok.com/@chef/video/7351234567890123456",
    });
    expect(out.type).toBe("social");
    expect(out.contentMd).not.toContain("Transkript");
    expect(out.metadata).toMatchObject({ keyframes_analyzed: 0, transcript_source: "none" });
  });

  it("fails clearly when there is nothing to read", async () => {
    const downloader: SocialMediaDownloader = {
      fetch: async () => bundle({ caption: "", audio: undefined, keyframes: [] }),
    };
    await expect(
      createSocialShortAdapter({ downloader }).extract({ userId: USER_ID, url: REEL }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it("post unreadable for the server: ingest() falls back to clipping the page", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u.startsWith(JINA_READER_URL),
        respond: () =>
          json({
            data: { title: "Reel", content: `# Reel\n\n${"Caption-Text vom Reel. ".repeat(20)}` },
          }),
      },
    ]);
    const organizer = {
      title: "Reel",
      summary: "",
      cluster_name: null,
      suggested_folder_path: null,
      tags: [],
      entities: [],
      action_items: [],
    };
    const models = staticRouter({ fast: mockModel(organizer), embedding: mockEmbeddingModel() });
    const registry = createDefaultRegistry({
      storage: createMemoryStorageGateway(),
      models,
      fetch,
      jinaApiKey: "jina_test",
    });
    const res = await ingest(
      { userId: USER_ID, url: REEL },
      { existingTags: [], existingClusters: [], existingObjects: [] },
      { registry, models },
    );
    expect(res.adapterId).toBe("web-article");
    expect(res.skippedAdapters).toEqual([
      { id: "social-short", reason: expect.stringContaining("declined") },
    ]);
  });
});
