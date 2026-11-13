"use client";

import { t } from "@/i18n";
import { useEffect, useState } from "react";
import { Ico } from "@/components/shell/icons";
import { useNote } from "@/lib/notes/store";
import { useShell } from "@/lib/shell/store";
import { pillClass } from "@/lib/workspace-data";
import type { ReaderDoc, ReaderHighlight } from "./mockDoc";

/*
 * Right half of the split reader: the linked Markdown note (Reader.dc.html, section "Notiz").
 * Highlights and own notes come from item_highlights with their page anchor [S. X]; clicking an
 * anchor scrolls the document there and flashes the passage.
 */

const anchorStyle = { color: "var(--text-muted)", fontSize: "calc(12px * var(--kx-fs, 1))" } as const;

/** Page anchor [S. X]; documents without page numbers (live EPUB) jump to the passage instead. */
function Anchor({ page, paged, onClick }: { page: number; paged: boolean; onClick: () => void }) {
  const label = paged ? t("Jump to page {page}", { page }) : t("Jump to the passage");
  return (
    <button type="button" className="kxb kx-num" style={anchorStyle} onClick={onClick} title={label} aria-label={label}>
      {paged ? t("[p. {page}]", { page }) : t("[passage]")}
    </button>
  );
}

export function NotePane({
  doc,
  entries,
  explainRun,
  onJump,
}: {
  doc: ReaderDoc;
  entries: ReaderHighlight[];
  /** Changes on every "Erklären"; 0 = callout hidden. */
  explainRun: number;
  onJump: (page: number, entry?: ReaderHighlight) => void;
}) {
  const note = useNote(doc.noteId);
  const { openNote } = useShell();
  const highlights = entries.filter((e) => !e.note);
  const notes = entries.filter((e) => e.note);
  const fileName = note?.path.split("/").pop() ?? "";
  const tag = note?.tags[0];

  return (
    <section className="kx-pane kx-scroll" aria-label={t("Note")} style={{ padding: "24px 32px 64px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Ico name="i-note" style={{ color: "var(--accent-ai)" }} />
        <button type="button" className="kxb kx-num" style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }} title={t("Open note")} onClick={() => openNote(doc.noteId)}>
          {fileName}
        </button>
        {tag && <span className={`kx-pill kx-pill--sm ${pillClass(tag)}`}>{tag}</span>}
      </div>

      {note?.tldr && (
        <div className="kx-callout">
          <div className="kx-callout-head">
            <Ico name="sparkles" size="sm" />
            {t("AI chapter synthesis")}
          </div>
          {note.tldr}
        </div>
      )}

      {doc.paged && (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="kx-btn kx-btn--secondary" onClick={() => onJump(doc.anchorPage)}>
            Springe zu Seite {doc.anchorPage}
            <Ico name="up-right" />
          </button>
        </div>
      )}

      <h2 className="kx-ed-h2">{t("Highlights")}</h2>
      {highlights.length ? (
        <div style={{ display: "grid", gap: 8 }}>
          {highlights.map((h) => (
            <div key={h.id} className="kx-quote kx-in" style={{ margin: 0 }}>
              <Anchor page={h.page} paged={doc.paged} onClick={() => onJump(h.page, h)} /> {h.text}
            </div>
          ))}
        </div>
      ) : (
        <p className="kx-help" style={{ margin: 0 }}>
          {t("No highlights yet. Select a passage in the document.")}
        </p>
      )}

      {notes.length > 0 && (
        <>
          <h2 className="kx-ed-h2">{t("Your notes")}</h2>
          <ul className="kx-ed-ul">
            {notes.map((n) => (
              <li key={n.id} className="kx-in" title={`„${n.text}“`}>
                {n.note} <Anchor page={n.page} paged={doc.paged} onClick={() => onJump(n.page, n)} />
              </li>
            ))}
          </ul>
        </>
      )}

      {explainRun > 0 && doc.explanation && <Explain key={explainRun} text={doc.explanation} />}
    </section>
  );
}

/** "Erklärt in einfachen Worten": the mock answer streams in character by character. */
function Explain({ text }: { text: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setShown((n) => (n >= text.length ? n : n + 2)), 16);
    return () => clearInterval(t);
  }, [text]);
  const done = shown >= text.length;
  return (
    <div className="kx-callout kx-in" style={{ marginTop: 16 }} aria-live="polite" aria-busy={!done}>
      <div className="kx-callout-head">
        <Ico name="sparkles" size="sm" />
        {t("Explained in simple words")}
      </div>
      {text.slice(0, shown)}
      {!done && <span className="kx-caret" />}
    </div>
  );
}
