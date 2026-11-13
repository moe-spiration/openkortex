import { describe, expect, it, vi } from "vitest";
import { createPdfDocumentAdapter } from "../src/adapters/pdf-document.adapter";
import { createWebArticleAdapter, JINA_READER_URL } from "../src/adapters/web-article.adapter";
import {
  describeEmbeddedImages,
  encodePng,
  maxEmbeddedImages,
  type ImageCandidate,
} from "../src/media/embedded-images";
import { createMemoryStorageGateway } from "../src/storage";
import { makePdf } from "./fixtures/make-pdf";
import { failingModel, fakeFetch, ITEM_ID, json, mockModel, staticRouter, USER_ID } from "./helpers";
import { inflateSync } from "node:zlib";

// G5: vision for images embedded in clips and PDFs. At most N per item, failures only warn.

const vision = {
  title_hint: "Architektur",
  image_kind: "diagram",
  ocr_text: "Supabase -> md-sync",
  description_md: "Diagramm mit **Supabase** und md-sync.",
  todos: [],
};

const pdfPages = vi.hoisted(() => ({ byPage: {} as Record<number, unknown[]> }));
vi.mock("unpdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("unpdf")>()),
  extractImages: async (_pdf: unknown, page: number) => pdfPages.byPage[page] ?? [],
}));

const img = (key: string, width: number, height: number) => ({
  key,
  width,
  height,
  channels: 3 as const,
  data: new Uint8ClampedArray(width * height * 3).fill(128),
});

const candidates = (n: number, ok = true): ImageCandidate[] =>
  Array.from({ length: n }, (_, i) => ({
    label: `Bild ${i}`,
    weight: 0,
    load: async () => (ok ? { bytes: new Uint8Array(10), mimeType: "image/png" } : null),
  }));

describe("maxEmbeddedImages", () => {
  it("defaults to 5, honours the env, clamps to 0..10", () => {
    expect(maxEmbeddedImages({})).toBe(5);
    expect(maxEmbeddedImages({ KORTEX_MAX_EMBEDDED_IMAGES: "3" })).toBe(3);
    expect(maxEmbeddedImages({ KORTEX_MAX_EMBEDDED_IMAGES: "0" })).toBe(0);
    expect(maxEmbeddedImages({ KORTEX_MAX_EMBEDDED_IMAGES: "99" })).toBe(10);
    expect(maxEmbeddedImages({ KORTEX_MAX_EMBEDDED_IMAGES: "abc" })).toBe(5);
  });
});

describe("encodePng", () => {
  it("writes a valid PNG: signature, IHDR, one inflatable IDAT with filter bytes", () => {
    const png = encodePng(2, 2, 3, new Uint8Array(12).fill(7));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(2); // width
    expect(view.getUint32(20)).toBe(2); // height
    const idatLen = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe((2 * 3 + 1) * 2);
    expect(raw[0]).toBe(0);
  });
});

describe("describeEmbeddedImages", () => {
  it("describes at most N images (best first) and renders one Bilder section", async () => {
    const model = mockModel(vision);
    const list: ImageCandidate[] = [10, 500, 30, 400, 20].map((w, i) => ({
      label: `Seite ${i + 1}`,
      weight: w,
      load: async () => ({ bytes: new Uint8Array(4), mimeType: "image/png" }),
    }));
    const out = await describeEmbeddedImages(staticRouter({ vision: model }), list, 2);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(out).toMatchObject({ described: 2, skipped: 3, warnings: [] });
    expect(out.md).toContain("## Bilder");
    expect(out.md).toContain("### Bild 1 (Seite 2)");
    expect(out.md).toContain("### Bild 2 (Seite 4)");
    expect(out.md).toContain("Supabase -> md-sync");
  });

  it("max 0 or no candidates: no model call", async () => {
    const model = mockModel(vision);
    const router = staticRouter({ vision: model });
    expect((await describeEmbeddedImages(router, candidates(3), 0)).md).toBe("");
    expect((await describeEmbeddedImages(router, [], 5)).md).toBe("");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("unusable images are skipped without a warning and do not use up the cap", async () => {
    const model = mockModel(vision);
    const list = [...candidates(2, false), ...candidates(2)];
    const out = await describeEmbeddedImages(staticRouter({ vision: model }), list, 2);
    expect(out.described).toBe(2);
    expect(out.warnings).toEqual([]);
  });

  it("a failing model becomes warnings, never an error", async () => {
    const out = await describeEmbeddedImages(staticRouter({ vision: failingModel("503") }), candidates(2), 5);
    expect(out.md).toBe("");
    expect(out.warnings).toHaveLength(2);
    expect(out.warnings[0]).toContain("503");
  });

  it("stops at the first budget error (no more paid calls)", async () => {
    const out = await describeEmbeddedImages(
      staticRouter({ vision: failingModel("budget_exceeded: Tagesbudget aufgebraucht") }),
      candidates(4),
      5,
    );
    expect(out.warnings).toHaveLength(1);
  });
});

describe("pdf-document adapter: embedded images", () => {
  const pdf = makePdf({ pages: ["Seite eins mit genug Text.", "Seite zwei mit genug Text.", "Seite drei."] });
  const input = { userId: USER_ID, itemId: ITEM_ID, fileBuffer: pdf, mimeType: "application/pdf" };

  it("describes only the N largest figures; icons are ignored; text stays", async () => {
    pdfPages.byPage = {
      1: [img("i1", 40, 40), img("a", 300, 200)],
      2: [img("b", 400, 400), img("c", 100, 100), img("d", 500, 300)],
      3: [img("e", 220, 220), img("a", 300, 200)], // same key as on page 1: once
    };
    const model = mockModel(vision);
    const out = await createPdfDocumentAdapter({
      storage: createMemoryStorageGateway(),
      models: staticRouter({ vision: model }),
      maxImages: 3,
    }).extract(input);
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(out.contentMd).toContain("## Seite 1");
    expect(out.contentMd).toContain("## Bilder");
    expect(out.contentMd).toMatch(/### Bild 1 \(Seite 2\)[\s\S]*### Bild 2 \(Seite 2\)[\s\S]*### Bild 3 \(Seite 1\)/);
    expect(out.metadata).toMatchObject({ images_described: 3 });
    expect(out.structuralChunks?.at(-1)).toMatchObject({ heading: "Bilder" });
  });

  it("a failing vision model keeps the PDF intact and leaves a warning", async () => {
    pdfPages.byPage = { 1: [img("a", 300, 200)] };
    const out = await createPdfDocumentAdapter({
      storage: createMemoryStorageGateway(),
      models: staticRouter({ vision: failingModel("vision down") }),
    }).extract(input);
    expect(out.contentMd).toContain("## Seite 1");
    expect(out.contentMd).not.toContain("## Bilder");
    expect((out.metadata.warnings as string[])[0]).toContain("vision down");
  });

  it("without models nothing is scanned", async () => {
    pdfPages.byPage = { 1: [img("a", 300, 200)] };
    const out = await createPdfDocumentAdapter({ storage: createMemoryStorageGateway() }).extract(input);
    expect(out.contentMd).not.toContain("## Bilder");
    expect(out.metadata.warnings).toBeUndefined();
  });
});

describe("web-article adapter: embedded images", () => {
  const URL_ = "https://blog.example.com/architektur";
  const imgs = Array.from({ length: 8 }, (_, i) => `https://cdn.example.com/fig${i}.png`);
  const body = `${"Ein langer Absatz über Architektur. ".repeat(12)}\n\n${imgs
    .map((u, i) => `![Abbildung ${i}](${u})`)
    .join("\n\n")}\n\n![Logo](https://cdn.example.com/logo.svg)`;
  const routes = () =>
    fakeFetch([
      {
        match: (u) => u.startsWith(JINA_READER_URL),
        respond: () => json({ code: 200, data: { title: "Architektur", content: body } }),
      },
      { match: (u) => u.endsWith("fig1.png"), respond: () => new Response("nope", { status: 404 }) },
      {
        match: (u) => u.startsWith("https://cdn.example.com/"),
        respond: () =>
          new Response(new Uint8Array(20_000), { headers: { "content-type": "image/png" } }),
      },
    ]);

  it("describes at most 5 content images, skips SVG and broken downloads", async () => {
    const model = mockModel(vision);
    const fetch = routes();
    const out = await createWebArticleAdapter({
      fetch,
      jinaApiKey: "k",
      models: staticRouter({ vision: model }),
    }).extract({ userId: USER_ID, url: URL_ });
    expect(model.doGenerateCalls).toHaveLength(5);
    expect(out.contentMd).toContain("## Bilder");
    expect(out.metadata).toMatchObject({ images_described: 5 });
    expect(fetch.calls.some((c) => c.url.endsWith("logo.svg"))).toBe(false);
    expect(out.metadata.warnings).toBeUndefined();
  });

  it("a failing vision model never fails the clip: warning in metadata", async () => {
    const out = await createWebArticleAdapter({
      fetch: routes(),
      jinaApiKey: "k",
      models: staticRouter({ vision: failingModel("vision down") }),
    }).extract({ userId: USER_ID, url: URL_ });
    expect(out.contentMd).toContain("Ein langer Absatz");
    expect(out.contentMd).not.toContain("## Bilder");
    expect((out.metadata.warnings as string[]).length).toBeGreaterThan(0);
  });

  it("without models no image is fetched", async () => {
    const fetch = routes();
    await createWebArticleAdapter({ fetch, jinaApiKey: "k" }).extract({ userId: USER_ID, url: URL_ });
    expect(fetch.calls.every((c) => !c.url.startsWith("https://cdn.example.com/"))).toBe(true);
  });
});
