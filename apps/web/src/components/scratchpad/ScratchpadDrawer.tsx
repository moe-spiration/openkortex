"use client";

import { t, tn, tx } from "@/i18n";
import Link from "next/link";
import { Archive, ArrowUpRight, Check, Notebook, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACTION_LABEL,
  acceptable,
  addToPad,
  applyPad,
  cleanupPad,
  deleteDecision,
  dropPending,
  isCodeEntry,
  isScratchpadKey,
  isSubmitKey,
  loadPad,
  mergeEntries,
  noteDecision,
  padWhen,
  pendingEntry,
  SCRATCHPAD_COUNT_EVENT,
  SCRATCHPAD_EVENT,
  SCRATCHPAD_OPEN_EVENT,
  SCRATCHPAD_SHORTCUT_LABEL,
  SCRATCHPAD_TOGGLE,
  toDecisions,
  withoutEntry,
  type PadEntry,
  type PadSuggestion,
} from "@/lib/scratchpad/client";
import { vaultHref } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";

/** Cleaned-up entries land in 10_Notes/Scratchpad-Archiv.md (server/scratchpad/format.ts). */
const SCRATCHPAD_ARCHIVE_FOLDER = "10_Notes";

/*
 * Scratchpad drawer: one document (00_Inbox/Scratchpad.md), entries are list items. Alt+J (or the
 * `kortex:scratchpad` window event, or the `?scratchpad=1` deep link from the phone) opens it with the cursor in the text field; Ctrl/Cmd+Enter saves
 * (optimistic), Enter is a newline so code blocks and numbers can be pasted. "Aufräumen" asks the AI for
 * one suggestion per entry; nothing changes until the user accepts it.
 * A2 (2026-11): it opens as a popover right under the Scratchpad button left of "Neu" (not a full-height panel on
 * the right edge); a click outside or Esc closes it.
 */
export function ScratchpadDrawer() {
  const { showToast } = useShell();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<PadEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<PadSuggestion[] | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const toast = useRef(showToast);
  toast.current = showToast;

  const refresh = useCallback(async (quiet = false) => {
    try {
      const r = await loadPad();
      setEntries((cur) => mergeEntries(r.entries, cur));
    } catch (e) {
      if (!quiet) toast.current(e instanceof Error ? e.message : t("Scratchpad not reachable"));
    }
  }, []);

  // Titlebar badge: load once on start and whenever the entries change.
  useEffect(() => {
    void refresh(true);
  }, [refresh]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(SCRATCHPAD_COUNT_EVENT, { detail: entries.filter((e) => !e.pending).length }));
  }, [entries]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isScratchpadKey(e)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    // The titlebar button toggles (detail "toggle"); every other caller (Neu menu, orbit, phone link) opens.
    const onOpen = (e: Event) => ((e as CustomEvent<unknown>).detail === SCRATCHPAD_TOGGLE ? setOpen((o) => !o) : setOpen(true));
    // Deep link from the phone ("Im Web aufräumen"): /home?scratchpad=1 opens the drawer once.
    const url = new URL(window.location.href);
    if (url.searchParams.has("scratchpad")) {
      setOpen(true);
      url.searchParams.delete("scratchpad");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(SCRATCHPAD_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(SCRATCHPAD_EVENT, onOpen);
    };
  }, []);

  // Anchor under the titlebar button (falls back to the top right corner when the button is hidden).
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const b = document.querySelector(".tc-scratch-btn")?.getBoundingClientRect();
      setAnchor(b && b.width > 0 ? { top: Math.round(b.bottom + 8), right: Math.max(12, Math.round(window.innerWidth - b.right)) } : null);
    };
    place();
    const outside = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || panel.current?.contains(t) || t.closest(".tc-scratch-btn")) return;
      setOpen(false);
    };
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(SCRATCHPAD_OPEN_EVENT, { detail: open }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    // After the panel is in the DOM.
    const t = setTimeout(() => area.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, refresh]);

  const save = async () => {
    const text = draft.replace(/\s+$/, "");
    if (!text.trim()) return;
    const tmp = `tmp-${Date.now()}`;
    setEntries((l) => [...l, pendingEntry(text, new Date(), tmp)]);
    setDraft("");
    area.current?.focus();
    try {
      const r = await addToPad(text);
      setEntries((l) => mergeEntries(r.entries, dropPending(l, tmp)));
    } catch (e) {
      setEntries((l) => dropPending(l, tmp));
      setDraft(text);
      showToast(e instanceof Error ? e.message : t("Saving failed"));
    }
  };

  const cleanup = async () => {
    setBusy(true);
    try {
      const r = await cleanupPad();
      setEntries(r.entries);
      setSuggestions(r.suggestions);
      if (!r.suggestions.length) showToast(t("Nothing to tidy up"));
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("Tidying up failed"));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (list: PadSuggestion[]) => {
    const decisions = toDecisions(list);
    if (!decisions.length) return;
    setBusy(true);
    try {
      const r = await applyPad(decisions);
      setEntries(r.entries);
      const failed = r.results.filter((x) => !x.ok).length;
      setSuggestions((s) => (s ?? []).filter((x) => !decisions.some((d) => d.entry_id === x.entry_id) || r.results.some((y) => y.entry_id === x.entry_id && !y.ok)));
      showToast(failed ? t("{done} applied, {failed} failed", { done: decisions.length - failed, failed }) : t("{count} applied", { count: decisions.length }));
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("Applying failed"));
    } finally {
      setBusy(false);
    }
  };

  /** Deletes one saved entry (optimistic). The line moves to the Markdown archive, so a misclick loses nothing. */
  const remove = async (id: string) => {
    const before = entries;
    setEntries((l) => withoutEntry(l, id));
    setSuggestions((s) => (s ? s.filter((x) => x.entry_id !== id) : s));
    try {
      const r = await applyPad(deleteDecision(id));
      const failed = r.results.find((x) => !x.ok);
      if (failed) throw new Error(failed.error ?? t("Deleting failed"));
      setEntries((l) => mergeEntries(r.entries, l));
      showToast(t("Entry deleted (kept in the scratchpad archive)"));
    } catch (e) {
      setEntries(before);
      showToast(e instanceof Error ? e.message : t("Deleting failed"));
    }
  };

  /** "Als Notiz anlegen": the entry becomes its own note (title = first line) and leaves the pad. */
  const toNote = async (id: string) => {
    const before = entries;
    setEntries((l) => withoutEntry(l, id));
    setSuggestions((s) => (s ? s.filter((x) => x.entry_id !== id) : s));
    try {
      const r = await applyPad(noteDecision(id));
      const failed = r.results.find((x) => !x.ok);
      if (failed) throw new Error(failed.error ?? t("Creating failed"));
      setEntries((l) => mergeEntries(r.entries, l));
      showToast(t("Created as note"));
    } catch (e) {
      setEntries(before);
      showToast(e instanceof Error ? e.message : t("Creating failed"));
    }
  };

  const reject = (id: string) => setSuggestions((s) => (s ?? []).filter((x) => x.entry_id !== id));

  if (!open) return null;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const todo = suggestions ? acceptable(suggestions) : [];
  const top = anchor?.top ?? 56;

  // Feinschliff Live (prototype .sp): head (Aufräumen, close), entries newest first with hover actions, and the input
  // at the bottom with the document path and "Speichern". Styles: packages/ui/src/styles/fs-chrome.css.
  return (
    <aside
      ref={panel}
      aria-label="Scratchpad"
      className="tc-float tc-scratch-pop fs-sp"
      style={{ position: "fixed", right: anchor?.right ?? 16, top, maxHeight: `min(560px, calc(100vh - ${top + 16}px))`, zIndex: 40 }}
    >
      <header className="fs-sp-h">
        <Notebook size={14} strokeWidth={1.75} aria-hidden className="fs-sp-hico" />
        <strong>Scratchpad</strong>
        <span className="fs-grow" />
        <button type="button" className="fs-sp-btn" onClick={cleanup} disabled={busy || entries.length === 0} title={t("AI suggests where each entry belongs")}>
          <Sparkles size={14} strokeWidth={1.75} aria-hidden /> {t("Tidy up")}
        </button>
        <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={t("Close scratchpad")} title={t("Close (Esc, {shortcut})", { shortcut: SCRATCHPAD_SHORTCUT_LABEL })} onClick={() => setOpen(false)}>
          <X size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </header>

      {suggestions && todo.length > 0 && (
        <div className="fs-sp-all">
          <Sparkles size={14} strokeWidth={1.75} aria-hidden />
          <span className="fs-grow">{tn(todo.length, "{n} suggestion", "{n} suggestions")}</span>
          <button type="button" className="fs-sp-btn fs-sp-btn--acc" disabled={busy} onClick={() => apply(suggestions)}>
            {t("Accept all")}
          </button>
        </div>
      )}

      <ul className="fs-sp-list">
        {entries.length === 0 && <li className="fs-sp-empty">{t("Empty. Jot something down quickly, sort it later.")}</li>}
        {[...entries].reverse().map((e) => {
          const s = suggestions?.find((x) => x.entry_id === e.id);
          return (
            <li key={e.id} className="fs-sp-e" data-pending={e.pending ? "true" : undefined}>
              <div className="fs-sp-body">
                <pre className={isCodeEntry(e.text) ? "is-code" : undefined}>{e.text}</pre>
                <span className="fs-sp-when">{e.pending ? t("Saving…") : padWhen(e.at)}</span>
                {s && byId.has(s.entry_id) && (
                  <span className="fs-sp-sug">
                    <Sparkles size={13} strokeWidth={1.75} aria-hidden />
                    <span className="fs-grow">
                      {ACTION_LABEL[s.action]}
                      {s.title ? `: ${s.title}` : ""}
                      {s.reason ? ` · ${s.reason}` : ""}
                    </span>
                    {s.action !== "keep" && (
                      <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={tx("suggestion", "Accept")} title={t("Accept")} disabled={busy} onClick={() => apply([s])}>
                        <Check size={14} strokeWidth={1.75} aria-hidden />
                      </button>
                    )}
                    <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={t("Reject")} title={t("Reject")} onClick={() => reject(s.entry_id)}>
                      <X size={14} strokeWidth={1.75} aria-hidden />
                    </button>
                  </span>
                )}
              </div>
              {!e.pending && (
                <div className="fs-sp-acts">
                  <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={t("Create as note")} title={t("Create as note")} onClick={() => void toNote(e.id)}>
                    <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />
                  </button>
                  <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={t("Delete entry")} title={t("Delete (kept in the scratchpad archive afterwards)")} onClick={() => void remove(e.id)}>
                    <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="fs-sp-in">
        <textarea
          ref={area}
          aria-label={t("New entry")}
          placeholder={t("Thought, snippet, number… (Ctrl Enter saves)")}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isSubmitKey(e.nativeEvent)) {
              e.preventDefault();
              void save();
            }
          }}
        />
        <div className="fs-sp-foot">
          <span className="fs-sp-path">00_Inbox/Scratchpad.md</span>
          <Link
            href={vaultHref(SCRATCHPAD_ARCHIVE_FOLDER)}
            className="tc-ibtn tc-ibtn--sm"
            aria-label={t("Open archive")}
            title={t("Open archive ({path})", { path: "10_Notes/Scratchpad-Archiv.md" })}
            onClick={() => setOpen(false)}
          >
            <Archive size={14} strokeWidth={1.75} aria-hidden />
          </Link>
          <span className="fs-grow" />
          <button type="button" className="fs-sp-btn fs-sp-btn--acc" onClick={save} disabled={!draft.trim()}>
            {t("Save")}
          </button>
        </div>
      </div>
    </aside>
  );
}
