import type { ReactNode, Ref } from "react";
import type { ReaderDoc } from "./mockDoc";
import type { ReaderTheme } from "./theme";

/** A text selection in the document pane, as the selection toolbar needs it. */
export interface ReaderSelection {
  text: string;
  /** Book page the selection starts on. */
  page: number;
  cfi?: string;
  /** Current viewport rect of the selection (it moves when the document scrolls). */
  rect: () => DOMRect | null;
  clear: () => void;
}

/** A stored passage painted in the document: a highlight, or a note anchor (only flashed). */
export interface Mark {
  id: string;
  text: string;
  page: number;
  cfi?: string;
  kind: "hl" | "note";
}

export interface PaneHandle {
  /** Scrolls to the book page (or the mark on it) and flashes the target. */
  goTo: (page: number, mark?: Mark) => void;
}

export interface PaneProps {
  doc: ReaderDoc;
  theme: ReaderTheme;
  /** Position to open at; only read on mount. */
  initialPage: number;
  initialCfi?: string;
  marks: Mark[];
  /** `progress` (0..1) is only reported where pages can't express it (EPUB without page anchors). */
  onPage: (page: number, cfi?: string, progress?: number) => void;
  /** PDF: the page count once pdf.js has opened the document. */
  onPageCount?: (pages: number) => void;
  onSelect: (sel: ReaderSelection | null) => void;
  /** Rendered inside the pane (the selection toolbar positions itself against it). */
  children?: ReactNode;
  ref?: Ref<PaneHandle>;
}
