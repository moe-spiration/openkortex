import { describe, expect, it } from "vitest";
import { DEFAULT_DOC_BUCKET, liveReaderDoc, parseReadingState, readerFormatOf, splitStoragePath, type LiveDocItem } from "./liveDoc";
import { readerDoc } from "./mockDoc";

const UID = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

const pdfItem = (over: Partial<LiveDocItem> = {}): LiveDocItem => ({
  id: ID,
  path: "60_Documents/Buecher/ai-engineering.md",
  title: "AI Engineering",
  reader: true,
  source: {
    url: null,
    file: { path: `${UID}/${ID}.pdf`, mime: "application/pdf", format: "pdf", sizeBytes: 1234 },
    pageCount: 318,
    fileName: "AI_Engineering.pdf",
  },
  readingState: null,
  ...over,
});

describe("splitStoragePath", () => {
  it("uses the default bucket for user paths", () => {
    expect(splitStoragePath(`${UID}/a.pdf`)).toEqual({ bucket: DEFAULT_DOC_BUCKET, key: `${UID}/a.pdf` });
    expect(splitStoragePath(`/${UID}/a.pdf`)).toEqual({ bucket: DEFAULT_DOC_BUCKET, key: `${UID}/a.pdf` });
  });
  it("takes a kortex-* first segment as the bucket", () => {
    expect(splitStoragePath(`kortex-media/${UID}/b.epub`)).toEqual({ bucket: "kortex-media", key: `${UID}/b.epub` });
    expect(splitStoragePath(`kortex-documents/${UID}/c.pdf`)).toEqual({ bucket: "kortex-documents", key: `${UID}/c.pdf` });
  });
  it("rejects empty paths and a bare bucket", () => {
    expect(splitStoragePath("")).toBeNull();
    expect(splitStoragePath("  ")).toBeNull();
    expect(splitStoragePath("kortex-documents/")).toBeNull();
  });
});

describe("readerFormatOf", () => {
  it("prefers the mime type, then the extension", () => {
    expect(readerFormatOf("application/pdf", "x.bin")).toBe("pdf");
    expect(readerFormatOf("application/epub+zip", "x")).toBe("epub");
    expect(readerFormatOf(null, "Book.EPUB")).toBe("epub");
    expect(readerFormatOf(null, "scan.png")).toBeNull();
  });
});

describe("parseReadingState", () => {
  it("keeps a valid state", () => {
    const st = { format: "pdf", page: 12, progress: 0.2, updatedAt: "2026-10-22T10:00:00.000Z" };
    expect(parseReadingState(st, ["pdf"])).toEqual(st);
  });
  it("drops the CFI of a format the document doesn't have", () => {
    expect(parseReadingState({ format: "epub", page: 3, cfi: "epubcfi(/6/2)", progress: 0.1 }, ["pdf"])).toEqual({
      format: "pdf",
      page: 3,
      progress: 0.1,
      updatedAt: "",
    });
  });
  it("accepts a CFI-only EPUB state and clamps junk", () => {
    expect(parseReadingState({ format: "epub", cfi: "epubcfi(/6/4!/4/2)", progress: 7 }, ["epub"])).toEqual({
      format: "epub",
      page: 1,
      cfi: "epubcfi(/6/4!/4/2)",
      progress: 1,
      updatedAt: "",
    });
  });
  it("rejects unusable values", () => {
    expect(parseReadingState(null, ["pdf"])).toBeNull();
    expect(parseReadingState([], ["pdf"])).toBeNull();
    expect(parseReadingState({ format: "pdf" }, ["pdf"])).toBeNull();
  });
});

describe("liveReaderDoc", () => {
  it("builds a single-format PDF doc without mock extras", () => {
    const doc = liveReaderDoc(pdfItem())!;
    expect(doc).toMatchObject({
      noteId: ID,
      folder: "60_Documents/Buecher",
      formats: ["pdf"],
      fileName: { pdf: "AI_Engineering.pdf" },
      url: {},
      live: true,
      paged: true,
      pageOffset: 0,
      firstPage: 1,
      lastPage: 318,
      totalPages: 318,
      anchorPage: 1,
      epubAnchors: {},
      seedHighlights: [],
      explanation: null,
      savedState: null,
    });
  });
  it("opens at the saved page (clamped to the page count)", () => {
    const doc = liveReaderDoc(pdfItem({ readingState: { format: "pdf", page: 500, progress: 1, updatedAt: "x" } }))!;
    expect(doc.anchorPage).toBe(318);
    expect(doc.savedState?.page).toBe(318);
  });
  it("leaves the page count unknown without page_count and names the file from the path", () => {
    const item = pdfItem();
    const doc = liveReaderDoc({ ...item, source: { url: null, file: item.source!.file } })!;
    expect(doc.totalPages).toBe(0);
    expect(doc.lastPage).toBe(0);
    expect(doc.fileName.pdf).toBe(`${ID}.pdf`);
  });
  it("builds an unpaged EPUB doc that restores its CFI", () => {
    const doc = liveReaderDoc(
      pdfItem({
        path: "book.md",
        source: { url: null, file: { path: `${UID}/b.epub`, mime: "application/epub+zip", format: "epub", sizeBytes: null } },
        readingState: { format: "epub", page: 1, cfi: "epubcfi(/6/8!/4/2/1:0)", progress: 0.4, updatedAt: "t" },
      }),
    )!;
    expect(doc.formats).toEqual(["epub"]);
    expect(doc.paged).toBe(false);
    expect(doc.folder).toBe("");
    expect(doc.totalPages).toBe(0);
    expect(doc.epubAnchors).toEqual({});
    expect(doc.savedState).toMatchObject({ format: "epub", cfi: "epubcfi(/6/8!/4/2/1:0)", progress: 0.4 });
  });
  it("returns null without a readable stored file", () => {
    expect(liveReaderDoc(pdfItem({ reader: undefined }))).toBeNull();
    expect(liveReaderDoc(pdfItem({ source: { url: "https://x" } }))).toBeNull();
    expect(
      liveReaderDoc(pdfItem({ source: { url: null, file: { path: `${UID}/a.png`, mime: "image/png", format: "other", sizeBytes: 1 } } })),
    ).toBeNull();
  });
});

describe("mock doc", () => {
  it("stays the two-format prototype document", () => {
    const doc = readerDoc("n3")!;
    expect(doc.formats).toEqual(["pdf", "epub"]);
    expect(doc.paged).toBe(true);
    expect(doc.pageOffset).toBe(40);
    expect(doc.explanation).toBeTruthy();
  });
});
