"use client";

import { t, tx } from "@/i18n";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Ico } from "@/components/shell/icons";
import type { ReaderSelection } from "./types";

/*
 * Selection toolbar (.kx-seltool) above the selected passage: Highlight / Notiz / Erklären.
 * "Notiz" swaps the buttons for an inline field; the note is saved with the passage's page anchor.
 * Positions itself against its offset parent (the document pane) and follows the scrolling.
 */

const OFFSET = 46; // prototype: top -46px over the passage

export function SelTool({
  sel,
  onHighlight,
  onNote,
  onExplain,
  onClose,
}: {
  sel: ReaderSelection;
  onHighlight: () => void;
  onNote: (text: string) => void;
  /** Omitted: no "Erklären" button (live documents have no explanation yet). */
  onExplain?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [mode, setMode] = useState<"actions" | "note">("actions");
  const [draft, setDraft] = useState("");

  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.offsetParent as HTMLElement | null;
    if (!el || !box) return;
    const place = () => {
      const r = sel.rect();
      if (!r) return setPos(null);
      const b = box.getBoundingClientRect();
      const above = r.top - b.top >= OFFSET + 6;
      const top = (above ? r.top - b.top - OFFSET : r.bottom - b.top + 8) + box.scrollTop;
      const maxLeft = box.scrollLeft + box.clientWidth - el.offsetWidth - 8;
      const left = Math.max(8, Math.min(r.left - b.left + box.scrollLeft, maxLeft));
      setPos({ left, top });
    };
    place();
    box.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    return () => {
      box.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  }, [sel, mode]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim()) onNote(draft.trim());
  };

  return (
    <div
      ref={ref}
      className="kx-seltool kx-in"
      role="toolbar"
      aria-label={t("Selection")}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      // Keep the document selection while clicking the buttons.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {mode === "actions" ? (
        <>
          <button type="button" className="kx-btn kx-btn--ghost" onClick={onHighlight}>
            <Ico name="highlighter" />
            {t("Highlight")}
          </button>
          <button type="button" className="kx-btn kx-btn--ghost" onClick={() => setMode("note")}>
            <Ico name="message" />
            {t("Note")}
          </button>
          {onExplain && (
            <button type="button" className="kx-btn kx-btn--ghost" onClick={onExplain}>
              <Ico name="sparkles" />
              {t("Explain")}
            </button>
          )}
        </>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <input
            autoFocus
            className="kx-input"
            aria-label={t("Note on page {page}", { page: sel.page })}
            placeholder={t("Note on p. {page}…", { page: sel.page })}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: 240, height: 28, padding: "0 8px", fontSize: "calc(13px * var(--kx-fs, 1))" }}
          />
          <button type="submit" className="kx-btn kx-btn--ghost" disabled={!draft.trim()}>
            <Ico name="check" />
            {tx("reader", "Save")}
          </button>
        </form>
      )}
    </div>
  );
}
