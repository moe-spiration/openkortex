import { ph } from "../i18n";
import { strFromU8, unzipSync, type Unzipped } from "fflate";
import { ExtractionError, KortexAiError } from "../errors";
import { STORAGE_BUCKETS, imageExtension, itemStoragePath, type StorageGateway } from "../storage";
import {
  decodeEntities,
  dirname,
  findElements,
  firstText,
  htmlToMarkdown,
  resolveZipPath,
  scanTags,
  stripTags,
} from "../util/markup";
import {
  fileExtension,
  type ExtractedPayload,
  type IngestionAdapter,
  type RawIngestInput,
  type StructuralChunk,
} from "./base-adapter";

const ID = "epub-book";
const EPUB_MIME = "application/epub+zip";

export interface EpubAdapterOptions {
  storage: StorageGateway;
}

interface ManifestItem {
  id: string;
  href: string; // resolved zip path
  mediaType: string;
  properties: string[];
}

interface TocEntry {
  title: string;
  path: string; // resolved zip path, no fragment
  depth: number;
}

export interface EpubChapter {
  index: number;
  title: string;
  depth: number;
  href: string;
  /** Spine-level CFI, usable with epubjs `rendition.display(cfi)`. */
  cfi: string;
}

const stripFragment = (href: string) => decodeURIComponent(href.split("#")[0] ?? "");

function readText(files: Unzipped, path: string): string | undefined {
  const f = files[path];
  return f ? strFromU8(f) : undefined;
}

/** EPUB3 nav document (`<nav epub:type="toc">`), nesting depth from `<ol>`. */
function parseNavToc(xhtml: string, baseDir: string): TocEntry[] {
  const navStart = xhtml.search(/<nav\b[^>]*\btype\s*=\s*["']toc["']/i);
  if (navStart < 0) return [];
  const navEnd = xhtml.indexOf("</nav>", navStart);
  const nav = xhtml.slice(navStart, navEnd < 0 ? undefined : navEnd);
  const out: TocEntry[] = [];
  let olDepth = 0;
  let openA: { href: string; start: number; depth: number } | undefined;
  for (const tag of scanTags(nav)) {
    if (tag.name === "ol" && !tag.selfClosing) olDepth += tag.closing ? -1 : 1;
    else if (tag.name === "a" && !tag.closing && tag.attrs.href) {
      openA = { href: tag.attrs.href, start: tag.end, depth: Math.max(olDepth - 1, 0) };
    } else if (tag.name === "a" && tag.closing && openA) {
      const title = stripTags(nav.slice(openA.start, tag.index));
      if (title)
        out.push({
          title,
          path: resolveZipPath(baseDir, stripFragment(openA.href)),
          depth: openA.depth,
        });
      openA = undefined;
    }
  }
  return out;
}

/** EPUB2 NCX (`<navPoint>` nesting). */
function parseNcxToc(ncx: string, baseDir: string): TocEntry[] {
  const out: TocEntry[] = [];
  let depth = 0;
  let pending: { title?: string; depth: number } | undefined;
  let textStart: number | undefined;
  for (const tag of scanTags(ncx)) {
    if (tag.name === "navpoint") {
      if (tag.closing) depth--;
      else {
        depth++;
        pending = { depth: depth - 1 };
      }
    } else if (tag.name === "text" && pending && pending.title === undefined) {
      if (!tag.closing) textStart = tag.end;
      else if (textStart !== undefined) {
        pending.title = stripTags(ncx.slice(textStart, tag.index));
        textStart = undefined;
      }
    } else if (tag.name === "content" && pending && tag.attrs.src) {
      if (pending.title) {
        out.push({
          title: pending.title,
          path: resolveZipPath(baseDir, stripFragment(tag.attrs.src)),
          depth: pending.depth,
        });
      }
      pending = undefined;
    }
  }
  return out;
}

/** Shifts chapter-internal headings below the chapter heading and drops a duplicate title. */
function nestChapterMarkdown(md: string, chapterLevel: number, title: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  let lines = md.split("\n");
  const firstIdx = lines.findIndex((l) => l.trim() !== "");
  const first = lines[firstIdx]?.match(/^#{1,6}\s+(.*)$/);
  if (first?.[1] && norm(first[1]) === norm(title)) lines = lines.slice(firstIdx + 1);
  let inFence = false;
  return lines
    .map((l) => {
      if (/^\s*```/.test(l)) inFence = !inFence;
      if (inFence) return l;
      return l.replace(
        /^(#{1,6})(\s+)/,
        (_m, h: string, sp: string) => "#".repeat(Math.min(h.length + chapterLevel, 6)) + sp,
      );
    })
    .join("\n")
    .trim();
}

export function createEpubBookAdapter(options: EpubAdapterOptions): IngestionAdapter {
  return {
    id: ID,
    canHandle: (input: RawIngestInput) =>
      !!input.fileBuffer &&
      (input.mimeType?.toLowerCase() === EPUB_MIME || fileExtension(input) === "epub"),

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      if (!input.itemId) throw new KortexAiError(`${ID}: itemId is required to store the file`);
      const bytes = input.fileBuffer as Uint8Array;

      let files: Unzipped;
      try {
        files = unzipSync(bytes);
      } catch (cause) {
        throw new ExtractionError(ID, "not a valid EPUB (zip) file", { cause });
      }

      const container = readText(files, "META-INF/container.xml");
      const opfPath = container && findElements(container, "rootfile")[0]?.attrs["full-path"];
      const opf = opfPath ? readText(files, opfPath) : undefined;
      if (!opfPath || !opf) throw new ExtractionError(ID, "missing OPF package document");
      const opfDir = dirname(opfPath);

      const manifest = new Map<string, ManifestItem>();
      for (const el of findElements(opf, "item")) {
        const { id, href } = el.attrs;
        if (!id || !href) continue;
        manifest.set(id, {
          id,
          href: resolveZipPath(opfDir, decodeURIComponent(href)),
          mediaType: el.attrs["media-type"] ?? "",
          properties: (el.attrs.properties ?? "").split(/\s+/).filter(Boolean),
        });
      }

      const spineEl = findElements(opf, "spine")[0];
      const spine = spineEl ? findElements(spineEl.inner, "itemref") : [];
      if (spine.length === 0) throw new ExtractionError(ID, "EPUB has an empty spine");

      // Table of contents: EPUB3 nav first, NCX second.
      let toc: TocEntry[] = [];
      const navItem = [...manifest.values()].find((m) => m.properties.includes("nav"));
      const navDoc = navItem && readText(files, navItem.href);
      if (navItem && navDoc) toc = parseNavToc(navDoc, dirname(navItem.href));
      if (toc.length === 0) {
        const ncxItem =
          manifest.get(spineEl?.attrs.toc ?? "") ??
          [...manifest.values()].find((m) => m.mediaType === "application/x-dtbncx+xml");
        const ncx = ncxItem && readText(files, ncxItem.href);
        if (ncxItem && ncx) toc = parseNcxToc(ncx, dirname(ncxItem.href));
      }
      const tocByPath = new Map<string, TocEntry>();
      for (const t of toc) if (!tocByPath.has(t.path)) tocByPath.set(t.path, t);

      const title =
        decodeEntities(firstText(opf, "title") ?? "") ||
        input.fileName?.replace(/\.epub$/i, "") ||
        "EPUB-Buch";
      const authors = findElements(opf, "creator")
        .map((c) => stripTags(c.inner))
        .filter(Boolean);
      const language = firstText(opf, "language");
      const publisher = firstText(opf, "publisher");
      const published = firstText(opf, "date");
      const identifier = firstText(opf, "identifier");

      const chapters: EpubChapter[] = [];
      const structuralChunks: StructuralChunk[] = [];
      const body: string[] = [];

      spine.forEach((ref, spineIndex) => {
        const idref = ref.attrs.idref ?? "";
        const item = manifest.get(idref);
        if (!item || ref.attrs.linear === "no") return;
        if (!/x?html/.test(item.mediaType)) return;
        const xhtml = readText(files, item.href);
        if (!xhtml) return;
        const rawMd = htmlToMarkdown(xhtml);
        if (!rawMd) return;

        const tocEntry = tocByPath.get(item.href);
        const firstHeading = rawMd.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
        const chapterTitle = tocEntry?.title ?? firstHeading ?? `${ph("section")} ${chapters.length + 1}`;
        const depth = tocEntry?.depth ?? 0;
        const level = Math.min(depth + 2, 6); // book title is H1, top chapters H2
        const cfi = `epubcfi(/6/${(spineIndex + 1) * 2}[${idref}]!)`;
        const text = nestChapterMarkdown(rawMd, level, chapterTitle);

        chapters.push({ index: chapters.length, title: chapterTitle, depth, href: item.href, cfi });
        body.push(`${"#".repeat(level)} ${chapterTitle}`, "", text, "");
        if (text) structuralChunks.push({ heading: chapterTitle, pageOrTimestamp: cfi, text });
      });

      if (chapters.length === 0) throw new ExtractionError(ID, "no readable chapters in the spine");

      const epubPath = itemStoragePath(input.userId, input.itemId, "epub");
      await options.storage.upload({
        bucket: STORAGE_BUCKETS.documents,
        path: epubPath,
        data: bytes,
        contentType: EPUB_MIME,
      });

      // Cover: EPUB3 `properties="cover-image"`, or EPUB2 `<meta name="cover" content="id">`.
      const coverMetaId = findElements(opf, "meta").find((m) => m.attrs.name === "cover")?.attrs
        .content;
      const coverItem =
        [...manifest.values()].find((m) => m.properties.includes("cover-image")) ??
        (coverMetaId ? manifest.get(coverMetaId) : undefined);
      let coverImageUrl: string | undefined;
      let coverStoragePath: string | undefined;
      const coverBytes = coverItem && files[coverItem.href];
      if (coverItem && coverBytes && coverItem.mediaType.startsWith("image/")) {
        coverStoragePath = itemStoragePath(
          input.userId,
          input.itemId,
          imageExtension(coverItem.mediaType),
        );
        const res = await options.storage.upload({
          bucket: STORAGE_BUCKETS.media,
          path: coverStoragePath,
          data: coverBytes,
          contentType: coverItem.mediaType,
        });
        coverImageUrl = res.url;
      }

      const facts = [
        `EPUB · ${chapters.length} ${ph(chapters.length === 1 ? "chapterCountOne" : "chapterCountOther")}`,
        authors.length ? authors.join(", ") : null,
        publisher ?? null,
      ]
        .filter(Boolean)
        .join(" · ");
      const tocMd = chapters.map((c) => `${"  ".repeat(c.depth)}- ${c.title}`);
      const contentMd = [
        `# ${title}`,
        "",
        `> ${facts}`,
        "",
        `## ${ph("tableOfContents")}`,
        "",
        ...tocMd,
        "",
        ...body,
      ]
        .join("\n")
        .trim();

      return {
        type: "epub",
        sourcePlatform: "upload",
        titleHint: title,
        contentMd,
        coverImageUrl,
        structuralChunks,
        file: {
          bucket: STORAGE_BUCKETS.documents,
          path: epubPath,
          mimeType: EPUB_MIME,
          sizeBytes: bytes.byteLength,
        },
        metadata: {
          authors,
          language: language ?? null,
          publisher: publisher ?? null,
          published: published ?? null,
          identifier: identifier ?? null,
          chapter_count: chapters.length,
          chapters,
          cover_storage_path: coverStoragePath ?? null,
          original_file_name: input.fileName ?? null,
        },
      };
    },
  };
}
