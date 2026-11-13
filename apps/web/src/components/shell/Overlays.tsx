"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Command } from "cmdk";
import { NOTES, NOTE_TYPES, RECENT_NOTE_IDS, isLiveData, noteById } from "@/lib/workspace-data";
import { searchVault } from "@/lib/api/client";
import { REMOTE_DEBOUNCE_MS, REMOTE_MIN_CHARS, hitFromSearch, mergePaletteHits, type PaletteHit } from "@/lib/shell/palette-search";
import { useCapture } from "@/lib/shell/capture";
import { useShell } from "@/lib/shell/store";
import { useAsk } from "./useAsk";
import { rich } from "@/components/ui/rich";
import { PRODUCT_NAME, msg, t, tx } from "@/i18n";
import { Ico, type IconId } from "./icons";

/*
 * Command palette, shortcut overview and toast (WebApp.dc.html overlays), on the shared primitives: base-ui Dialog
 * (focus trap, Escape, outside click, scroll lock), cmdk (keyboard list, active row) and Sonner (toast queue).
 * The look stays the design system's (kx-palette, kx-toast); app/ui-primitives.css maps the library states onto it.
 */

interface Cmd {
  icon: IconId;
  label: string;
  hint: string;
  run: () => void;
}

/** Jump targets, labels in the current language. */
const jumpTargets = (): [string, string, IconId][] => [
  ["/home", "Home", "home"],
  ["/journal", t("Journal"), "sun"],
  ["/inbox", "Inbox", "inbox"],
  ["/spaces/all", t("All entries"), "grid"],
  ["/objects", t("Objects"), "boxes"],
  ["/hashtags", "Hashtags", "hash"],
  ["/favorites", t("Favorites"), "star"],
  ["/archive", t("Archive"), "archive"],
  ["/tasks", "Tasks", "todo"],
  ["/reminders", t("Reminders"), "bell"],
  ["/flashcards", t("Flashcards"), "cards"],
  ["/graph", "Knowledge Graph", "graph"],
  ["/insights", "Insights", "chart"],
  ["/journal/week", tx("nav", "Weekly review"), "review"],
  ["/life/overview", "Life Areas", "life"],
  ["/settings", t("Settings"), "gear"],
];

export function CommandPalette() {
  const router = useRouter();
  const shell = useShell();
  const { setPalette, prefs } = shell;
  const ask = useAsk();
  const { capture, captureData } = useCapture();
  const [text, setText] = useState("");

  const close = () => setPalette(false);
  const go = (href: string) => {
    close();
    router.push(href);
  };

  const q = text.trim();
  const ql = q.toLowerCase();
  const match = (l: string) => !ql || l.toLowerCase().includes(ql);

  // Hybrid search (vector + full text) behind the item results, debounced; stale answers are ignored.
  const [remote, setRemote] = useState<{ q: string; hits: PaletteHit[] } | null>(null);
  useEffect(() => {
    if (!isLiveData() || q.length < REMOTE_MIN_CHARS) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      searchVault(q, { limit: 8, signal: ctl.signal })
        .then((r) => setRemote({ q, hits: r.results.map(hitFromSearch) }))
        .catch(() => {
          /* offline, rate limit, aborted: the local results stay */
        });
    }, REMOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q]);
  const remoteHits = remote && remote.q === q ? remote.hits : null;

  const groups = useMemo(() => {
    const out: { label: string; rows: Cmd[] }[] = [];
    if (q)
      out.push({
        label: PRODUCT_NAME,
        rows: [
          {
            icon: "sparkles",
            label: t("Ask Kortex: {query}", { query: q }),
            hint: "Hybrid RAG",
            run: () => {
              close();
              shell.setCmode("ask");
              ask(q);
            },
          },
          {
            icon: "inbox",
            label: t("Capture as a thought: {query}", { query: q }),
            hint: "Inbox",
            run: () => {
              close();
              void capture({ text: q });
            },
          },
        ],
      });
    const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");
    // Local title matches at once; the hybrid search (/api/search) takes over when it answers (lib/shell/palette-search).
    const hits: PaletteHit[] = ql
      ? mergePaletteHits(
          NOTES.filter((n) => match(n.title + " " + n.path)).map((n) => ({ id: n.id, title: n.title, hint: folderOf(n.path) })),
          remoteHits,
          6,
        )
      : RECENT_NOTE_IDS.map((id) => noteById(id)!)
          .slice(0, 5)
          .map((n) => ({ id: n.id, title: n.title, hint: folderOf(n.path) }));
    if (hits.length)
      out.push({
        label: ql ? (remoteHits ? t("Notes · hybrid search") : t("Notes")) : t("Recently opened"),
        rows: hits.map((h) => {
          const n = noteById(h.id);
          return {
            icon: n ? NOTE_TYPES[n.type]?.icon ?? "file-text" : "file-text",
            label: h.title,
            hint: h.hint,
            run: () => {
              close();
              shell.openNote(h.id);
            },
          };
        }),
      });
    const jumps: Cmd[] = jumpTargets().filter((j) => match(j[1])).map(([href, label, icon]) => ({ icon, label, hint: t("Jump"), run: () => go(href) }));
    if (jumps.length) out.push({ label: t("Jump to"), rows: jumps });
    const dark = prefs.theme === "dark";
    const allActs: Cmd[] = [
      { icon: "mic", label: t("Record voice note"), hint: "Ctrl+Shift+Space", run: () => (close(), shell.startRec("tap")) },
      { icon: "palette", label: t("Change accent color"), hint: t("Settings"), run: () => go("/settings") },
      { icon: "sun", label: dark ? t("Switch to light") : t("Switch to dark"), hint: t("Theme"), run: () => (close(), shell.setTheme(dark ? "light" : "dark")) },
      { icon: "file-plus", label: t("New note"), hint: "Alt+N", run: () => (close(), shell.openNewNote()) },
      { icon: "panel", label: prefs.sidebarClosed ? t("Show sidebar") : t("Hide sidebar"), hint: "Ctrl+\\", run: () => (close(), shell.toggleSidebar()) },
      { icon: "rail", label: prefs.rail ? t("Expand sidebar") : t("Sidebar as icon rail"), hint: t("Settings"), run: () => (close(), shell.toggleRail()) },
      { icon: "split", label: t("Toggle split view"), hint: "Ctrl+Shift+\\", run: () => (close(), shell.setSplit(!shell.drawer.pinned)) },
      { icon: "review", label: t("Start weekly review"), hint: t("Ritual"), run: () => go("/journal/week") },
      { icon: "key", label: t("Show keyboard shortcuts"), hint: "?", run: () => (close(), shell.setKeys(true)) },
      { icon: "sparkles", label: t("Start setup again"), hint: "Onboarding", run: () => (close(), shell.setOnboarding(1)) },
    ];
    const acts = allActs.filter((a) => match(a.label));
    if (acts.length) out.push({ label: t("Actions"), rows: acts });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, ql, prefs.theme, prefs.rail, shell.drawer.pinned, remoteHits]);

  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  let idx = 0;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="kx-scrim kx-dlg-backdrop" />
        <Dialog.Popup
          className="kx-palette kx-dlg kx-dlg--palette"
          aria-label={t("Command palette")}
          // Quick drop: files or links dropped on the palette go straight to the inbox.
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (captureData(e.dataTransfer)) close();
          }}
        >
          <Command shouldFilter={false} loop label={t("Command palette")}>
            <div className="kx-palette-head">
              <Ico name="search" style={{ color: "var(--accent-ai)" }} />
              <Command.Input
                autoFocus
                className="kx-input"
                aria-label={t("Search, jump or run an action")}
                placeholder={t("Search, jump or run an action")}
                value={text}
                onValueChange={setText}
                onPaste={(e) => {
                  // Pasted files (screenshots, PDFs) are captured; pasted text stays a query.
                  if (e.clipboardData.files.length) {
                    e.preventDefault();
                    captureData(e.clipboardData);
                    close();
                  }
                }}
              />
              <span className="kx-kbd">Esc</span>
            </div>
            <Command.List className="kx-palette-body kx-scroll" style={{ maxHeight: 400, overflow: "auto" }} aria-label={t("Results")}>
              {groups.map((g) => (
                <Command.Group key={g.label} heading={g.label}>
                  {g.rows.map((r) => {
                    const i = idx++;
                    return (
                      <Command.Item key={`${i}:${r.label}`} value={`${i}:${r.label}`} className="kx-palette-row" onSelect={r.run}>
                        <Ico name={r.icon} />
                        <span className="kx-truncate">{r.label}</span>
                        <span className="kx-hint">{r.hint}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
              {count === 0 && (
                <div className="kx-help" style={{ padding: "18px 12px" }}>
                  {t("Nothing found. Enter asks Kortex.")}
                </div>
              )}
            </Command.List>
            <div className="kx-palette-foot">
              <span className="kx-keys">
                <span className="kx-kbd">↑</span>
                <span className="kx-kbd">↓</span> {t("select")}
              </span>
              <span className="kx-keys">
                <span className="kx-kbd">Enter</span> {t("run")}
              </span>
              <span className="kx-keys">
                <span className="kx-kbd">Esc</span> {t("close")}
              </span>
              <span style={{ marginLeft: "auto" }}>{t("Capturing goes through the orb")}</span>
            </div>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const KEY_GROUPS: { label: string; rows: [string, string[]][] }[] = [
  {
    label: msg("Navigation"),
    rows: [
      [msg("Command palette"), ["Ctrl", "K"]],
      [msg("Show or hide sidebar"), ["Ctrl", "\\"]],
      [msg("Toggle single and split view"), ["Ctrl", "Shift", "\\"]],
      [msg("New note"), ["Alt", "N"]],
      [msg("Close overlay or drawer"), ["Esc"]],
      [msg("Keyboard shortcuts"), ["?"]],
    ],
  },
  {
    label: msg("Capture"),
    rows: [
      [msg("Start and stop voice note"), ["Ctrl", "Shift", "Space"]],
      [msg("Thought into the Inbox"), ["Enter"]],
      [msg("Push-to-talk"), [msg("Hold orb")]],
      [msg("Focus Orbit bar (in the graph: node search)"), ["/"]],
      [msg("Capture or ask"), ["Tab"]],
      [msg("Open input as a new note"), ["Shift", "Enter"]],
    ],
  },
  {
    label: msg("In views"),
    rows: [
      [msg("Grid, list, timeline"), ["G", "L", "T"]],
      [msg("Inbox: next, previous entry"), ["J", "K"]],
      [msg("Inbox: accept, target, tags, object"), ["Enter", "E", "T", "O"]],
      [msg("Inbox: archive, delete"), ["X", "⌫"]],
      [msg("Rediscover: open, later, flashcard"), ["O", "S", "F"]],
    ],
  },
  {
    label: msg("Writing and reading"),
    rows: [
      [msg("Block commands in notes"), ["/"]],
      [msg("Selection in palette"), ["↑", "↓"]],
      [msg("Run"), ["Enter"]],
    ],
  },
  {
    label: msg("Desktop app"),
    rows: [
      [msg("Quick capture and ask"), ["Alt", "Space"]],
      [msg("Live HUD on or off"), ["Ctrl", "Shift", "H"]],
      [msg("Start or stop recording"), ["Ctrl", "Shift", "R"]],
      [msg("Note with timestamp"), ["Ctrl", "Shift", "N"]],
    ],
  },
];

export function KeysOverlay() {
  const { setKeys } = useShell();
  return (
    <Dialog.Root open onOpenChange={(o) => !o && setKeys(false)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="kx-scrim kx-dlg-backdrop" />
        <Dialog.Popup
          className="kx-dlg kx-dlg--keys"
          aria-label={t("Keyboard shortcuts")}
          style={{
            width: 760,
            maxWidth: "calc(100% - 40px)",
            padding: "24px 26px",
            borderRadius: "var(--radius-card)",
            background: "var(--bg-floating-glass)",
            WebkitBackdropFilter: "blur(24px) saturate(160%)",
            backdropFilter: "blur(24px) saturate(160%)",
            boxShadow: "var(--shadow-floating)",
            display: "grid",
            gap: 18,
          }}
        >
        <div className="kxh-row">
          <div className="kxh-col kxh-grow" style={{ gap: 2 }}>
            <span className="kx-eyebrow">Keyboard-first</span>
            <strong className="kx-h-page">
              {t("Keyboard shortcuts")}
            </strong>
          </div>
          <Dialog.Close className="kx-btn kx-btn--ghost kx-btn--icon kx-btn--sm" aria-label={t("Close")} autoFocus>
            <Ico name="x" />
          </Dialog.Close>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 28px" }}>
          {KEY_GROUPS.map((g) => (
            <div key={g.label} style={{ display: "grid", gap: 2, alignContent: "start" }}>
              <span className="kx-label" style={{ marginBottom: 4 }}>
                {t(g.label)}
              </span>
              {g.rows.map(([label, keys]) => (
                <div key={label} className="kxh-row" style={{ gap: 10, minHeight: 34, boxShadow: "inset 0 -1px 0 0 var(--border-subtle)" }}>
                  <span className="kxh-grow" style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>
                    {t(label)}
                  </span>
                  <span className="kx-keys">
                    {keys.map((k) => (
                      <span key={k} className="kx-kbd">
                        {t(k)}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <span className="kx-help">
          {rich(t("Press {key} at any time to open this overview."), { key: <span className="kx-kbd">?</span> })}
        </span>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

