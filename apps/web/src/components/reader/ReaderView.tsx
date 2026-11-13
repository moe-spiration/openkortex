"use client";

import { t } from "@/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ico } from "@/components/shell/icons";
import { getReaderFileUrl } from "@/lib/api/reader-actions";
import { useNote } from "@/lib/notes/store";
import { useShell } from "@/lib/shell/store";
import { isLiveData } from "@/lib/workspace-data";
import { EpubPane } from "./EpubPane";
import { NotePane } from "./NotePane";
import { PdfPane } from "./PdfPane";
import { SelTool } from "./SelTool";
import { liveReaderDoc } from "./liveDoc";
import { readerDoc, type ReaderDoc, type ReaderFormat, type ReaderHighlight } from "./mockDoc";
import { useReaderTheme } from "./theme";
import type { Mark, PaneHandle, ReaderSelection } from "./types";
import { useReaderStore } from "./useReaderStore";
import "./reader.css";

/*
 * Split-screen reader (design/reference/Reader.dc.html): document left (pdf.js or epubjs), the
 * linked Markdown note right. Selections become item_highlights with a page anchor [S. X]; the
 * reading position is kept as reading_state (useReaderStore). The mock document (mockDoc.ts) opens
 * in mock mode; live, any pdf/epub item with a stored original opens (liveDoc.ts), its file URL
 * signed on demand by the getReaderFileUrl server action.
 */

export function ReaderView({ id }: { id: string }) {
  const item = useNote(id);
  const mock = readerDoc(id);
  const built = !mock && item && isLiveData() ? liveReaderDoc(item) : null;
  // Rebuilt only when the document itself changes, not on every edit of the note.
  const key = built ? JSON.stringify(built) : "";
  const doc = useMemo(() => mock ?? (key ? (JSON.parse(key) as ReaderDoc) : null), [mock, key]);
  if (!doc) return null;
  return <Reader key={id} doc={doc} />;
}

/** The document with its URL: the mock files as they are, a live file once its URL is signed. */
function useLoadedDoc(doc: ReaderDoc): { loaded: ReaderDoc | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!doc.live) return;
    let alive = true;
    void getReaderFileUrl(doc.noteId)
      .catch((err: unknown) => ({ ok: false as const, error: String(err) }))
      .then((res) => {
        if (!alive) return;
        if (res.ok) setUrl(res.data.url);
        else {
          console.warn("[kortex] Dokument nicht ladbar:", res.error);
          setFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [doc]);
  const loaded = useMemo(() => {
    if (!doc.live) return doc;
    const format = doc.formats[0];
    return url && format ? { ...doc, url: { [format]: url } } : null;
  }, [doc, url]);
  return { loaded, failed };
}

function Reader({ doc: base }: { doc: ReaderDoc }) {
  const id = base.noteId;
  const { loaded, failed } = useLoadedDoc(base);
  const doc = loaded ?? base;
  const note = useNote(id);
  const { showToast } = useShell();
  const theme = useReaderTheme();
  // Live PDFs without page_count learn it from pdf.js.
  const [pdfPages, setPdfPages] = useState(0);
  const totalPages = doc.totalPages || pdfPages;
  const { ready, entries, reading, add, locate } = useReaderStore(base, totalPages);
  const pane = useRef<PaneHandle>(null);
  const [sel, setSel] = useState<ReaderSelection | null>(null);
  const [explainRun, setExplainRun] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const format = reading.format;
  const noteFile = note?.path.split("/").pop() ?? "";
  const marks = useMemo<Mark[]>(
    () => entries.map((e) => ({ id: e.id, text: e.text, page: e.page, cfi: e.cfi, kind: e.note ? "note" : "hl" })),
    [entries],
  );

  const selRef = useRef(sel);
  useEffect(() => {
    selRef.current = sel;
  }, [sel]);
  const closeSel = useCallback(() => {
    selRef.current?.clear();
    setSel(null);
  }, []);

  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sel, closeSel]);

  useEffect(() => {
    if (!syncing) return;
    const t = setTimeout(() => setSyncing(false), 700);
    return () => clearTimeout(t);
  }, [syncing]);

  const save = (entry: Omit<ReaderHighlight, "id" | "createdAt">, toast: string) => {
    add(entry);
    setSyncing(true);
    showToast(toast);
    closeSel();
  };

  const setFormat = (f: ReaderFormat) => {
    if (f === format) return;
    closeSel();
    // The other format opens at the same book page; its own CFI is re-derived from there.
    locate({ format: f, cfi: undefined });
  };

  const onPage = useCallback(
    (page: number, cfi?: string, progress?: number) => locate(cfi ? { page, cfi } : { page }, progress),
    [locate],
  );
  const jump = (page: number, entry?: ReaderHighlight) => {
    const mark = entry && marks.find((m) => m.id === entry.id);
    pane.current?.goTo(page, mark);
  };

  const tool = sel && (
    <SelTool
      key={`${sel.page}:${sel.text}`}
      sel={sel}
      onClose={closeSel}
      onHighlight={() => save({ text: sel.text, page: sel.page, cfi: sel.cfi }, t("Highlight saved in {file}", { file: noteFile }))}
      onNote={(text) => save({ text: sel.text, note: text, page: sel.page, cfi: sel.cfi }, t("Note created at the page anchor"))}
      onExplain={
        doc.explanation
          ? () => {
              setExplainRun((n) => n + 1);
              closeSel();
            }
          : undefined
      }
    />
  );

  const paneProps = {
    ref: pane,
    doc,
    marks,
    initialPage: reading.page,
    initialCfi: reading.cfi,
    onPage,
    onPageCount: setPdfPages,
    onSelect: setSel,
    children: tool,
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-main-window)", color: "var(--text-primary)", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: 48, padding: "0 16px", flex: "none", boxShadow: "inset 0 -1px 0 0 var(--border-subtle)" }}>
        <nav className="kx-crumbs" aria-label={t("Path")} style={{ flex: 1, minWidth: 0 }}>
          <span style={{ padding: "0 6px" }}>{doc.folder}</span>
          <Ico name="chev-r" className="kx-sep" />
          <span aria-current="page" style={{ padding: "0 6px" }}>
            {doc.fileName[format]}
          </span>
        </nav>
        <span className="kx-pill kx-pill--sm kx-pill--nodot" title={t("Reading progress {percent} %", { percent: Math.round(reading.progress * 100) })}>
          {!doc.paged
            ? `${Math.round(reading.progress * 100)} %`
            : totalPages
              ? t("[p. {page} / {total}]", { page: reading.page, total: totalPages })
              : t("[p. {page}]", { page: reading.page })}
        </span>
        <div className="kx-tabs kx-tabs--sm" role="tablist" aria-label={t("Format")}>
          {doc.formats.map((f) => (
            <button key={f} type="button" className="kx-tab" role="tab" aria-selected={format === f} onClick={() => setFormat(f)}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        {syncing ? (
          <span className="kx-sync kx-sync--busy" role="status">
            <span className="kx-spinner" aria-hidden="true" />
            {t("Syncing")}
          </span>
        ) : (
          <span className="kx-sync kx-sync--ok">
            <Ico name="sync" />
            {t("Note in sync")}
          </span>
        )}
      </div>

      <div className="kx-split" style={{ flex: 1, minHeight: 0 }}>
        {failed ? (
          <section className="kx-pane" aria-label={t("Book page")} style={{ background: "var(--bg-surface-muted)" }}>
            <div className="kx-help" role="status" style={{ textAlign: "center", paddingTop: 40 }}>
              {t("Could not load the document.")}
            </div>
          </section>
        ) : !ready || !theme || !loaded ? (
          <section className="kx-pane" aria-label={t("Book page")} aria-busy="true" style={{ background: "var(--bg-surface-muted)" }} />
        ) : format === "pdf" ? (
          <PdfPane key="pdf" theme={theme} {...paneProps} />
        ) : (
          <EpubPane key="epub" theme={theme} {...paneProps} />
        )}
        <NotePane doc={doc} entries={entries} explainRun={explainRun} onJump={jump} />
      </div>
    </div>
  );
}
