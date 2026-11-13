"use client";

import { t } from "@/i18n";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Book, Contents, Rendition } from "epubjs";
import { buildIndex, findRange, textInRange } from "./textIndex";
import { fontFaceCss, type ReaderTheme } from "./theme";
import type { PaneProps } from "./types";

/*
 * EPUB side of the split reader: an epubjs rendition (continuous scrolled flow) in the left pane,
 * themed like the prototype's EPUB view (v2: Geist 17/28 reading text, headings on the H1/H2 scale, max-width 560). epubjs is imported
 * inside the effect, so SSR never touches it. Page numbers come from the anchors the mock EPUB
 * carries on the first block of every book page (id="page-N", data-page="N"). Live EPUBs have no
 * anchors (doc.paged false): the position is the CFI and progress comes from the location.
 */

const PAGE_ANCHOR = "[data-page]";

function themeCss(t: ReaderTheme): string {
  return `${fontFaceCss(t.sans, t.mono)}
html, body { background: transparent !important; }
body {
  color: ${t.fg} !important;
  font-family: ${t.sans} !important;
  font-size: 15px !important; line-height: 1.7 !important; font-weight: 400; letter-spacing: 0;
  max-width: 560px !important; margin: 0 auto !important; padding: 36px 44px 32px !important;
  box-sizing: content-box !important; -webkit-font-smoothing: antialiased;
}
h1 { font-family: inherit; font-size: 24px; line-height: 1.15; font-weight: 500; letter-spacing: -0.015em; margin: 0 0 14px; }
h2 { font-family: inherit; font-size: 15px; line-height: 1.5; font-weight: 500; letter-spacing: -0.01em; margin: 18px 0 10px; }
h1:first-child, h2:first-child { margin-top: 0; }
p { margin: 0 0 12px; }
.eyebrow { font-family: inherit; font-size: 11px; line-height: 1.4; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: ${t.muted}; margin: 0 0 6px; }
::selection { background: ${t.accentSoft}; }
@keyframes kxflash { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 40% { box-shadow: 0 0 0 4px ${t.hl}; } }
.kx-flash { animation: kxflash 900ms cubic-bezier(0.2, 0.8, 0.2, 1) 1; border-radius: 4px; }
`;
}

const contentsOf = (r: Rendition) => r.getContents() as unknown as Contents[];

/** Book page of a DOM position: the last page anchor at or before it. */
function pageOf(node: Node, doc: Document): number | null {
  let page: number | null = null;
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>(PAGE_ANCHOR))) {
    if (el === node || el.contains(node) || el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) page = Number(el.dataset.page);
  }
  return page;
}

export function EpubPane({ doc, theme, initialPage, initialCfi, marks, onPage, onSelect, children, ref }: PaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const [rendition, setRendition] = useState<Rendition | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const painted = useRef(new Map<string, string>()); // mark id -> CFI
  const live = useRef({ onPage, onSelect, marks, theme });
  useEffect(() => {
    live.current = { onPage, onSelect, marks, theme };
  });
  const start = useRef({ page: initialPage, cfi: initialCfi });

  // Paint highlights; marks without a CFI (seeded or made in the PDF) are found by their text.
  const paint = useRef((r: Rendition) => {
    for (const mark of live.current.marks) {
      if (mark.kind !== "hl" || painted.current.has(mark.id)) continue;
      const cfi = mark.cfi ?? findCfi(r, mark.text);
      if (!cfi) continue;
      r.annotations.highlight(cfi, { id: mark.id }, undefined, "kx-epub-hl", {
        fill: live.current.theme.hl,
        "fill-opacity": "0.32",
        "mix-blend-mode": "normal",
      });
      painted.current.set(mark.id, cfi);
    }
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let book: Book | null = null;
    const paintedMarks = painted.current;
    const anchors = doc.epubAnchors;
    let lastCfi: string | undefined;
    let lastPage = start.current.page;
    // Position reports wait until the restored target is scrolled into place.
    let positioned = false;

    const reportPage = (r: Rendition) => {
      if (!positioned) return;
      const top = el.getBoundingClientRect().top + el.clientHeight * 0.35;
      let page: number | null = null;
      for (const c of contentsOf(r)) {
        const frame = c.window?.frameElement;
        if (!frame) continue;
        const offset = frame.getBoundingClientRect().top;
        for (const a of Array.from(c.document.querySelectorAll<HTMLElement>(PAGE_ANCHOR))) {
          const p = Number(a.dataset.page);
          if (offset + a.getBoundingClientRect().top <= top && (page === null || p > page)) page = p;
        }
      }
      page ??= doc.firstPage;
      const box = el.querySelector(".epub-container");
      if (doc.lastPage && box && box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 2) page = doc.lastPage;
      if (page !== lastPage) {
        lastPage = page;
        live.current.onPage(page, lastCfi);
      }
    };

    (async () => {
      const { default: ePub } = await import("epubjs");
      if (cancelled) return;
      if (!doc.url.epub) throw new Error("EPUB-URL fehlt");
      book = ePub(doc.url.epub, { openAs: "epub" });
      const opened = book;
      const r = book.renderTo(el, { width: "100%", height: "100%", flow: "scrolled", manager: "continuous", spread: "none" });
      r.themes.registerCss("kx", themeCss(live.current.theme));
      r.themes.select("kx");
      r.on("rendered", () => paint.current(r));
      r.on("relocated", (loc: { start?: { cfi?: string; index?: number; percentage?: number } }) => {
        lastCfi = loc.start?.cfi;
        if (!positioned) return;
        live.current.onPage(lastPage, lastCfi, doc.paged ? undefined : progressOf(opened, loc.start));
        reportPage(r);
      });
      r.on("selected", (cfiRange: string, contents: Contents) => {
        const range = contents.range(cfiRange);
        const text = textInRange(buildIndex(contents.document.body), range);
        if (text.length < 2) return;
        const frame = contents.window.frameElement;
        live.current.onSelect({
          text,
          cfi: cfiRange,
          page: pageOf(range.startContainer, contents.document) ?? lastPage,
          rect: () => {
            const f = frame?.getBoundingClientRect();
            const b = range.getBoundingClientRect();
            return f ? new DOMRect(b.left + f.left, b.top + f.top, b.width, b.height) : null;
          },
          clear: () => contents.window.getSelection()?.removeAllRanges(),
        });
      });
      r.on("mousedown", () => live.current.onSelect(null));
      r.on("keydown", (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        for (const c of contentsOf(r)) c.window.getSelection()?.removeAllRanges();
        live.current.onSelect(null);
      });
      const target = start.current.cfi ?? anchors[start.current.page];
      await r.display(target);
      await settle();
      if (cancelled) return;
      reveal(r, el, start.current.cfi ? { cfi: start.current.cfi } : { page: start.current.page });
      el.querySelector(".epub-container")?.classList.add("kx-scroll");
      el.addEventListener("scroll", () => reportPage(r), { capture: true, passive: true });
      positioned = true;
      reportPage(r);
      setRendition(r);
      setStatus("ready");
    })().catch((err: unknown) => {
      console.error("[reader] EPUB konnte nicht geladen werden", err);
      if (!cancelled) setStatus("error");
    });

    return () => {
      cancelled = true;
      paintedMarks.clear();
      book?.destroy();
      el.replaceChildren();
    };
  }, [doc]);

  // Theme switch: re-register the injected CSS, re-colour painted highlights via CSS (reader.css).
  useEffect(() => {
    if (!rendition) return;
    rendition.themes.registerCss("kx", themeCss(theme));
    rendition.themes.select("kx");
  }, [rendition, theme]);

  useEffect(() => {
    if (rendition) paint.current(rendition);
  }, [rendition, marks]);

  useImperativeHandle(
    ref,
    () => ({
      goTo(page, mark) {
        const r = rendition;
        if (!r) return;
        const cfi = mark ? (painted.current.get(mark.id) ?? mark.cfi ?? findCfi(r, mark.text)) : undefined;
        const target = cfi ?? doc.epubAnchors[page];
        if (!target) return;
        const el = host.current;
        void r
          .display(target)
          .then(settle)
          .then(() => {
            if (!el) return;
            reveal(r, el, cfi ? { cfi } : { page });
            flash(r, el, page, cfi, mark?.id);
          });
      },
    }),
    [rendition, doc],
  );

  return (
    <section className="kx-pane" aria-label={t("Book page")} style={{ background: "var(--bg-surface-muted)", padding: 0 }}>
      <div ref={host} className="kx-epub-host" style={{ height: "100%" }} />
      {status !== "ready" && (
        <div className="kx-help" role="status" style={{ position: "absolute", inset: "40px 0 auto", textAlign: "center" }}>
          {status === "error" ? t("Could not load the EPUB.") : t("Loading EPUB…")}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Reading progress (0..1) of an EPUB without page anchors: epubjs' percentage when locations exist,
 * otherwise the position of the current section in the spine.
 */
function progressOf(book: Book, start: { index?: number; percentage?: number } | undefined): number | undefined {
  if (!start) return undefined;
  if (typeof start.percentage === "number" && start.percentage > 0) return Math.min(1, start.percentage);
  const sections = (book.spine as unknown as { length?: number }).length;
  if (typeof start.index !== "number" || !sections) return undefined;
  return Math.min(1, start.index / sections);
}

/** Lets the continuous manager finish adding the neighbouring sections before measuring. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 250));

/*
 * Scrolls the target into the pane. rendition.display(href#anchor) lands on the section start
 * once neighbouring sections get prepended, so the final position is taken from the DOM.
 */
function reveal(r: Rendition, host: HTMLElement, target: { page: number } | { cfi: string }) {
  const container = host.querySelector<HTMLElement>(".epub-container");
  if (!container) return;
  for (const c of contentsOf(r)) {
    const frame = c.window?.frameElement;
    if (!frame) continue;
    let rect: DOMRect | undefined;
    if ("cfi" in target) {
      const base = (c as unknown as { cfiBase?: string }).cfiBase;
      if (!base || !target.cfi.includes(`${base}!`)) continue;
      try {
        rect = c.range(target.cfi)?.getBoundingClientRect();
      } catch {
        continue;
      }
    } else rect = c.document.getElementById(`page-${target.page}`)?.getBoundingClientRect();
    if (!rect) continue;
    const offset = frame.getBoundingClientRect().top + rect.top - container.getBoundingClientRect().top;
    container.scrollTop += offset - ("cfi" in target ? container.clientHeight / 3 : 24);
    return;
  }
}

function findCfi(r: Rendition, text: string): string | undefined {
  for (const c of contentsOf(r)) {
    const range = findRange(buildIndex(c.document.body), text);
    if (range) return c.cfiFromRange(range);
  }
  return undefined;
}

/** Flashes the passage (temporary underline) or the page's anchor block. */
/** Flashes the painted highlight, a temporary mark over a note's passage, or the page's anchor block. */
function flash(r: Rendition, host: HTMLElement, page: number, cfi: string | undefined, markId: string | undefined) {
  const restart = (el: Element, cls: string) => {
    el.classList.remove(cls);
    void (el as HTMLElement).getBoundingClientRect(); // restart the animation
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 1000);
  };
  const painted = markId ? host.querySelector(`g.kx-epub-hl[data-id="${CSS.escape(markId)}"]`) : null;
  if (painted) return restart(painted, "kx-epub-flash");
  if (cfi) {
    r.annotations.highlight(cfi, {}, undefined, "kx-epub-flash");
    setTimeout(() => r.annotations.remove(cfi, "highlight"), 1000);
    return;
  }
  for (const c of contentsOf(r)) {
    const el = c.document.getElementById(`page-${page}`);
    if (el) restart(el, "kx-flash");
  }
}
