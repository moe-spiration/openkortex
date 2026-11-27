"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Command } from "cmdk";
import { ALL_ITEMS, NOTE_TYPES, OBJECT_ITEMS, RECENT_NOTE_IDS, VAULT_TREE, isLiveData, noteById, workspaceSnapshot } from "@/lib/workspace-data";
import { searchVault } from "@/lib/api/client";
import { REMOTE_DEBOUNCE_MS, REMOTE_MIN_CHARS, hitFromSearch, mergePaletteHits, type PaletteHit } from "@/lib/shell/palette-search";
import { canBrief, entrySubtitle, isSingleTerm, matchFolders } from "@/lib/shell/palette-ruhe";
import { useCapture } from "@/lib/shell/capture";
import { useCopilotChat } from "@/lib/shell/copilot-chat";
import { useFavorites } from "@/lib/shell/favorites";
import { useNotes } from "@/lib/notes/store";
import { useShell } from "@/lib/shell/store";
import { Pictogram } from "@/components/motion/Pictogram";
import { intlLocale, t } from "@/i18n";
import { useAsk } from "./useAsk";
import { Ico, type IconId } from "./icons";

/*
 * Command palette in the Ruhe look (gap web-a §5, mock `palette`): a 640 px sheet on l2, the query in 15 px with an
 * accent caret, "Einträge" first (type icon, title, grey "Typ · Detail", ↵ on the active row), then "Aktionen" for the
 * active entry (Tab asks the agent, Alt+B briefing, Alt+F favourite, Alt+M move), then matching jumps and commands.
 * "Verschieben nach …" turns the palette into a folder picker (Backspace or Esc goes back). Nothing found shows the
 * search pictogram above the two fallbacks (ask, capture). Logic shared with Classic: hybrid search, capture, jumps.
 */

export interface PaletteCmd {
  icon: IconId;
  label: string;
  hint: string;
  run: () => void;
}

interface Entry {
  id: string;
  title: string;
  type: string;
  icon: IconId;
  sub: string;
}

interface Row {
  key: string;
  icon: IconId;
  label: string;
  sub?: string;
  keys?: string[];
  accent?: boolean;
  run: () => void;
}

const metaOf = (id: string): Record<string, unknown> | undefined => OBJECT_ITEMS.find((o) => o.id === id)?.metadata;

export function PaletteRuhe({ jumps, commands }: { jumps: (close: () => void) => PaletteCmd[]; commands: (close: () => void) => PaletteCmd[] }) {
  const shell = useShell();
  const { setPalette, showToast } = shell;
  const ask = useAsk();
  const chat = useCopilotChat();
  const { capture, captureData } = useCapture();
  const favs = useFavorites();
  const notes = useNotes();
  const [text, setText] = useState("");
  const [value, setValue] = useState("");
  const [entryId, setEntryId] = useState<string | null>(null);
  const [moving, setMoving] = useState<Entry | null>(null);

  const close = () => setPalette(false);
  const q = text.trim();
  const ql = q.toLowerCase();

  const [remote, setRemote] = useState<{ q: string; hits: PaletteHit[] } | null>(null);
  useEffect(() => {
    if (moving || !isLiveData() || q.length < REMOTE_MIN_CHARS) return;
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
  }, [q, moving]);
  const remoteHits = remote && remote.q === q ? remote.hits : null;

  const entries: Entry[] = useMemo(() => {
    const today = workspaceSnapshot().today;
    const locale = intlLocale();
    const toEntry = (h: PaletteHit, snippet?: string): Entry => {
      const n = noteById(h.id);
      const type = n?.dbType ?? n?.type ?? h.type ?? "note";
      const meta = NOTE_TYPES[(n?.type ?? "note") as keyof typeof NOTE_TYPES];
      const typeLabel = meta?.label ?? t("Note");
      return {
        id: h.id,
        title: h.title,
        type: n?.type ?? type,
        icon: meta?.icon ?? "file-text",
        sub: entrySubtitle({ type, typeLabel, date: n?.date, metadata: metaOf(h.id), snippet, today, locale }),
      };
    };
    if (!ql)
      return RECENT_NOTE_IDS.map((id) => noteById(id))
        .filter((n) => !!n)
        .slice(0, 5)
        .map((n) => toEntry({ id: n.id, title: n.title, hint: "" }));
    // Rank: title, then path, then a mention in the summary ("Notiz · erwähnt Jonas").
    const rank = (n: (typeof ALL_ITEMS)[number]) =>
      n.title.toLowerCase().includes(ql) ? 0 : n.path.toLowerCase().includes(ql) ? 1 : n.tldr.toLowerCase().includes(ql) ? 2 : 3;
    const ranked = ALL_ITEMS.map((n) => ({ n, r: rank(n) }))
      .filter((x) => x.r < 3)
      .sort((a, b) => a.r - b.r);
    const mentions = new Set(ranked.filter((x) => x.r === 2).map((x) => x.n.id));
    const local = ranked.map(({ n }) => ({ id: n.id, title: n.title, hint: "" }));
    const remoteById = new Map((remoteHits ?? []).map((h) => [h.id, h]));
    return mergePaletteHits(local, remoteHits, 6).map((h) => {
      const r = remoteById.get(h.id);
      // A passage only says something when it is not just the folder.
      const snippet = r && r.hint && !r.hint.includes("/") ? r.hint : mentions.has(h.id) ? t("mentions {query}", { query: q }) : undefined;
      return toEntry(h, snippet);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ql, remoteHits]);

  // The entry the actions refer to: the active row when it is an entry, else the last one, else the first.
  const entry = entries.find((e) => e.id === entryId) ?? entries[0] ?? null;
  useEffect(() => {
    if (value.startsWith("e:")) setEntryId(value.slice(2));
  }, [value]);

  const fav = entry ? favs.list.some((f) => f.id === entry.id) : false;

  const askAgent = (question: string) => {
    close();
    shell.setCmode("ask");
    ask(question);
  };
  const question = entry && q && isSingleTerm(q) && canBrief(entry.type) ? t("What is open with {name}?", { name: q }) : q;

  const brief = (e: Entry) => {
    if (!chat.live) {
      showToast(t("The agent needs an account (not available in mock mode)"));
      return;
    }
    close();
    shell.setCmode("ask");
    chat.send(`/briefing ${e.title}`, { skill: "briefing" });
  };
  const toggleFav = (e: Entry) => {
    if (fav) {
      void favs.unpin(e.id);
      showToast(t("Removed from favorites: {title}", { title: e.title }));
    } else {
      void favs.pin(e.id);
      showToast(t("Added to favorites: {title}", { title: e.title }));
    }
    close();
  };
  const startMove = (e: Entry) => {
    setMoving(e);
    setText("");
    setValue("");
  };
  const moveTo = (e: Entry, path: string) => {
    close();
    if (!notes.items[e.id]) {
      showToast(t("“{title}” can only be moved once it is open", { title: e.title }));
      return;
    }
    notes.moveTo(e.id, path);
    showToast(t("Moved to {folder}", { folder: path }));
  };

  type Group = { label: string; rows: Row[] };
  const groups: Group[] = useMemo(() => {
    if (moving) {
      const folders = matchFolders(VAULT_TREE, q, 10);
      return [
        {
          label: t("Folders"),
          rows: folders.map((f) => ({ key: "f:" + f.path, icon: "folder" as IconId, label: f.name, sub: f.path !== f.name ? f.path : undefined, run: () => moveTo(moving, f.path) })),
        },
      ];
    }
    const out: Group[] = [];
    if (entries.length)
      out.push({
        label: q ? t("Entries") : t("Recently opened"),
        rows: entries.map((e) => ({
          key: "e:" + e.id,
          icon: e.icon,
          label: e.title,
          sub: e.sub,
          run: () => {
            close();
            shell.openNote(e.id);
          },
        })),
      });
    const acts: Row[] = [];
    if (q)
      acts.push({
        key: "a:ask",
        icon: "orbit-sparkles",
        accent: true,
        label: t("Ask the agent: “{question}”", { question }),
        keys: ["Tab"],
        run: () => askAgent(question),
      });
    if (entry) {
      if (canBrief(entry.type))
        acts.push({ key: "a:brief", icon: "square-pen", label: t("Create a briefing for {title}", { title: entry.title }), keys: ["Alt", "B"], run: () => brief(entry) });
      acts.push({ key: "a:fav", icon: "star", label: fav ? t("Remove from favorites") : t("Add to favorites"), keys: ["Alt", "F"], run: () => toggleFav(entry) });
      acts.push({ key: "a:move", icon: "folder", label: t("Move to …"), keys: ["Alt", "M"], run: () => startMove(entry) });
    }
    if (q)
      acts.push({
        key: "a:capture",
        icon: "inbox",
        label: t("Capture as a thought: {query}", { query: q }),
        run: () => {
          close();
          void capture({ text: q });
        },
      });
    if (acts.length && (entries.length || q)) out.push({ label: t("Actions"), rows: acts });
    const match = (l: string) => !ql || l.toLowerCase().includes(ql);
    const jumpRows = q ? jumps(close).filter((j) => match(j.label)) : [];
    if (jumpRows.length) out.push({ label: t("Jump to"), rows: jumpRows.map((j) => ({ key: "j:" + j.label, icon: j.icon, label: j.label, sub: j.hint, run: j.run })) });
    const cmdRows = commands(close).filter((c) => match(c.label));
    if (cmdRows.length && (q || !entries.length)) out.push({ label: t("Commands"), rows: cmdRows.map((c) => ({ key: "c:" + c.label, icon: c.icon, label: c.label, sub: c.hint, run: c.run })) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, q, ql, entries, entry?.id, fav, question, chat.live]);

  const nothing = !moving && !!q && !entries.length && !groups.some((g) => g.label === t("Jump to") || g.label === t("Commands"));

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (moving && (e.key === "Escape" || (e.key === "Backspace" && !text))) {
      e.preventDefault();
      e.stopPropagation();
      setMoving(null);
      setText("");
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && q && !moving) {
      e.preventDefault();
      askAgent(question);
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && entry && !moving) {
      const k = e.key.toLowerCase();
      if (k === "b" && canBrief(entry.type)) {
        e.preventDefault();
        brief(entry);
      } else if (k === "f") {
        e.preventDefault();
        toggleFav(entry);
      } else if (k === "m") {
        e.preventDefault();
        startMove(entry);
      }
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="kx-scrim kx-dlg-backdrop rz-pal-dim" />
        <Dialog.Popup
          className="kx-dlg rz-pal"
          aria-label={t("Command palette")}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (captureData(e.dataTransfer)) close();
          }}
        >
          <Command shouldFilter={false} loop label={t("Command palette")} value={value} onValueChange={setValue} onKeyDown={onKey}>
            <div className="rz-pal-q">
              <Ico name={moving ? "folder" : "search"} size={16} />
              {moving && <span className="rz-pal-scope kx-truncate">{moving.title}</span>}
              <Command.Input
                autoFocus
                className="rz-pal-input"
                aria-label={moving ? t("Move to …") : t("Search, jump or run an action")}
                placeholder={moving ? t("Choose a folder …") : t("Search, jump or run an action")}
                value={text}
                onValueChange={setText}
                onPaste={(e) => {
                  if (e.clipboardData.files.length) {
                    e.preventDefault();
                    captureData(e.clipboardData);
                    close();
                  }
                }}
              />
              <span className="rz-pal-esc">Esc</span>
            </div>
            <Command.List className="rz-pal-body kx-scroll" aria-label={t("Results")}>
              {nothing && (
                <div className="rz-pal-empty kx-palette-empty">
                  <Pictogram kind="search" size="sm" className="kx-art-ruhe" />
                  <span>{t("Nothing found for “{query}”", { query: q })}</span>
                </div>
              )}
              {groups.map((g) => (
                <Command.Group key={g.label} heading={g.label} className="rz-pal-g">
                  {g.rows.map((r) => (
                    <Command.Item key={r.key} value={r.key} className="rz-pal-row" onSelect={r.run}>
                      <Ico name={r.icon} size={15} className={r.accent ? "rz-pal-acc" : undefined} />
                      <span className="rz-pal-t">{r.label}</span>
                      {r.sub && <span className="rz-pal-s">{r.sub}</span>}
                      <span className="rz-pal-r">
                        {r.keys
                          ? r.keys.map((k) => <kbd key={k}>{k}</kbd>)
                          : r.key.startsWith("e:") && (
                              <kbd className="rz-pal-enter" aria-hidden>
                                ↵
                              </kbd>
                            )}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
            <div className="rz-pal-ft">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd>
                {t("select")}
              </span>
              <span>
                <kbd>↵</kbd>
                {moving ? t("move") : t("open")}
              </span>
              {moving ? (
                <span>
                  <kbd>Esc</kbd>
                  {t("back")}
                </span>
              ) : (
                <span>
                  <kbd>Tab</kbd>
                  {t("Ask the agent")}
                </span>
              )}
              <span className="rz-pal-ft-end">
                <kbd>Ctrl</kbd>
                <kbd>K</kbd>
              </span>
            </div>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

