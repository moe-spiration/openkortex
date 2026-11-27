import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { bridge } from "@/bridge";
import { DIco, type DIconId } from "@/components/icons";
import { Key } from "@/components/Key";
import { Wave } from "@/components/Wave";
import { QC_ACTIONS, QC_ASK } from "@/data";
import { PRODUCT_NAME, msg, t, tx } from "@/i18n";
import {
  autoSelect,
  missingVariables,
  oneLine,
  parseLauncherInput,
  SEARCH_DEBOUNCE_MS,
  selectionTitle,
  toPrompt,
  typeIcon,
  fillVariables,
  type LauncherPrompt,
  type SearchHit,
} from "@/launcher";
import { useDesktop } from "@/state/desktop";

/** Typing pause before Festhalten/Fragen follows the text (same as the web Orbit-Bar). */
const INTENT_DEBOUNCE_MS = 150;

/** Index of "Second Brain fragen" in QC_ACTIONS; the rows before it are the capture targets. */
const ASK = QC_ASK;
/** Launcher rows after "Fragen": search mode, prompt mode, selection grab. */
const FIND = ASK + 1;
const PROMPT = ASK + 2;
const GRAB = ASK + 3;
/** Capture targets of the target chip (Orbit-Bar decision 9), in QC_ACTIONS order. English sources, shown with `t`. */
const TARGETS: { label: string; icon: DIconId }[] = [
  { label: msg("Note"), icon: "file" },
  { label: "Inbox", icon: "inbox" },
  { label: msg("Task"), icon: "task" },
  { label: "Scratchpad", icon: "file" },
];

interface Filling {
  prompt: LauncherPrompt;
  values: Record<string, string>;
}

/** Vault entries shown above the actions while typing (the "Einträge" group). */
const ENTRY_LIMIT = 3;
/** Entries are looked up from this many characters on. */
const ENTRY_MIN_CHARS = 2;

/**
 * Alt+Space launcher (Ruhe D3): the calm Orbit bar (600 × 44: mic, Festhalten/Fragen, field, target, send as the one
 * accent) and one list below it in groups, "Entries" (vault hits for the typed text) and "Actions", each row with
 * at most one key on the right. One overlay, the first character picks the mode (launcher.ts): `>` prompt catalog
 * (fill {{variables}}, paste into the app the user came from), `?` vault search (Enter opens the item), anything
 * else capture or ask. ↑/↓ pick, Enter runs, Tab switches capture/ask, Esc closes (and gives the focus back),
 * Alt+Shift+Space brings the selection of the active app.
 */
export function QuickCapturePalette() {
  const d = useDesktop();
  const b = bridge();
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRefs = useRef<Array<HTMLInputElement | null>>([]);
  const txt = d.qcText.trim();
  const { mode, query } = parseLauncherInput(d.qcText);
  const listMode = mode !== "capture";
  const ask = !listMode && d.qcSel === ASK;
  // Capture target shown in the chip; "Fragen" and the launcher rows land on Inbox.
  const target = d.qcSel < ASK ? d.qcSel : 1;

  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cur, setCur] = useState(0);
  /** Vault entries for the typed text (capture/ask mode) and the selected one, null = an action is selected. */
  const [entries, setEntries] = useState<SearchHit[]>([]);
  const [entryCur, setEntryCur] = useState<number | null>(null);
  const [fill, setFill] = useState<Filling | null>(null);
  /** Window title of a grabbed selection (title of the capture). */
  const [selSource, setSelSource] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The user picked Festhalten/Fragen (segment, Tab, chip, arrows): auto-detection stops changing it. */
  const [pinned, setPinned] = useState(false);
  /** Last capture target, where auto-detection returns to after a question. */
  const lastTarget = useRef(0);
  if (d.qcSel < ASK) lastTarget.current = d.qcSel;
  const pick = (i: number) => {
    setPinned(true);
    setEntryCur(null);
    d.setQcSel(i);
  };

  const focusInput = () => requestAnimationFrame(() => inputRef.current?.focus());
  const resetLocal = () => {
    setFill(null);
    setPinned(false);
    setSelSource(null);
    setNotice(null);
    setError(null);
    setCur(0);
    setEntryCur(null);
  };
  const setText = (text: string) => {
    d.setQcText(text);
    setNotice(null);
    setEntryCur(null);
  };

  const applySelection = (sel: {
    text: string | null;
    source: string | null;
    message?: string | null;
  }) => {
    setFill(null);
    if (sel.text) {
      d.setQcText(sel.text);
      pick(1);
      setSelSource(sel.source);
      setNotice(null);
    } else {
      setNotice(
        sel.message || t("No selection found: select text first, then Alt+Shift+Space"),
      );
    }
    focusInput();
  };

  // A new Alt+Space starts empty; Alt+Shift+Space arrives with the selection.
  const latest = useRef({ applySelection, resetLocal, d });
  latest.current = { applySelection, resetLocal, d };
  useEffect(() => {
    const off = [
      b.listen("shortcut:quick-capture", () => {
        latest.current.resetLocal();
        latest.current.d.resetQc();
        focusInput();
      }),
      b.listen("launcher:selection", (sel) => latest.current.applySelection(sel)),
    ];
    return () => off.forEach((f) => f());
  }, [b]);

  // Search as you type (debounced); empty query lists the most recent items / prompts.
  useEffect(() => {
    if (!listMode) return;
    let live = true;
    // Pending from the first keystroke, so "Keine Treffer" never flashes before the answer.
    setLoading(true);
    const timer = setTimeout(() => {
      b.invoke("launcher_search", {
        q: query,
        kind: mode === "prompt" ? "prompt" : null,
        limit: 8,
        content: mode === "prompt",
      })
        .then(
          (r) => {
            if (!live) return;
            setHits(r.results);
            setError(null);
            setCur(0);
          },
          (e: unknown) => {
            if (!live) return;
            setHits([]);
            setError(String(e));
          },
        )
        .finally(() => live && setLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [b, listMode, mode, query]);

  // "Entries": the vault's best matches for what is typed, quietly (no error, no spinner: the actions stay usable).
  const entryQuery = !listMode && !d.qcRec && txt.length >= ENTRY_MIN_CHARS ? txt : "";
  useEffect(() => {
    if (!entryQuery) {
      setEntries([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      b.invoke("launcher_search", { q: entryQuery, kind: null, limit: ENTRY_LIMIT, content: false }).then(
        (r) => live && setEntries(r.results.slice(0, ENTRY_LIMIT)),
        () => live && setEntries([]),
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [b, entryQuery]);
  const answering = ask && (d.qcAsking || !!d.qcAnswer || !!d.qcError);
  const shownEntries = answering ? [] : entries;

  // Festhalten/Fragen follows the text (detectIntent) until the user picks the mode.
  const qcText = d.qcText;
  const qcSel = d.qcSel;
  const setQcSel = d.setQcSel;
  useEffect(() => {
    if (listMode || pinned || d.qcRec) return;
    const timer = setTimeout(() => {
      const next = autoSelect(qcText, qcSel, lastTarget.current, ASK);
      if (next !== qcSel) setQcSel(next);
    }, INTENT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qcText, qcSel, setQcSel, listMode, pinned, d.qcRec]);

  const done = (message: string) => {
    resetLocal();
    d.say(message);
    if (b.native) d.resetQc();
    else d.closeLauncher();
    focusInput();
  };

  const deliver = (text: string, how: "paste" | "copy") => {
    b.invoke("paste_text", { text, mode: how }).then(
      (pasted) => done(pasted ? t("Prompt inserted") : t("Prompt on the clipboard")),
      (e: unknown) => {
        setFill(null);
        setError(String(e));
      },
    );
  };

  const openItem = (h: SearchHit) => {
    d.openItem(h.item_id);
    done(t("Opened “{title}”", { title: oneLine(h.title, 40) }));
  };

  const openHit = (h: SearchHit) => {
    if (mode === "prompt") {
      const p = toPrompt(h);
      if (!p.variables.length) return deliver(p.text, "paste");
      setFill({ prompt: p, values: {} });
      requestAnimationFrame(() => fieldRefs.current[0]?.focus());
      return;
    }
    openItem(h);
  };

  const grab = () => {
    setNotice(null);
    b.invoke("grab_selection").then(applySelection, (e: unknown) => setNotice(String(e)));
  };

  const run = (i: number) => {
    if (i < ASK)
      d.runQc(i, { title: selectionTitle(selSource) }).then(
        () => resetLocal(),
        // Natively the launcher stays open with the reason (no account, offline, …).
        (e: unknown) => {
          setNotice(t("Not saved: {error}", { error: String(e) }));
          focusInput();
        },
      );
    else if (i === ASK) void d.runQc(ASK);
    else if (i === FIND) setText("? " + txt);
    else if (i === PROMPT) setText("> " + txt);
    else if (i === GRAB) grab();
    if (i >= FIND) focusInput();
  };

  const submitFill = (how: "paste" | "copy") => {
    if (!fill) return;
    const missing = missingVariables(fill.prompt.variables, fill.values);
    if (how === "paste" && missing.length) {
      fieldRefs.current[fill.prompt.variables.indexOf(missing[0]!)]?.focus();
      return;
    }
    deliver(fillVariables(fill.prompt.text, fill.values), how);
  };

  /** ↑/↓ in capture/ask mode: the entries sit above the first action, one list for the keys. */
  const moveCapture = (dir: 1 | -1) => {
    const n = QC_ACTIONS.length;
    const m = shownEntries.length;
    if (entryCur !== null) {
      const next = entryCur + dir;
      if (next >= 0 && next < m) setEntryCur(next);
      else pick(dir > 0 ? 0 : n - 1);
    } else if (m && ((dir < 0 && d.qcSel === 0) || (dir > 0 && d.qcSel === n - 1))) {
      setEntryCur(dir < 0 ? m - 1 : 0);
    } else pick((d.qcSel + n + dir) % n);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = hits.length;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      resetLocal();
      d.closeLauncher();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      if (!listMode) moveCapture(dir);
      else if (n) setCur((c) => (c + n + dir) % n);
    } else if (e.key === "Tab" && !e.shiftKey && !listMode) {
      e.preventDefault();
      pick(ask ? target : ASK);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (listMode) {
        const h = hits[Math.min(cur, hits.length - 1)];
        if (h) openHit(h);
      } else if (entryCur !== null && shownEntries[entryCur]) openItem(shownEntries[entryCur]!);
      else run(d.qcSel);
    }
  };

  const onFillKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setFill(null);
      focusInput();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.ctrlKey) submitFill("copy");
      else if (
        i < (fill?.prompt.variables.length ?? 0) - 1 &&
        missingVariables(fill!.prompt.variables, fill!.values).length
      )
        fieldRefs.current[i + 1]?.focus();
      else submitFill("paste");
    }
  };

  const placeholder =
    mode === "prompt"
      ? t("Search prompts")
      : mode === "find"
        ? t("Search the vault")
        : ask
          ? t("Ask your Second Brain")
          : t("Thought, idea, link …");
  const actionSelected = !listMode && entryCur === null;
  // The selected row stays in view when a list scrolls (actions below entries, long result lists).
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(".kxd-cl-row.is-selected")?.scrollIntoView?.({ block: "nearest" });
  }, [d.qcSel, entryCur, cur, shownEntries.length]);

  return (
    <div className="kxd-qc kx-slide-up" role="dialog" aria-label={`${PRODUCT_NAME} Launcher`}>
      <div className="kxd-cb" data-mode={ask ? "ask" : "capture"} data-state={d.qcRec ? "voice" : undefined}>
        <button
          type="button"
          className={"kxd-cb-btn" + (d.qcRec ? " is-rec" : "")}
          aria-label={d.qcRec ? t("Put recording into the Inbox") : t("Record voice note")}
          onClick={d.qcOrb}
        >
          <DIco name={d.qcRec ? "stop" : "mic"} sm />
        </button>

        {!d.qcRec && !listMode && (
          <div className="kxd-cb-seg" role="radiogroup" aria-label={t("Mode")}>
            <button type="button" role="radio" aria-checked={!ask} className={ask ? "" : "is-on"} onClick={() => pick(target)}>
              <DIco name="plus" sm />
              {t("Capture")}
            </button>
            <button type="button" role="radio" aria-checked={ask} className={ask ? "is-on" : ""} onClick={() => pick(ASK)}>
              <DIco name="sparkles" sm />
              {t("Ask")}
            </button>
          </div>
        )}
        {!d.qcRec && listMode && (
          <span className="kxd-cb-chip is-static" aria-label={mode === "prompt" ? t("Mode: prompts") : t("Mode: search")}>
            <DIco name={mode === "prompt" ? "msg" : "search"} sm />
            {mode === "prompt" ? "Prompts" : t("Search")}
          </span>
        )}

        {d.qcRec ? (
          <span className="kxd-cb-field kxd-cb-field--voice">
            <span className="kxd-cb-rec kx-num">0:{String(d.qcSec).padStart(2, "0")}</span>
            <Wave tone="ai" n={32} h={16} />
            <span className="kxd-cb-voicehint kx-truncate">{t("Tapping the orb puts the note into the Inbox")}</span>
          </span>
        ) : (
          <span className="kxd-cb-field">
            <input
              ref={inputRef}
              aria-label={t("Capture, question, ? search or > prompt")}
              placeholder={placeholder}
              value={d.qcText}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
            />
          </span>
        )}

        {!d.qcRec && !ask && !listMode && (
          <button
            type="button"
            className="kxd-cb-chip"
            aria-label={t("Target: {target} (switch)", { target: t(TARGETS[target]!.label) })}
            onClick={() => pick((target + 1) % TARGETS.length)}
          >
            <DIco name={TARGETS[target]!.icon} sm />
            {t(TARGETS[target]!.label)}
            <DIco name="chev-d" sm />
          </button>
        )}
        {!d.qcRec && ask && (
          <span className="kxd-cb-chip is-static">
            <DIco name="search" sm />
            {t("Whole vault")}
          </span>
        )}

        {!d.qcRec && (
          <button
            type="button"
            className={"kxd-cb-send" + (txt || ask ? " is-ready" : "")}
            aria-label={listMode ? tx("verb", "Open") : ask ? t("Ask") : t("Capture")}
            disabled={listMode ? !hits.length : !txt && !ask}
            onClick={() => (listMode ? hits[cur] && openHit(hits[cur]!) : run(d.qcSel))}
          >
            <span aria-hidden>↵</span>
          </button>
        )}
      </div>

      <div className="kxd-cl" ref={listRef}>
        {fill ? (
          <PromptForm
            fill={fill}
            fieldRefs={fieldRefs}
            onChange={(name, value) =>
              setFill((f) => (f ? { ...f, values: { ...f.values, [name]: value } } : f))
            }
            onKey={onFillKey}
            onPaste={() => submitFill("paste")}
            onCopy={() => submitFill("copy")}
          />
        ) : listMode ? (
          <div className="kxd-cl-group">
            <div className="kxd-cl-label">
              {mode === "prompt"
                ? query
                  ? "Prompts"
                  : t("Recently saved prompts")
                : query
                  ? t("Results in the vault")
                  : t("Recently edited")}
            </div>
            <div className="kxd-cl-list" role="listbox" aria-label={t("Results")}>
              {hits.map((h, i) => (
                <button
                  key={h.item_id}
                  type="button"
                  role="option"
                  aria-selected={cur === i}
                  className={"kxd-cl-row" + (cur === i ? " is-selected" : "")}
                  onMouseEnter={() => setCur(i)}
                  onClick={() => openHit(h)}
                >
                  <DIco name={typeIcon(h.type)} sm />
                  <span className="kxd-cl-title kx-truncate">{h.title}</span>
                  <span className="kxd-cl-meta kx-truncate">
                    {mode === "prompt"
                      ? toPrompt(h).variables.length
                        ? t("{n} var.", { n: toPrompt(h).variables.length })
                        : t("no var.")
                      : h.snippet || (h.folder_path ?? "")}
                  </span>
                  {cur === i && <Key k="↵" />}
                </button>
              ))}
              {!hits.length && !error && (
                <div className="kxd-cl-empty">
                  {loading
                    ? t("Searching …")
                    : mode === "prompt"
                      ? t("No prompts found. You save prompts with the browser extension.")
                      : t("No results")}
                </div>
              )}
              {error && <div className="kxd-cl-empty kxd-cl-error">{error}</div>}
            </div>
          </div>
        ) : (
          <>
            {shownEntries.length > 0 && (
              <div className="kxd-cl-group">
                <div className="kxd-cl-label">{t("Entries")}</div>
                <div className="kxd-cl-list" role="listbox" aria-label={t("Entries")}>
                  {shownEntries.map((h, i) => (
                    <button
                      key={h.item_id}
                      type="button"
                      role="option"
                      aria-selected={entryCur === i}
                      className={"kxd-cl-row" + (entryCur === i ? " is-selected" : "")}
                      onClick={() => openItem(h)}
                    >
                      <DIco name={typeIcon(h.type)} sm />
                      <span className="kxd-cl-title kx-truncate">{h.title}</span>
                      <span className="kxd-cl-meta kx-truncate">{h.snippet || (h.folder_path ?? "")}</span>
                      {entryCur === i && <Key k="↵" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="kxd-cl-group">
              <div className="kxd-cl-label">{t("Actions")}</div>
              {!d.connected && (
                <div className="kxd-cl-empty kxd-cl-connect">
                  <span className="kxh-grow">{t("No account connected: capture, ask and search need your Kortex account.")}</span>
                  <button type="button" className="kxd-cl-link" onClick={d.openConnect}>
                    {t("Connect account")}
                  </button>
                </div>
              )}
              <div className="kxd-cl-list">
                {QC_ACTIONS.map((r, i) => ({ r, i }))
                  // While an answer is shown, only "Fragen" stays, so the answer has the room.
                  .filter(({ i }) => !answering || i === ASK)
                  .map(({ r, i }) => {
                    const on = actionSelected && d.qcSel === i;
                    return (
                      <button
                        key={i}
                        type="button"
                        className={"kxd-cl-row" + (on ? " is-selected" : "")}
                        onClick={() => run(i)}
                      >
                        <DIco name={r.icon} sm />
                        <span className="kxd-cl-title kx-truncate">
                          {txt && i <= ASK ? (i === ASK ? t("Ask: {text}", { text: txt }) : `${r.label}: ${txt}`) : r.label}
                        </span>
                        {on ? <Key k="↵" /> : r.key && <Key k={r.key} />}
                      </button>
                    );
                  })}
                {selSource && txt && <div className="kxd-cl-empty">{t("Selection from {source}", { source: selSource })}</div>}
                {notice && <div className="kxd-cl-empty">{notice}</div>}
              </div>
              {answering && (
                <div className="kxd-cl-answer kx-in" aria-live="polite">
                  <div className="kxd-cl-answerhead">
                    <DIco name="sparkles" sm className={d.qcAsking ? "kxd-pulse" : undefined} />
                    <span>
                      {d.qcAsking
                        ? t("Kortex is searching your vault …")
                        : d.qcError
                          ? t("No answer")
                          : t("Answer from your vault")}
                    </span>
                  </div>
                  {(d.qcError ?? d.qcAnswer?.text) && <p className="kxd-cl-answertext">{d.qcError ?? d.qcAnswer?.text}</p>}
                  {!!d.qcAnswer?.sources.length && (
                    <div className="kxd-cl-sources">
                      {d.qcAnswer.sources.map((s) => (
                        <button key={s.n} type="button" className="kxd-cl-source" onClick={() => d.openItem(s.item_id)}>
                          <span className="kx-num">{s.n}</span>
                          <span className="kx-truncate">{s.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
        <div className="kxd-cl-foot">
          {fill ? (
            <>
              <span>
                <Key k="↵" /> {t("insert")}
              </span>
              <span>
                <Key k="Ctrl" /> <Key k="↵" /> {t("copy")}
              </span>
            </>
          ) : (
            <>
              <span>
                <Key k="↑" />
                <Key k="↓" /> {t("choose")}
              </span>
              <span>
                <Key k="↵" /> {listMode || entryCur !== null ? (mode === "prompt" ? t("choose") : t("open")) : t("run")}
              </span>
              {!listMode && (
                <span>
                  <Key k="Tab" /> {ask ? t("Capture") : t("Ask the agent")}
                </span>
              )}
            </>
          )}
          <span className="kxh-grow" />
          <span>
            <Key k="Esc" /> {fill ? t("back") : t("close")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Alt+Space overlay in the desktop preview: scrim + capsule 170 px from the top. */
export function QuickCapture() {
  const d = useDesktop();
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 170,
      }}
    >
      <div
        className="kx-scrim"
        style={{ position: "absolute", inset: 0 }}
        onClick={() => d.setMode("off")}
      />
      <QuickCapturePalette />
    </div>
  );
}

function PromptForm(p: {
  fill: Filling;
  fieldRefs: RefObject<Array<HTMLInputElement | null>>;
  onChange: (name: string, value: string) => void;
  onKey: (e: KeyboardEvent<HTMLInputElement>, i: number) => void;
  onPaste: () => void;
  onCopy: () => void;
}) {
  const { prompt, values } = p.fill;
  const open = missingVariables(prompt.variables, values).length;
  return (
    <div className="kxd-fill" role="form" aria-label={t("Fill in prompt “{title}”", { title: prompt.title })}>
      <div className="kxd-cl-label">{prompt.title}</div>
      {prompt.variables.map((v, i) => (
        <label key={v} className="kxd-fill-row">
          <span className="kxd-fill-name kx-truncate">{v}</span>
          <span className="kx-control kxh-grow">
            <input
              ref={(el) => {
                p.fieldRefs.current[i] = el;
              }}
              aria-label={v}
              value={values[v] ?? ""}
              onChange={(e) => p.onChange(v, e.target.value)}
              onKeyDown={(e) => p.onKey(e, i)}
            />
          </span>
        </label>
      ))}
      <div className="kxd-fill-preview">{oneLine(fillVariables(prompt.text, values), 220)}</div>
      <div className="kxd-fill-actions">
        <button type="button" className="kxd-cl-btn" onClick={p.onCopy}>
          {t("Copy")}
        </button>
        <button
          type="button"
          className="kxd-cl-btn is-primary"
          disabled={open > 0}
          onClick={p.onPaste}
        >
          {open > 0 ? t("{n} still open", { n: open }) : t("Insert")}
        </button>
      </div>
    </div>
  );
}
