"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listHighlights, saveHighlight, saveReadingState, type StoredHighlight } from "@/lib/api/actions";
import { isLiveData } from "@/lib/workspace-data";
import type { ReaderDoc, ReaderHighlight, ReadingState } from "./mockDoc";

/*
 * Persistence of the reader: item_highlights and knowledge_items.reading_state.
 * - Live data and a real item (uuid): highlights load via listHighlights and save via
 *   saveHighlight; the position starts from the snapshot's reading_state (doc.savedState) and goes
 *   to saveReadingState (debounced).
 * - Always: localStorage (kortex.reader.<id>.highlights / kortex.reader.<id>.state) as the mock
 *   store and as the local cache. Live, a cached position only wins when it is newer than the
 *   snapshot's (e.g. a save that didn't reach the server).
 */

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** item_highlights row → reader highlight (locator { page, cfi }). */
function fromStored(h: StoredHighlight): ReaderHighlight | null {
  const page = Number(h.locator.page);
  if (!Number.isFinite(page)) return null;
  return {
    id: h.id,
    text: h.text,
    ...(h.note ? { note: h.note } : {}),
    page,
    ...(typeof h.locator.cfi === "string" ? { cfi: h.locator.cfi } : {}),
    createdAt: h.createdAt,
  };
}

const hlKey = (id: string) => `kortex.reader.${id}.highlights`;
const stateKey = (id: string) => `kortex.reader.${id}.state`;

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the session keeps working in memory
  }
}

const isHighlight = (h: unknown): h is ReaderHighlight =>
  !!h && typeof h === "object" && typeof (h as ReaderHighlight).text === "string" && typeof (h as ReaderHighlight).page === "number";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `hl-${Date.now().toString(36)}`);

/** Opening position: the saved state, else the document's anchor page in its first format. */
function initialState(doc: ReaderDoc): ReadingState {
  if (doc.savedState) return doc.savedState;
  return {
    format: doc.formats[0] ?? "pdf",
    page: doc.anchorPage,
    progress: doc.totalPages ? doc.anchorPage / doc.totalPages : 0,
    updatedAt: "",
  };
}

/**
 * @param totalPages page count for the progress; the doc's own, or what pdf.js reported for a live
 *   PDF without page_count (0 = unknown: progress stays where it was).
 */
export function useReaderStore(doc: ReaderDoc, totalPages = doc.totalPages) {
  const id = doc.noteId;
  const live = isLiveData() && isUuid(id);
  const [entries, setEntries] = useState<ReaderHighlight[]>(live ? [] : doc.seedHighlights);
  const [reading, setReading] = useState<ReadingState>(() => initialState(doc));
  const [ready, setReady] = useState(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  // The position as opened: not written back until the reader actually moves.
  const opened = useRef<ReadingState | null>(null);

  useEffect(() => {
    const stored = read<unknown[]>(hlKey(id));
    if (Array.isArray(stored)) setEntries(stored.filter(isHighlight));
    const st = read<ReadingState>(stateKey(id));
    const saved = doc.savedState;
    let start = initialState(doc);
    if (
      st &&
      doc.formats.includes(st.format) &&
      typeof st.page === "number" &&
      (!saved || (typeof st.updatedAt === "string" && st.updatedAt > saved.updatedAt))
    ) {
      const page = Math.max(doc.firstPage, doc.lastPage ? Math.min(doc.lastPage, st.page) : st.page);
      start = { ...st, page };
    }
    opened.current = start;
    setReading(start);
    setReady(true);
    if (!live) return;
    let alive = true;
    void listHighlights(id).then((res) => {
      if (!alive || !res.ok) return;
      setEntries(res.data.map(fromStored).filter((h): h is ReaderHighlight => h !== null));
    });
    return () => {
      alive = false;
    };
    // The doc is stable per reader (built once per item); its fields are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, live, doc.firstPage, doc.lastPage, doc.savedState]);

  useEffect(() => {
    if (ready) write(hlKey(id), entries);
  }, [ready, id, entries]);

  // Position updates arrive on every scroll; write them at most every 400 ms.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(reading);
  latest.current = reading;
  useEffect(() => {
    if (!ready || reading === opened.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      write(stateKey(id), latest.current);
      if (live) void saveReadingState(id, { ...latest.current });
    }, 400);
  }, [ready, id, live, reading]);
  useEffect(
    () => () => {
      // Leaving the tab flushes a pending position.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        write(stateKey(id), latest.current);
        if (live) void saveReadingState(id, { ...latest.current });
      }
    },
    [id, live],
  );

  const add = useCallback(
    (h: Omit<ReaderHighlight, "id" | "createdAt">): ReaderHighlight => {
      const entry: ReaderHighlight = { ...h, id: newId(), createdAt: new Date().toISOString() };
      // Marking the same passage twice keeps one highlight.
      if (!h.note && entriesRef.current.some((e) => !e.note && e.page === h.page && e.text === h.text)) return entry;
      setEntries((all) => [...all, entry]);
      if (live) {
        // Optimistic: the entry stays (and is cached locally) if the save fails; the server id replaces the local one.
        void saveHighlight(id, { text: h.text, note: h.note ?? null, locator: { page: h.page, ...(h.cfi ? { cfi: h.cfi } : {}) } }).then((res) => {
          if (res.ok) setEntries((all) => all.map((e) => (e.id === entry.id ? { ...e, id: res.data.id } : e)));
          else console.warn("[kortex] highlight kept locally:", res.error);
        });
      }
      return entry;
    },
    [id, live],
  );

  /** `progress` overrides page / totalPages (EPUB without page numbers). */
  const locate = useCallback(
    (patch: Partial<Pick<ReadingState, "format" | "page" | "cfi">>, progress?: number) =>
      setReading((r) => {
        const next = { ...r, ...patch };
        if (next.format === r.format && next.page === r.page && next.cfi === r.cfi) return r;
        const p = progress ?? (totalPages ? Math.min(1, next.page / totalPages) : r.progress);
        return { ...next, progress: p, updatedAt: new Date().toISOString() };
      }),
    [totalPages],
  );

  return { ready, entries, reading, add, locate };
}
