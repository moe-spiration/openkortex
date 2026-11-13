import { ph } from "../i18n";
import { extractImages, extractText, getDocumentProxy, getMeta } from "unpdf";
import { ExtractionError, KortexAiError } from "../errors";
import type { DocumentParser } from "../providers/edenai";
import {
  describeEmbeddedImages,
  encodePng,
  maxEmbeddedImages,
  type ImageCandidate,
} from "../media/embedded-images";
import type { ModelRouter } from "../router/model-router";
import { STORAGE_BUCKETS, itemStoragePath, type StorageGateway } from "../storage";
import {
  fileExtension,
  type ExtractedPayload,
  type IngestionAdapter,
  type RawIngestInput,
  type StoredFile,
  type StructuralChunk,
} from "./base-adapter";

const ID = "pdf-document";

export interface PdfAdapterOptions {
  storage: StorageGateway;
  /** OCR for PDFs without a text layer (routed document_parsing). Without it they are flagged needs_ocr. */
  documentParser?: DocumentParser;
  /** Vision (routed vision_ocr) for diagrams and figures inside the PDF. Without it: text only. */
  models?: ModelRouter;
  /** Cap for described images per PDF (default: KORTEX_MAX_EMBEDDED_IMAGES, 5). */
  maxImages?: number;
}

/** Pages scanned for figures, and the smallest image worth a vision call (icons, rules, bullets are not). */
const IMAGE_SCAN_PAGES = 40;
const MIN_IMAGE_SIDE = 120;
const MIN_IMAGE_PIXELS = 30_000;

export interface PdfOutlineEntry {
  title: string;
  page: number | null;
  depth: number;
}

type PdfDoc = Awaited<ReturnType<typeof getDocumentProxy>>;
type OutlineNode = Awaited<ReturnType<PdfDoc["getOutline"]>>[number];

async function resolveOutline(pdf: PdfDoc): Promise<PdfOutlineEntry[]> {
  const out: PdfOutlineEntry[] = [];
  const walk = async (nodes: OutlineNode[] | null | undefined, depth: number) => {
    for (const node of nodes ?? []) {
      let page: number | null = null;
      try {
        const dest =
          typeof node.dest === "string" ? await pdf.getDestination(node.dest) : node.dest;
        const ref = dest?.[0];
        if (ref && typeof ref === "object") page = (await pdf.getPageIndex(ref)) + 1;
        else if (typeof ref === "number") page = ref + 1;
      } catch {
        page = null;
      }
      out.push({ title: node.title.trim(), page, depth });
      await walk(node.items as OutlineNode[], depth + 1);
    }
  };
  try {
    await walk(await pdf.getOutline(), 0);
  } catch {
    return [];
  }
  return out;
}

/** Title of the outline entry that covers `page` (last entry starting at or before it). */
function chapterForPage(outline: readonly PdfOutlineEntry[], page: number): string | undefined {
  let title: string | undefined;
  let start = 0;
  for (const e of outline) {
    if (e.page !== null && e.page <= page && e.page >= start) {
      title = e.title;
      start = e.page;
    }
  }
  return title;
}

const cleanPageText = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/-\n(?=[a-zäöüß])/g, "") // re-join hyphenated words
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function createPdfDocumentAdapter(options: PdfAdapterOptions): IngestionAdapter {
  return {
    id: ID,
    canHandle: (input: RawIngestInput) =>
      !!input.fileBuffer &&
      (input.mimeType?.toLowerCase() === "application/pdf" || fileExtension(input) === "pdf"),

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      if (!input.itemId) throw new KortexAiError(`${ID}: itemId is required to store the file`);
      const bytes = input.fileBuffer as Uint8Array;

      let pdf: PdfDoc;
      try {
        // pdf.js may transfer (detach) the buffer it gets, so give it a copy.
        pdf = await getDocumentProxy(new Uint8Array(bytes));
      } catch (cause) {
        throw new ExtractionError(ID, "not a readable PDF", { cause });
      }

      const [{ totalPages, text: pages }, meta, outline] = await Promise.all([
        extractText(pdf, { mergePages: false }),
        getMeta(pdf).catch(() => ({ info: {} as Record<string, unknown> })),
        resolveOutline(pdf),
      ]);

      const path = itemStoragePath(input.userId, input.itemId, "pdf");
      await options.storage.upload({
        bucket: STORAGE_BUCKETS.documents,
        path,
        data: bytes,
        contentType: "application/pdf",
      });
      const file: StoredFile = {
        bucket: STORAGE_BUCKETS.documents,
        path,
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
      };

      const info = meta.info as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
      const fileTitle = input.fileName
        ?.replace(/\.pdf$/i, "")
        .replace(/[_-]+/g, " ")
        .trim();
      const title = str(info.Title) ?? fileTitle ?? ph("pdfDocument");
      const author = str(info.Author);

      const structuralChunks: StructuralChunk[] = [];
      const md: string[] = [`# ${title}`, ""];
      md.push(
        `> PDF · ${totalPages} ${ph(totalPages === 1 ? "pageCountOne" : "pageCountOther")}${author ? ` · ${author}` : ""}`,
        "",
      );

      if (outline.length > 0) {
        md.push(`## ${ph("tableOfContents")}`, "");
        for (const e of outline) {
          md.push(`${"  ".repeat(e.depth)}- ${e.title}${e.page ? ` [${ph("pageAbbr")} ${e.page}]` : ""}`);
        }
        md.push("");
      }

      let pageTexts = pages.map(cleanPageText);
      const textChars = pageTexts.reduce((n, t) => n + t.length, 0);
      // Scanned PDFs have no text layer: run the routed document_parsing (Eden AI OCR by default).
      let needsOcr = textChars < 10 * Math.max(totalPages, 1);
      let ocrBy: string | null = null;
      let ocrError: string | undefined;
      if (needsOcr && options.documentParser) {
        try {
          const doc = await options.documentParser.parse({
            data: bytes,
            mimeType: "application/pdf",
            fileName: input.fileName ?? "document.pdf",
          });
          pageTexts = (doc.pages?.length ? doc.pages : [doc.text]).map(cleanPageText);
          ocrBy = options.documentParser.id;
          needsOcr = false;
        } catch (err) {
          ocrError = err instanceof Error ? err.message : String(err);
        }
      }

      pageTexts.forEach((text, i) => {
        const page = i + 1;
        if (!text) return;
        md.push(`## ${ph("page")} ${page}`, "", text, "");
        structuralChunks.push({
          heading: chapterForPage(outline, page),
          pageOrTimestamp: `Page ${page}`,
          text,
        });
      });

      // Figures and diagrams: the largest few go through vision. Never fails the ingest.
      const imageWarnings: string[] = [];
      let imagesDescribed = 0;
      const maxImages = options.maxImages ?? maxEmbeddedImages();
      if (options.models && maxImages > 0) {
        try {
          const candidates: ImageCandidate[] = [];
          const seen = new Set<string>();
          for (let page = 1; page <= Math.min(totalPages, IMAGE_SCAN_PAGES); page++) {
            let found: Awaited<ReturnType<typeof extractImages>> = [];
            try {
              found = await extractImages(pdf, page);
            } catch {
              continue; // an unreadable page object is not worth a warning
            }
            for (const img of found) {
              if (img.width < MIN_IMAGE_SIDE || img.height < MIN_IMAGE_SIDE) continue;
              if (img.width * img.height < MIN_IMAGE_PIXELS || seen.has(img.key)) continue;
              seen.add(img.key);
              candidates.push({
                label: `${ph("page")} ${page}`,
                weight: img.width * img.height,
                load: async () => ({
                  bytes: encodePng(img.width, img.height, img.channels, img.data),
                  mimeType: "image/png",
                }),
              });
            }
          }
          const described = await describeEmbeddedImages(options.models, candidates, maxImages);
          imageWarnings.push(...described.warnings);
          imagesDescribed = described.described;
          if (described.md) {
            md.push(described.md, "");
            structuralChunks.push({ heading: ph("images"), text: described.md });
          }
        } catch (err) {
          imageWarnings.push(`images: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const warnings = [...(ocrError ? [`ocr: ${ocrError}`] : []), ...imageWarnings];

      return {
        type: "pdf",
        sourcePlatform: "upload",
        titleHint: title,
        contentMd: md.join("\n").trim(),
        structuralChunks,
        file,
        metadata: {
          page_count: totalPages,
          author: author ?? null,
          pdf_title: str(info.Title) ?? null,
          outline,
          original_file_name: input.fileName ?? null,
          needs_ocr: needsOcr || undefined,
          ocr_by: ocrBy,
          ...(imagesDescribed ? { images_described: imagesDescribed } : {}),
          ...(warnings.length ? { warnings } : {}),
        },
      };
    },
  };
}
