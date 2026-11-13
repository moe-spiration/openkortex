import { describe, expect, it } from "vitest";
import { createEpubBookAdapter } from "../src/adapters/epub-book.adapter";
import { ExtractionError } from "../src/errors";
import { createMemoryStorageGateway } from "../src/storage";
import { makeEpub, PNG_1PX } from "./fixtures/make-epub";
import { ITEM_ID, USER_ID } from "./helpers";

const run = (bytes: Uint8Array, storage = createMemoryStorageGateway()) =>
  createEpubBookAdapter({ storage }).extract({
    userId: USER_ID,
    itemId: ITEM_ID,
    fileBuffer: bytes,
    fileName: "wissensarbeit.epub",
    mimeType: "application/epub+zip",
  });

describe("epub-book adapter", () => {
  it("turns the spine into Markdown chapters with hierarchy and CFI anchors", async () => {
    const storage = createMemoryStorageGateway();
    const out = await run(makeEpub(), storage);

    expect(out.type).toBe("epub");
    expect(out.titleHint).toBe("Die Kunst der Wissensarbeit");
    expect(out.metadata).toMatchObject({
      authors: ["Erika Mustermann", "Max Muster"],
      language: "de",
      publisher: "Kortex Verlag",
      identifier: "urn:isbn:9783000000001",
      chapter_count: 3,
    });
    // Non-linear cover page is skipped; nav titles win over NCX; nesting from the nav <ol>.
    expect(out.metadata.chapters).toEqual([
      {
        index: 0,
        title: "Kapitel 1: Zettelkasten",
        depth: 0,
        href: "OEBPS/text/ch1.xhtml",
        cfi: "epubcfi(/6/4[ch1]!)",
      },
      {
        index: 1,
        title: "Verlinkung",
        depth: 1,
        href: "OEBPS/text/ch1-1.xhtml",
        cfi: "epubcfi(/6/6[ch1-1]!)",
      },
      {
        index: 2,
        title: "Kapitel 2: Second Brain",
        depth: 0,
        href: "OEBPS/text/ch 2.xhtml",
        cfi: "epubcfi(/6/8[ch2]!)",
      },
    ]);
    expect(out.structuralChunks?.map((c) => [c.heading, c.pageOrTimestamp])).toEqual([
      ["Kapitel 1: Zettelkasten", "epubcfi(/6/4[ch1]!)"],
      ["Verlinkung", "epubcfi(/6/6[ch1-1]!)"],
      ["Kapitel 2: Second Brain", "epubcfi(/6/8[ch2]!)"],
    ]);

    const md = out.contentMd;
    expect(md).toMatch(
      /^# Die Kunst der Wissensarbeit\n\n> EPUB · 3 Kapitel · Erika Mustermann, Max Muster · Kortex Verlag/,
    );
    expect(md).toContain(
      "## Inhaltsverzeichnis\n\n- Kapitel 1: Zettelkasten\n  - Verlinkung\n- Kapitel 2: Second Brain",
    );
    expect(md).toContain(
      "## Kapitel 1: Zettelkasten\n\nDer **Zettelkasten** von Niklas Luhmann verbindet Notizen & Ideen.",
    );
    // Chapter-internal h2 is pushed below the chapter heading; duplicate title h1 dropped.
    expect(md).toContain("#### Atomare Notizen");
    expect(md).toContain("### Verlinkung\n\nLinks zwischen Notizen erzeugen ein Netz.");
    expect(md).not.toMatch(/^### Verlinkung\n\n#+ Verlinkung/m);
    // Internal links become plain text, images are dropped.
    expect(md).toContain("Siehe nächster Abschnitt.");
    expect(md).not.toMatch(/!\[|\.xhtml\)/);
    expect(md).toContain("- Erfassen\n- Organisieren");

    // Original EPUB to documents, cover to media.
    expect([...storage.files.keys()].sort()).toEqual([
      `kortex-documents/${USER_ID}/${ITEM_ID}.epub`,
      `kortex-media/${USER_ID}/${ITEM_ID}.png`,
    ]);
    expect(storage.files.get(`kortex-media/${USER_ID}/${ITEM_ID}.png`)?.data).toEqual(PNG_1PX);
    expect(out.metadata.cover_storage_path).toBe(`${USER_ID}/${ITEM_ID}.png`);
    expect(out.file?.mimeType).toBe("application/epub+zip");
  });

  it("uses the NCX when there is no EPUB3 nav", async () => {
    const out = await run(makeEpub({ withNav: false, withCover: false }));
    const chapters = out.metadata.chapters as Array<{ title: string; depth: number }>;
    expect(chapters.map((c) => [c.title, c.depth])).toEqual([
      ["NCX Kapitel 1", 0],
      ["NCX Verlinkung", 1],
      ["NCX Kapitel 2", 0],
    ]);
    expect(out.metadata.cover_storage_path).toBeNull();
  });

  it("falls back to the first heading without any TOC", async () => {
    const out = await run(makeEpub({ withNav: false, withNcx: false, withCover: false }));
    expect((out.metadata.chapters as Array<{ title: string }>).map((c) => c.title)).toEqual([
      "Kapitel 1: Zettelkasten",
      "Verlinkung",
      "Kapitel 2: Second Brain",
    ]);
  });

  it("rejects non-zip input", async () => {
    await expect(run(new TextEncoder().encode("not a zip"))).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });
});
