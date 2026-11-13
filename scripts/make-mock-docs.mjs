#!/usr/bin/env node
/*
 * Generates the split reader's mock documents (deterministic, committed):
 *   apps/web/public/mock/docs/ai-engineering-ch3.pdf   4 pages, book pages 41-44 of 318
 *   apps/web/public/mock/docs/ai-engineering-ch3.epub  EPUB 3 with the same text and page anchors
 *
 * No PDF/ZIP library: the PDF objects are written by hand (standard Times-Roman/Courier, WinAnsi)
 * and the EPUB is a stored (uncompressed) ZIP built with zlib.crc32. Text and page numbers must
 * stay in sync with apps/web/src/components/reader/mockDoc.ts (seed highlight, EPUB anchors).
 *
 * Run: node scripts/make-mock-docs.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/web/public/mock/docs");

/* ------------------------------------------------------------------ content */

/** One book page; `file` is the EPUB section it lands in. */
const PAGES = [
  {
    page: 41,
    file: "chapter-2.xhtml",
    blocks: [
      ["h2", "Summary"],
      ["p", "Choosing a chunk size stays a trade-off. Small chunks match a question precisely but lose the surrounding meaning quickly. Large chunks keep the context but dilute the embedding, because they cover several topics at once."],
      ["p", "A starting value of 400 to 800 tokens with ten to twenty percent overlap has proven itself. Headings, tables and code blocks should not be cut apart: a splitter that breaks at paragraphs and sections almost always finds better matches than a rigid window."],
      ["p", "One problem, however, no chunk size solves: every chunk is embedded on its own and does not know what comes before it in the document. This is where the next chapter starts."],
    ],
  },
  {
    page: 42,
    file: "chapter-3.xhtml",
    blocks: [
      ["eyebrow", "Chapter 3"],
      ["h1", "Contextual Retrieval"],
      ["p", "A retrieval system is only as good as the pieces of text it finds. When documents are split into chunks, the link to the whole document is often lost: a sentence like \u201cRevenue grew by 3 percent in the second quarter\u201d names neither the company nor the year."],
      ["p", "Contextual retrieval puts a short, model-written description in front of every chunk before it is embedded, placing it within the whole document. The same description goes into the BM25 index, so lexical and semantic search gain from the same extra context."],
      ["p", "The extra effort comes once, at indexing time, and prompt caching lowers it considerably. The length of the added context still matters: too short and it does not place the chunk, too long and it dilutes the embedding."],
      ["p", "In practice it pays to compare on a small test set before the whole collection is indexed again."],
    ],
  },
  {
    page: 43,
    file: "chapter-3.xhtml",
    blocks: [
      ["h2", "Writing the context"],
      ["p", "For every chunk the model gets two inputs: the full document and the single chunk. The instruction is, in essence, to describe in one or two sentences where this section sits in the document and what it is about. Nothing more is needed."],
      ["p", "Because the document stays the same for all of its chunks, it is ideal for prompt caching. The document is loaded into the cache once; every further call only pays for the short chunk and the answer. For long manuals the cost drops to a fraction."],
      ["p", "The generated context is put in front of the chunk, and only this combined text is embedded and written to the BM25 index. The original chunk is kept for display in the search result."],
    ],
  },
  {
    page: 44,
    file: "chapter-3-reranking.xhtml",
    blocks: [
      ["h2", "Reranking as a second stage"],
      ["p", "Contextual retrieval improves which candidates are found at all. A reranker then decides which of them really fit the question. For this, the best 150 hits from vector and BM25 search are merged and scored again by a cross-encoder."],
      ["p", "Only the top 20 chunks then go into the prompt. That costs one extra request per search but noticeably lowers the retrieval error rate, especially for questions that touch several sections of a document."],
      ["p", "Context, hybrid search and reranking can be introduced step by step: first the context, then BM25, finally the reranker. Each stage can be measured on its own."],
    ],
  },
];

const TITLE = "AI Engineering – Chapter 3 (Excerpt)";
const AUTHOR = "Demo";
const FIRST_PAGE = PAGES[0].page;

/* ---------------------------------------------------------------------- PDF */

// WinAnsiEncoding bytes for the non-ASCII characters used above.
const WIN_ANSI = { "ä": 0xe4, "ö": 0xf6, "ü": 0xfc, "Ä": 0xc4, "Ö": 0xd6, "Ü": 0xdc, "ß": 0xdf, "é": 0xe9, "„": 0x84, "“": 0x93, "”": 0x94, "‘": 0x91, "’": 0x92, "–": 0x96, "—": 0x97, "…": 0x85, "·": 0xb7 };

// Times-Roman advance widths (Adobe AFM, 1/1000 em), ASCII 32..126 then the WinAnsi extras.
const TIMES_ASCII = [
  250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, // ' '../
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, // 0..?
  921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, // @..O
  556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, // P.._
  333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, // `..o
  500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541, // p..~
];
const TIMES_EXTRA = { "ä": 444, "ö": 500, "ü": 500, "Ä": 722, "Ö": 722, "Ü": 722, "ß": 500, "é": 444, "„": 444, "“": 444, "”": 444, "‘": 333, "’": 333, "–": 500, "—": 1000, "…": 1000, "·": 250 };

function charWidth(font, ch) {
  if (font === "F2") return 600; // Courier is monospaced
  const code = ch.charCodeAt(0);
  const w = code >= 32 && code <= 126 ? TIMES_ASCII[code - 32] : TIMES_EXTRA[ch];
  if (w === undefined) throw new Error(`No Times-Roman width for "${ch}"`);
  return w;
}

const textWidth = (font, size, s) => ([...s].reduce((sum, ch) => sum + charWidth(font, ch), 0) * size) / 1000;

/** PDF literal string: WinAnsi bytes, non-ASCII as octal escapes so the file stays 7-bit. */
function pdfString(s) {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (code >= 32 && code <= 126) out += ch;
    else if (WIN_ANSI[ch] !== undefined) out += "\\" + WIN_ANSI[ch].toString(8).padStart(3, "0");
    else throw new Error(`Character "${ch}" is not in WinAnsiEncoding`);
  }
  return `(${out})`;
}

function wrap(font, size, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(font, size, next) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// Page geometry in pt, matching the prototype's page card (620 wide, 28/32 padding, 16.5/26 type).
const PAGE_W = 620;
const MARGIN_X = 32;
const MARGIN_TOP = 28;
const MARGIN_BOTTOM = 12;
const CONTENT_W = PAGE_W - 2 * MARGIN_X;
const STYLE = {
  eyebrow: { font: "F2", size: 12, leading: 16, after: 6, gray: 0.45 },
  h1: { font: "F1", size: 28, leading: 34, after: 14, gray: 0 },
  h2: { font: "F1", size: 22, leading: 28, after: 10, gray: 0 },
  p: { font: "F1", size: 16.5, leading: 26, after: 12, gray: 0 },
};

/** Lays out one page: returns its text lines (baseline from the top) and the content height. */
function layoutPage({ blocks }) {
  const lines = [];
  let y = MARGIN_TOP;
  blocks.forEach(([kind, text], i) => {
    const st = STYLE[kind];
    for (const line of wrap(st.font, st.size, text, CONTENT_W)) {
      // CSS-like line box: half-leading above the font's content area (ascent .891, descent .216).
      const baseline = y + (st.leading - 1.107 * st.size) / 2 + 0.891 * st.size;
      lines.push({ ...st, text: line, baseline });
      y += st.leading;
    }
    if (i < blocks.length - 1) y += st.after;
  });
  return { lines, height: y };
}

function makePdf() {
  const layouts = PAGES.map(layoutPage);
  const pageH = Math.ceil(Math.max(...layouts.map((l) => l.height)) + MARGIN_BOTTOM);

  const objects = []; // index = object number - 1
  const add = (body) => objects.push(body) && objects.length;

  const catalog = add(null); // filled in below
  const pages = add(null);
  const fTimes = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>");
  const fCourier = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title ${pdfString(TITLE)} /Author ${pdfString(AUTHOR)} /Producer (scripts/make-mock-docs.mjs) /CreationDate (D:20261021213000Z) >>`);

  const kids = [];
  for (const { lines } of layouts) {
    const ops = lines.map(
      (l) => `BT ${l.gray} g /${l.font} ${l.size} Tf ${MARGIN_X} ${(pageH - l.baseline).toFixed(2)} Td ${pdfString(l.text)} Tj ET`,
    );
    const stream = ops.join("\n");
    const contents = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${PAGE_W} ${pageH}] ` +
          `/Resources << /Font << /F1 ${fTimes} 0 R /F2 ${fCourier} 0 R >> >> /Contents ${contents} 0 R >>`,
      ),
    );
  }
  // Page labels make the viewer show the book's page numbers (41-44) instead of 1-4.
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R /Lang (de-DE) /PageLabels << /Nums [0 << /S /D /St ${FIRST_PAGE} >>] >> >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/* --------------------------------------------------------------------- EPUB */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SECTIONS = [
  { file: "chapter-2.xhtml", id: "ch2", title: "Chapter 2 · Chunking Strategies" },
  { file: "chapter-3.xhtml", id: "ch3", title: "Chapter 3 · Contextual Retrieval" },
  { file: "chapter-3-reranking.xhtml", id: "ch3b", title: "Reranking as a Second Stage" },
];

/*
 * Page anchors sit on the first block of each book page (id="page-N", data-page="N") rather than
 * on an empty pagebreak span: epubjs re-serialises sections into an HTML srcdoc, where an empty
 * self-closed <span/> would swallow the following content.
 */
function xhtml(section) {
  const body = PAGES.filter((p) => p.file === section.file)
    .flatMap(({ page, blocks }) =>
      blocks.map(([kind, text], i) => {
        const anchor = i === 0 ? ` id="page-${page}" data-page="${page}"` : "";
        if (kind === "eyebrow") return `<p class="eyebrow"${anchor}>${esc(text)}</p>`;
        return `<${kind}${anchor}>${esc(text)}</${kind}>`;
      }),
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
<meta charset="UTF-8"/>
<title>${esc(section.title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<section epub:type="chapter">
${body}
</section>
</body>
</html>
`;
}

const STYLE_CSS = `body { font-family: Georgia, "Times New Roman", serif; line-height: 1.6; }
h1, h2 { font-weight: normal; }
.eyebrow { font-family: monospace; font-size: 0.75em; margin: 0; }
`;

const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="UTF-8"/><title>Contents</title></head>
<body>
<nav epub:type="toc" id="toc">
<h1>Contents</h1>
<ol>
<li><a href="chapter-2.xhtml">${esc(SECTIONS[0].title)}</a></li>
<li><a href="chapter-3.xhtml">${esc(SECTIONS[1].title)}</a>
<ol><li><a href="chapter-3-reranking.xhtml">${esc(SECTIONS[2].title)}</a></li></ol>
</li>
</ol>
</nav>
<nav epub:type="page-list" id="page-list" hidden="hidden">
<ol>
${PAGES.map((p) => `<li><a href="${p.file}#page-${p.page}">${p.page}</a></li>`).join("\n")}
</ol>
</nav>
</body>
</html>
`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:6f1c2b9e-3a41-4c0e-9d2f-5b7a3e1c0d42</dc:identifier>
<dc:title>${esc(TITLE)}</dc:title>
<dc:creator>${esc(AUTHOR)}</dc:creator>
<dc:language>en</dc:language>
<meta property="dcterms:modified">2026-10-21T21:30:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
${SECTIONS.map((s) => `<item id="${s.id}" href="${s.file}" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest>
<spine>
${SECTIONS.map((s) => `<itemref idref="${s.id}"/>`).join("\n")}
</spine>
</package>
`;

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;

/** Minimal ZIP writer, store method only (EPUB requires `mimetype` stored and first anyway). */
function zip(entries) {
  // Fixed DOS timestamp (2026-10-21 21:30:00) keeps the output byte-identical between runs.
  const time = (21 << 11) | (30 << 5);
  const date = ((2026 - 1980) << 9) | (10 << 5) | 21;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length: none (required for mimetype)
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // extra, comment, disk start, internal and external attributes stay 0
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function makeEpub() {
  return zip([
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", CONTAINER],
    ["OEBPS/content.opf", OPF],
    ["OEBPS/nav.xhtml", NAV],
    ["OEBPS/style.css", STYLE_CSS],
    ...SECTIONS.map((s) => [`OEBPS/${s.file}`, xhtml(s)]),
  ]);
}

/* --------------------------------------------------------------------- main */

mkdirSync(OUT, { recursive: true });
const pdf = makePdf();
const epub = makeEpub();
writeFileSync(join(OUT, "ai-engineering-ch3.pdf"), pdf);
writeFileSync(join(OUT, "ai-engineering-ch3.epub"), epub);
console.log(`ai-engineering-ch3.pdf  ${pdf.length} bytes, ${PAGES.length} pages (book pages ${FIRST_PAGE}-${FIRST_PAGE + PAGES.length - 1})`);
console.log(`ai-engineering-ch3.epub ${epub.length} bytes, ${SECTIONS.length} sections`);
