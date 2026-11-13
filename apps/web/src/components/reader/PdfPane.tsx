"use client";

import { t } from "@/i18n";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { PDFDocumentLoadingTask, PDFPageProxy, TextLayer } from "pdfjs-dist";
import { buildIndex, findRange, lineBoxes, textInRange, type Box } from "./textIndex";
import type { ReaderTheme } from "./theme";
import type { Mark, PaneProps } from "./types";

/*
 * PDF side of the split reader: pdf.js pages rendered lazily into the prototype's page cards
 * (canvas + text layer), highlights painted as .kx-hl boxes over the canvas.
 * pdf.js is imported on demand inside effects, so SSR never evaluates it; the worker is emitted by
 * webpack as a static asset via new URL(..., import.meta.url).
 */

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return pdfjs;
  });
  return pdfjsPromise;
}

const CARD_MAX = 620;
const CARD_GAP = 24;
type Flash = { key: string; n: number } | null;

export function PdfPane({ doc, theme, initialPage, marks, onPage, onPageCount, onSelect, children, ref }: PaneProps) {
  const scroller = useRef<HTMLElement>(null);
  const cards = useRef(new Map<number, HTMLElement>());
  const [pages, setPages] = useState<PDFPageProxy[] | null>(null);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(0);
  const [flash, setFlash] = useState<Flash>(null);
  const cb = useRef({ onPage, onPageCount, onSelect });
  useEffect(() => {
    cb.current = { onPage, onPageCount, onSelect };
  });

  // Load the document and all page proxies (cheap: no rendering yet).
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    const url = doc.url.pdf;
    loadPdfJs()
      .then(async (pdfjs) => {
        if (cancelled) return;
        if (!url) throw new Error("PDF-URL fehlt");
        task = pdfjs.getDocument({ url, verbosity: pdfjs.VerbosityLevel.ERRORS });
        const pdf = await task.promise;
        if (!cancelled) cb.current.onPageCount?.(pdf.numPages);
        const all = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
        if (!cancelled) setPages(all);
      })
      .catch((err: unknown) => {
        console.error("[reader] PDF konnte nicht geladen werden", err);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      void (task as PDFDocumentLoadingTask | null)?.destroy();
    };
  }, [doc.url.pdf]);

  // Card width follows the pane (prototype: max-width 620 inside 32px side padding).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.floor(Math.min(CARD_MAX, el.clientWidth - 64))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const currentPage = useRef(initialPage);
  const updatePage = useCallback(() => {
    const el = scroller.current;
    if (!el || !cards.current.size) return;
    const probe = el.scrollTop + el.clientHeight * 0.35;
    let page = doc.firstPage;
    for (const [p, card] of cards.current) if (card.offsetTop <= probe && p > page) page = p;
    // Scrolled to the end: the last rendered page (doc.lastPage is unknown for some live PDFs).
    if (el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) page = Math.max(...cards.current.keys());
    if (page !== currentPage.current) {
      currentPage.current = page;
      cb.current.onPage(page);
    }
  }, [doc.firstPage]);

  // Restore the reading position once the cards have their size.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !pages || !width) return;
    const card = cards.current.get(initialPage);
    if (card && scroller.current) scroller.current.scrollTop = card.offsetTop - 28;
    restored.current = true;
  }, [pages, width, initialPage]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1000);
    return () => clearTimeout(t);
  }, [flash]);

  useImperativeHandle(
    ref,
    () => ({
      goTo(page, mark) {
        const el = scroller.current;
        const card = cards.current.get(page);
        if (!el || !card) return;
        const box = mark ? el.querySelector<HTMLElement>(`[data-mark="${CSS.escape(mark.id)}"]`) : null;
        const target = box ?? card;
        const offset = box ? el.clientHeight / 3 : 28;
        const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - offset;
        el.scrollTo({ top, behavior: "smooth" });
        setFlash({ key: mark ? mark.id : `page-${page}`, n: Date.now() });
      },
    }),
    [],
  );

  // Selection: read it when a drag or keyboard selection ends inside the text layers.
  const selecting = useRef(false);
  const readSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return cb.current.onSelect(null);
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const start = node instanceof Element ? node : node.parentElement;
    const card = start?.closest<HTMLElement>("[data-page]");
    const layer = card?.querySelector(".textLayer");
    if (!card || !layer || !scroller.current?.contains(card)) return cb.current.onSelect(null);
    const text = textInRange(buildIndex(layer, (t) => t.parentElement), range);
    if (text.length < 2) return cb.current.onSelect(null);
    cb.current.onSelect({
      text,
      page: Number(card.dataset.page),
      rect: () => range.getBoundingClientRect(),
      clear: () => window.getSelection()?.removeAllRanges(),
    });
  }, []);

  useEffect(() => {
    const up = () => {
      if (!selecting.current) return;
      selecting.current = false;
      scroller.current?.querySelectorAll(".textLayer.selecting").forEach((l) => l.classList.remove("selecting"));
      setTimeout(readSelection, 0);
    };
    document.addEventListener("pointerup", up);
    return () => document.removeEventListener("pointerup", up);
  }, [readSelection]);

  return (
    <section
      ref={scroller}
      className="kx-pane kx-scroll"
      aria-label={t("Book page")}
      style={{ background: "var(--bg-surface-muted)", padding: "28px 32px 64px" }}
      onScroll={updatePage}
      onPointerDown={(e) => {
        if ((e.target as Element).closest(".kx-seltool")) return;
        cb.current.onSelect(null);
        selecting.current = true;
        // pdf.js trick: stretch .endOfContent while selecting so the selection doesn't jump.
        (e.target as Element).closest(".textLayer")?.classList.add("selecting");
      }}
      onKeyUp={(e) => {
        if (e.shiftKey) readSelection();
      }}
    >
      {error && <div className="kx-help">{t("Could not load the PDF.")}</div>}
      {!error && !pages && (
        <div className="kx-help" role="status" style={{ textAlign: "center", paddingTop: 40 }}>
          {t("Loading PDF…")}
        </div>
      )}
      {pages &&
        width > 0 &&
        pages.map((page, i) => {
          const bookPage = i + 1 + doc.pageOffset;
          return (
            <PdfPage
              key={i}
              page={page}
              bookPage={bookPage}
              width={width}
              theme={theme}
              marks={marks}
              flash={flash}
              last={i === pages.length - 1}
              cardRef={(el) => {
                if (el) cards.current.set(bookPage, el);
                else cards.current.delete(bookPage);
              }}
            />
          );
        })}
      {children}
    </section>
  );
}

interface PageProps {
  page: PDFPageProxy;
  bookPage: number;
  width: number;
  theme: ReaderTheme;
  marks: Mark[];
  flash: Flash;
  last: boolean;
  cardRef: (el: HTMLElement | null) => void;
}

interface MarkBoxes {
  mark: Mark;
  boxes: Box[];
}

function PdfPage({ page, bookPage, width, theme, marks, flash, last, cardRef }: PageProps) {
  const card = useRef<HTMLElement | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const canvasHolder = useRef<HTMLDivElement>(null);
  const textHolder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [textReady, setTextReady] = useState(0);
  const [painted, setPainted] = useState<MarkBoxes[]>([]);

  const base = page.getViewport({ scale: 1 });
  const scale = width / base.width;
  const height = Math.round(base.height * scale);

  // Render only once the card comes near the viewport.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: el.closest(".kx-scroll"), rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let textLayer: TextLayer | null = null;
    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    // Fresh canvas per render: pdf.js refuses a canvas that another render still holds, and the
    // old page stays visible until the new one is ready (no flicker on resize or theme change).
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.cssText = "display:block;width:100%;height:100%";
    canvas.setAttribute("aria-hidden", "true");
    const task = page.render({
      canvas,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      // Recolour the page to the card's theme (pdf.js high-contrast filter).
      pageColors: { background: theme.surface, foreground: theme.fg },
    });
    task.promise
      .then(async () => {
        if (cancelled) return;
        canvasHolder.current?.replaceChildren(canvas);
        const { TextLayer } = await loadPdfJs();
        const layer = document.createElement("div");
        layer.className = "textLayer";
        textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
        await textLayer.render();
        if (cancelled) return;
        const end = document.createElement("div");
        end.className = "endOfContent";
        layer.append(end);
        textHolder.current?.replaceChildren(layer);
        setTextReady((n) => n + 1);
      })
      .catch((err: unknown) => {
        if (!cancelled && (err as { name?: string })?.name !== "RenderingCancelledException") console.error("[reader] Seite", bookPage, err);
      });
    return () => {
      cancelled = true;
      task.cancel();
      textLayer?.cancel();
    };
  }, [visible, page, scale, theme, bookPage]);

  // Paint stored passages: find their text in this page's text layer, one box per line.
  const pageMarks = marks.filter((m) => m.page === bookPage);
  const marksKey = pageMarks.map((m) => `${m.id}:${m.kind}`).join("|");
  useLayoutEffect(() => {
    const layer = textHolder.current?.firstElementChild;
    const origin = sheet.current?.getBoundingClientRect();
    if (!textReady || !layer || !origin) return;
    const index = buildIndex(layer, (t) => t.parentElement);
    const next: MarkBoxes[] = [];
    for (const mark of pageMarks) {
      const range = findRange(index, mark.text);
      if (range) next.push({ mark, boxes: lineBoxes(range, origin) });
    }
    setPainted(next);
    // pageMarks is derived from marks; marksKey captures its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textReady, marksKey]);

  const sheetStyle = {
    position: "relative",
    width,
    height,
    "--total-scale-factor": scale,
    "--scale-round-x": "1px",
    "--scale-round-y": "1px",
  } as CSSProperties;

  return (
    <article
      ref={(el) => {
        card.current = el;
        cardRef(el);
      }}
      data-page={bookPage}
      aria-label={t("Page {page}", { page: bookPage })}
      className={`kx-reader-page${flash?.key === `page-${bookPage}` ? " kx-flash" : ""}`}
      style={{
        width,
        margin: last ? "0 auto" : `0 auto ${CARD_GAP}px`,
        borderRadius: 12,
        background: "var(--bg-surface-flat)",
        boxShadow: "var(--shadow-card)",
        color: "var(--text-primary)",
      }}
    >
      <div ref={sheet} style={sheetStyle}>
        <div ref={canvasHolder} style={{ position: "absolute", inset: 0, borderRadius: "12px 12px 0 0", overflow: "hidden" }} />
        <div className="kx-reader-marks" aria-hidden="true">
          {painted.flatMap(({ mark, boxes }) =>
            boxes.map((b, i) => (
              <div
                key={`${mark.id}-${i}-${flash?.key === mark.id ? flash.n : 0}`}
                data-mark={i === 0 ? mark.id : undefined}
                className={[mark.kind === "hl" ? "kx-hl" : "", flash?.key === mark.id ? "kx-flash" : ""].join(" ")}
                style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
              />
            )),
          )}
        </div>
        <div ref={textHolder} />
      </div>
      <div className="kx-num" style={{ padding: "8px 0 24px", textAlign: "center", color: "var(--text-muted)" }}>
        [p. {bookPage}]
      </div>
    </article>
  );
}
