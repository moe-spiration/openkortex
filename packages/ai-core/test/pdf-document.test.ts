import { describe, expect, it } from "vitest";
import { createPdfDocumentAdapter } from "../src/adapters/pdf-document.adapter";
import { ExtractionError } from "../src/errors";
import { createMemoryStorageGateway } from "../src/storage";
import { makePdf } from "./fixtures/make-pdf";
import { ITEM_ID, USER_ID } from "./helpers";

const pdf = makePdf({
  title: "Kortex Architektur",
  author: "Max",
  pages: [
    "Einleitung\nKortex ist ein Second Brain.",
    "Datenmodell\nknowledge_items speichert alle Inhalte.",
    "Weiter im Datenmodell\nitem_chunks haelt Embeddings.",
  ],
  outline: [
    { title: "1 Einleitung", page: 1 },
    { title: "2 Datenmodell", page: 2 },
  ],
});

describe("pdf-document adapter", () => {
  it("handles PDFs by mime type or extension", () => {
    const a = createPdfDocumentAdapter({ storage: createMemoryStorageGateway() });
    expect(a.canHandle({ userId: USER_ID, fileBuffer: pdf, mimeType: "application/pdf" })).toBe(
      true,
    );
    expect(a.canHandle({ userId: USER_ID, fileBuffer: pdf, fileName: "Report.PDF" })).toBe(true);
    expect(a.canHandle({ userId: USER_ID, fileName: "Report.pdf" })).toBe(false);
    expect(a.canHandle({ userId: USER_ID, fileBuffer: pdf, mimeType: "image/png" })).toBe(false);
  });

  it("stores the file and extracts one chunk per page with 'Page X' and outline chapter", async () => {
    const storage = createMemoryStorageGateway();
    const out = await createPdfDocumentAdapter({ storage }).extract({
      userId: USER_ID,
      itemId: ITEM_ID,
      fileBuffer: pdf,
      fileName: "architektur.pdf",
      mimeType: "application/pdf",
    });

    const key = `kortex-documents/${USER_ID}/${ITEM_ID}.pdf`;
    expect([...storage.files.keys()]).toEqual([key]);
    expect(storage.files.get(key)?.contentType).toBe("application/pdf");
    expect(out.file).toEqual({
      bucket: "kortex-documents",
      path: `${USER_ID}/${ITEM_ID}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: pdf.byteLength,
    });

    expect(out.type).toBe("pdf");
    expect(out.titleHint).toBe("Kortex Architektur");
    expect(out.structuralChunks?.map((c) => [c.pageOrTimestamp, c.heading])).toEqual([
      ["Page 1", "1 Einleitung"],
      ["Page 2", "2 Datenmodell"],
      ["Page 3", "2 Datenmodell"],
    ]);
    expect(out.structuralChunks?.[1]?.text).toContain("knowledge_items speichert alle Inhalte.");
    expect(out.contentMd).toContain("# Kortex Architektur");
    expect(out.contentMd).toContain("> PDF · 3 Seiten · Max");
    expect(out.contentMd).toContain("- 2 Datenmodell [S. 2]");
    expect(out.contentMd).toContain("## Seite 3");
    expect(out.metadata).toMatchObject({
      page_count: 3,
      author: "Max",
      outline: [
        { title: "1 Einleitung", page: 1, depth: 0 },
        { title: "2 Datenmodell", page: 2, depth: 0 },
      ],
    });
    expect(out.metadata.needs_ocr).toBeUndefined();
  });

  it("falls back to the file name as title and flags text-less PDFs for OCR", async () => {
    const out = await createPdfDocumentAdapter({ storage: createMemoryStorageGateway() }).extract({
      userId: USER_ID,
      itemId: ITEM_ID,
      fileBuffer: makePdf({ pages: [""] }),
      fileName: "scan_2026-10-01.pdf",
    });
    expect(out.titleHint).toBe("scan 2026 10 01");
    expect(out.structuralChunks).toEqual([]);
    expect(out.metadata.needs_ocr).toBe(true);
  });

  it("rejects broken files and missing itemId", async () => {
    const a = createPdfDocumentAdapter({ storage: createMemoryStorageGateway() });
    await expect(
      a.extract({
        userId: USER_ID,
        itemId: ITEM_ID,
        fileBuffer: new TextEncoder().encode("nope"),
        fileName: "x.pdf",
      }),
    ).rejects.toBeInstanceOf(ExtractionError);
    await expect(
      a.extract({ userId: USER_ID, fileBuffer: pdf, fileName: "x.pdf" }),
    ).rejects.toThrow(/itemId/);
  });
});
