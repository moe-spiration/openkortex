// Tab-Manager im Toby-Stil, gemeinsam für Side-Panel und Vollbild (tabs.html): Sessions als Sammlungen mit
// Tab-Karten, offene Tabs als ziehbare Karten. Drag & Drop mit dnd-kit (Maus, Touch, Tastatur), Rückmeldungen als
// Sonner-Toasts mit "Rückgängig". Gespeichert wird im Hintergrunddienst (lib/sessions.ts: erst nach der
// Server-Bestätigung schließen); die Ansicht arbeitet optimistisch und gleicht über chrome.storage ab.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { Button } from "@kortex/ui";
import {
  AppWindow,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderInput,
  Globe,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  SquareDashedMousePointer,
  Trash2,
  X,
} from "lucide-react";
import {
  addTabsToSession,
  applySessionOrder,
  deleteSessionEntry,
  removeTabAt,
  renameSessionEntry,
  saveSessionEdits,
  saveSessionOrder,
  sessionKey,
  shiftKey,
  undoSessionDelete,
  type SavedSession,
} from "../lib/library";
import { closeTabsViaBackground, reopenTabsViaBackground, saveSessionViaBackground } from "../lib/messages";
import { NEW_SESSION_ID, openDndId, resolveDrop, sessionDndId, tabDndId, type DndData, type DropAction, type OpenTab } from "../lib/session-dnd";
import {
  cardTitle,
  faviconSrc,
  faviconStrip,
  kortexSessionUrl,
  sessionDateLabel,
  sessionMarkdown,
  tabDomain,
} from "../lib/session-view";
import { savableTabs } from "../lib/sessions";
import { DEFAULT_SETTINGS, chromeStore, loadSettings } from "../lib/settings";
import { useLive } from "./useLive";
import { t, tn } from "../i18n";

export type BoardLayout = "panel" | "page";
type LiveTab = chrome.tabs.Tab;

/* ---------- small pieces ---------- */

/** Favicon of a tab, or the Lucide globe when there is none or it fails to load. */
export function Favicon({ src, size = 16 }: { src?: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const url = faviconSrc(src);
  if (!url || broken) return <Globe className="kx-tm-fav kx-tm-fav--none" width={size} height={size} aria-hidden />;
  return <img className="kx-tm-fav" src={url} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

function IconButton({ label, onClick, children, disabled, className }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={className}>
      {children}
    </Button>
  );
}

/** Kleines Menü (Tastatur: Pfeile, Pos1/Ende, Escape). Einträge mit `key` und Text; `onPick` schließt das Menü. */
type MenuEntry = { key: string; label: string; meta?: string; icon?: ReactNode; danger?: boolean };
export function Menu({ label, icon, items, onPick, empty, className }: { label: string; icon: ReactNode; items: MenuEntry[]; onPick: (key: string) => void; empty?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const entries = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => entries[(i + entries.length) % entries.length]?.focus();
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(entries.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div className={`kx-tm-menuwrap ${className ?? ""}`} ref={wrap} data-open={open || undefined} onPointerDown={(e) => e.stopPropagation()}>
      <Button
        ref={trigger}
        size="icon-sm"
        variant="ghost"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        {icon}
      </Button>
      {open && (
        <ul id={menuId} role="menu" aria-label={label} className="kx-tm-menu" onKeyDown={onKey}>
          {items.length === 0 && <li role="none" className="kx-tm-menu-empty">{empty ?? t("Nothing here.")}</li>}
          {items.map((it) => (
            <li key={it.key} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="kx-tm-menu-item"
                data-danger={it.danger || undefined}
                onClick={() => {
                  close();
                  onPick(it.key);
                }}
              >
                {it.icon}
                <span className="kx-truncate kxh-grow">{it.label}</span>
                {it.meta && <span className="kx-tm-menu-meta">{it.meta}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const sessionMenuItems = (sessions: readonly SavedSession[], except?: string): MenuEntry[] =>
  sessions
    .filter((s) => sessionKey(s) !== except)
    .slice(0, 12)
    .map((s) => ({ key: sessionKey(s), label: cardTitle(s), meta: String(s.tabs.length) }));

/* ---------- collapsed collections (per browser, a view preference only) ---------- */

const COLLAPSED_KEY = "kortex.sp.collapsed";
function readCollapsed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
const isCollapsed = (key: string) => readCollapsed().includes(key);
function rememberCollapsed(key: string, collapsed: boolean) {
  try {
    const rest = readCollapsed().filter((k) => k !== key);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed ? [key, ...rest].slice(0, 300) : rest));
  } catch {
    /* storage blocked: the view just forgets */
  }
}

/* ---------- board state: optimistic edits, drag state, feedback ---------- */

interface Board {
  layout: BoardLayout;
  baseUrl: string;
  /** all sessions (merged, ordered) with the optimistic edits applied */
  sessions: SavedSession[];
  active: DndData | null;
  /** the session a drag currently points at, and the tab index inside it */
  over: { key: string; index?: number } | null;
  apply: (action: DropAction | null) => Promise<void>;
  shift: (key: string, delta: number) => Promise<void>;
  removeTab: (s: SavedSession, index: number) => Promise<void>;
  remove: (s: SavedSession) => Promise<void>;
  rename: (s: SavedSession, title: string) => void;
  /** Speichern (und schließen) der gewählten offenen Tabs mit Rückmeldung; true, wenn gespeichert. */
  saveTabs: (opts: { windowId: number; tabIds: number[]; close: boolean; name?: string; onSaved?: () => void }) => Promise<boolean>;
}

const BoardContext = createContext<Board | null>(null);
const useBoard = () => {
  const b = useContext(BoardContext);
  if (!b) throw new Error("TabBoard missing");
  return b;
};

const UNDO_MS = 8000;
const loadBoardSettings = () => loadSettings(chromeStore);

function applyEdited(list: readonly SavedSession[], edited: readonly SavedSession[]) {
  const byKey = new Map(edited.map((e) => [sessionKey(e), e]));
  return list.map((s) => byKey.get(sessionKey(s)) ?? s);
}

/** Pointer first (precise in grids), tab cards before the collection around them; keyboard falls back to closest. */
const collision: CollisionDetection = (args) => {
  const kind = (args.active.data.current as DndData | undefined)?.kind;
  const dataOf = (id: string | number) => args.droppableContainers.find((c) => c.id === id)?.data.current as DndData | undefined;
  if (kind === "session") {
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => (c.data.current as DndData | undefined)?.kind === "session") });
  }
  const targets = args.droppableContainers.filter((c) => ["tab", "session", "new"].includes((c.data.current as DndData | undefined)?.kind ?? ""));
  const hits = pointerWithin({ ...args, droppableContainers: targets });
  if (hits.length) {
    const tabs = hits.filter((h) => dataOf(h.id)?.kind === "tab" || dataOf(h.id)?.kind === "new");
    return tabs.length ? tabs : hits;
  }
  return args.pointerCoordinates ? [] : closestCenter({ ...args, droppableContainers: targets });
};

export function TabBoard({
  layout,
  baseUrl,
  sessions: all,
  children,
}: {
  layout: BoardLayout;
  baseUrl: string;
  sessions: SavedSession[];
  children: ReactNode;
}) {
  const [optimistic, setOptimistic] = useState<SavedSession[] | null>(null);
  useEffect(() => setOptimistic(null), [all]);
  const sessions = optimistic ?? all;
  const [active, setActive] = useState<DndData | null>(null);
  const [over, setOver] = useState<Board["over"]>(null);
  const { value: settings } = useLive(loadBoardSettings, DEFAULT_SETTINGS);
  const closeOnDrop = settings.closeOnDrop;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const apply = useCallback(
    async (action: DropAction | null) => {
      if (!action) return;
      switch (action.type) {
        case "noop":
          if (action.message) toast(action.message);
          return;
        case "reorder":
          setOptimistic(applySessionOrder(sessions, action.keys));
          await saveSessionOrder(chromeStore, action.keys);
          return;
        case "edit":
          setOptimistic(applyEdited(sessions, action.sessions));
          await saveSessionEdits(chromeStore, action.sessions);
          toast.success(action.message);
          return;
        case "add-open": {
          const dst = sessions.find((s) => sessionKey(s) === action.sessionKey);
          const edited = dst && addTabsToSession(dst, action.tabs, action.index);
          if (!dst || !edited) {
            toast(dst ? t("Already in “{name}”", { name: cardTitle(dst) }) : t("Already in the session"));
            return;
          }
          setOptimistic(applyEdited(sessions, [edited]));
          await saveSessionEdits(chromeStore, [edited]);
          const added = edited.tabs.length - dst.tabs.length;
          const live = action.tabs as (OpenTab & { id?: number; windowId?: number })[];
          const windowId = live.find((tab) => tab.windowId !== undefined)?.windowId;
          const ids = live.flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));
          // Saved locally first, so closing never loses the tab (like "Save & close").
          const closed = closeOnDrop && windowId !== undefined && ids.length ? await closeTabsViaBackground(windowId, ids) : [];
          const reopen = live.filter((tab) => tab.id !== undefined && closed.includes(tab.id)).map((tab) => tab.url!);
          toast.success(
            reopen.length
              ? tn(added, "{n} tab moved to “{name}” and closed", "{n} tabs moved to “{name}” and closed", { name: cardTitle(dst) })
              : tn(added, "{n} tab added to “{name}”", "{n} tabs added to “{name}”", { name: cardTitle(dst) }),
            reopen.length && windowId !== undefined
              ? { action: { label: t("Restore"), onClick: () => void reopenTabsViaBackground(windowId, reopen) }, duration: UNDO_MS }
              : undefined,
          );
          return;
        }
        case "new-session":
          // handled by the open-tabs section (it knows the window and the tab ids)
          return;
      }
    },
    [sessions, closeOnDrop],
  );

  const shift = useCallback(
    async (key: string, delta: number) => {
      const keys = sessions.map(sessionKey);
      const next = shiftKey(keys, key, delta);
      if (next.join("\n") === keys.join("\n")) return;
      setOptimistic(applySessionOrder(sessions, next));
      await saveSessionOrder(chromeStore, next);
      toast(t("Session at position {position} of {total}", { position: next.indexOf(key) + 1, total: next.length }));
    },
    [sessions],
  );

  const removeTab = useCallback(
    async (s: SavedSession, index: number) => {
      const edited = removeTabAt(s, index);
      if (!edited) return;
      setOptimistic(applyEdited(sessions, [edited]));
      await saveSessionEdits(chromeStore, [edited]);
      toast(t("Tab removed from the session"), {
        action: { label: t("Undo"), onClick: () => void saveSessionEdits(chromeStore, [s]) },
        duration: UNDO_MS,
      });
    },
    [sessions],
  );

  const remove = useCallback(async (s: SavedSession) => {
    const token = await deleteSessionEntry(chromeStore, s);
    const server = !!s.item_id;
    toast(server ? t("“{name}” removed from the list", { name: cardTitle(s) }) : t("“{name}” deleted", { name: cardTitle(s) }), {
      description: server ? t("The session is kept in Kortex.") : undefined,
      action: { label: t("Undo"), onClick: () => void undoSessionDelete(chromeStore, token) },
      duration: UNDO_MS,
    });
  }, []);

  const rename = useCallback((s: SavedSession, title: string) => {
    if (!title.trim() || title.trim() === cardTitle(s)) return;
    void renameSessionEntry(chromeStore, s, title);
  }, []);

  const saveTabs = useCallback<Board["saveTabs"]>(async ({ windowId, tabIds, close, name, onSaved }) => {
    const id = toast.loading(
      close
        ? tn(tabIds.length, "Saving and closing {n} tab …", "Saving and closing {n} tabs …")
        : tn(tabIds.length, "Saving {n} tab …", "Saving {n} tabs …"),
    );
    const res = await saveSessionViaBackground({ windowId, tabIds, close, windowName: name?.trim() || undefined });
    if (!res.ok) {
      if (res.reason === "queued") toast.warning(res.message, { id, duration: 8000 });
      else toast.error(res.message, { id, duration: 8000 });
      return res.reason === "queued";
    }
    onSaved?.();
    const mockOnly = !!res.itemId?.startsWith("mock-");
    const reopen = res.closedTabs?.length ? res.closedTabs.map((tab) => tab.url) : null;
    if (res.closed) {
      toast.success(res.keptOpen ? tn(res.saved, "{n} tab saved, {closed} closed", "{n} tabs saved, {closed} closed", { closed: res.closed }) : tn(res.saved, "{n} tab saved and closed", "{n} tabs saved and closed"), {
        id,
        description: res.keptOpen ? tn(res.keptOpen, "{n} stays open (pinned or cannot be closed right now).", "{n} stay open (pinned or cannot be closed right now).") : undefined,
        action: reopen ? { label: t("Restore"), onClick: () => void reopenTabsViaBackground(windowId, reopen) } : undefined,
        duration: UNDO_MS,
      });
    } else if (mockOnly && close) {
      toast.warning(tn(res.saved, "{n} tab saved locally only", "{n} tabs saved locally only"), { id, description: t("Kortex is not connected (options), so the tabs stay open."), duration: 8000 });
    } else if (close && res.keptOpen) {
      toast.warning(tn(res.saved, "{n} tab saved, tabs stayed open", "{n} tabs saved, tabs stayed open"), { id, description: t("Kortex does not close pinned tabs; the browser did not let the others be closed right now."), duration: 8000 });
    } else {
      toast.success(tn(res.saved, "{n} tab saved", "{n} tabs saved"), { id });
    }
    return true;
  }, []);

  const board: Board = { layout, baseUrl, sessions, active, over, apply, shift, removeTab, remove, rename, saveTabs };

  const onStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DndData | undefined;
    setActive(data ?? null);
  };
  const onOver = (e: DragOverEvent) => {
    const data = e.over?.data.current as DndData | undefined;
    if (data?.kind === "new") return setOver({ key: NEW_SESSION_ID });
    if (!data || !("sessionKey" in data)) return setOver(null);
    setOver({ key: data.sessionKey, ...(data.kind === "tab" ? { index: data.index } : {}) });
  };
  const onEnd = (e: DragEndEvent) => {
    const a = e.active.data.current as DndData | undefined;
    const o = e.over?.data.current as DndData | undefined;
    setActive(null);
    setOver(null);
    const action = resolveDrop(a, o, sessions);
    if (action?.type === "new-session" && a?.kind === "open") {
      const tab = a.tab as OpenTab & { id?: number; windowId?: number };
      if (tab.id !== undefined && tab.windowId !== undefined) void saveTabs({ windowId: tab.windowId, tabIds: [tab.id], close: closeOnDrop });
      return;
    }
    void apply(action);
  };
  const onCancel = () => {
    setActive(null);
    setOver(null);
  };

  return (
    <BoardContext.Provider value={board}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onStart}
        onDragOver={onOver}
        onDragEnd={onEnd}
        onDragCancel={onCancel}
        accessibility={{
          screenReaderInstructions: { draggable: t("Space to pick up, arrow keys to move, space to drop, Escape to cancel.") },
          announcements: {
            onDragStart: () => t("Picked up."),
            onDragOver: ({ over: o }) => (o ? t("Over a target.") : t("No target.")),
            onDragEnd: ({ over: o }) => (o ? t("Dropped.") : t("Not dropped.")),
            onDragCancel: () => t("Cancelled."),
          },
        }}
      >
        <div className={`kx-tm kx-tm--${layout}`} data-dragging={active?.kind}>
          {children}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
          {active && <DragGhost data={active} sessions={sessions} over={over} closes={closeOnDrop} />}
        </DragOverlay>
      </DndContext>
    </BoardContext.Provider>
  );
}

/** What releasing here does, said where the eye is: on the dragged card. */
function dropHint(data: DndData, over: Board["over"], sessions: readonly SavedSession[], closes: boolean): { text: string; sub?: string; none?: boolean } | null {
  if (data.kind !== "open" && data.kind !== "tab") return null;
  const name = (key: string) => {
    const s = sessions.find((x) => sessionKey(x) === key);
    return s ? cardTitle(s) : "";
  };
  const closing = data.kind === "open" && closes ? t("The tab is closed afterwards") : undefined;
  if (!over) return { text: t("Not over a session: release to cancel"), none: true };
  if (over.key === NEW_SESSION_ID) return { text: t("New session from this tab"), sub: closing };
  if (data.kind === "tab" && over.key === data.sessionKey) return { text: t("Reorder in this session") };
  return { text: data.kind === "open" ? t("Add to “{name}”", { name: name(over.key) }) : t("Move to “{name}”", { name: name(over.key) }), sub: closing };
}

function DragGhost({ data, sessions, over, closes }: { data: DndData; sessions: readonly SavedSession[]; over: Board["over"]; closes: boolean }) {
  const hint = dropHint(data, over, sessions, closes);
  const face = (title: string, url: string, favicon?: string) => (
    <div className="kx-tm-ghost">
      <CardFace title={title} url={url} favicon={favicon} ghost />
      {hint && (
        <span className="kx-tm-ghosthint" data-none={hint.none || undefined}>
          <strong className="kx-truncate">{hint.text}</strong>
          {hint.sub && <span>{hint.sub}</span>}
        </span>
      )}
    </div>
  );
  if (data.kind === "open") return face(data.tab.title || tabDomain(data.tab.url ?? ""), data.tab.url ?? "", data.tab.favIconUrl);
  if (data.kind === "tab") {
    const tab = sessions.find((s) => sessionKey(s) === data.sessionKey)?.tabs[data.index];
    return tab ? face(tab.title || tabDomain(tab.url), tab.url, tab.favicon) : null;
  }
  if (data.kind === "session") {
    const s = sessions.find((x) => sessionKey(x) === data.sessionKey);
    return s ? (
      <div className="kx-tm-ghostsession">
        <GripVertical aria-hidden /> <span className="kx-truncate">{cardTitle(s)}</span> <span className="kx-tm-count">{s.tabs.length}</span>
      </div>
    ) : null;
  }
  return null;
}

/* ---------- a tab card (saved or open) ---------- */

/**
 * Cards drag with the mouse/touch only: Enter and Space on the card keep opening it (the keyboard moves cards with
 * Alt+Pfeil and the "Verschieben nach …" menu instead of dnd-kit's keyboard drag).
 */
const pointerOnly = (listeners: ReturnType<typeof useDraggable>["listeners"]) => listeners?.onPointerDown as ((e: ReactPointerEvent) => void) | undefined;

function CardFace({ title, url, favicon, ghost }: { title: string; url: string; favicon?: string; ghost?: boolean }) {
  return (
    <span className="kx-tm-face" data-ghost={ghost || undefined}>
      <span className="kx-tm-favbox">
        <Favicon src={favicon} />
      </span>
      <span className="kx-tm-cardtitle">{title}</span>
      <span className="kx-tm-host kx-truncate">{tabDomain(url) || url}</span>
    </span>
  );
}

/** A saved tab: click opens it in the background, drag sorts it or moves it into another session. */
function SavedTabCard({ s, index, onKey }: { s: SavedSession; index: number; onKey: (e: KeyboardEvent<HTMLButtonElement>, i: number) => void }) {
  const board = useBoard();
  const key = sessionKey(s);
  const tab = s.tabs[index]!;
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tabDndId(key, s.tabs, index),
    data: { kind: "tab", sessionKey: key, index } satisfies DndData,
  });
  const insert = board.over?.key === key && board.over.index === index && board.active?.kind !== "session" && !(board.active?.kind === "tab" && board.active.sessionKey === key);
  return (
    <li
      ref={setNodeRef}
      className="kx-tm-card"
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-dragging={isDragging || undefined}
      data-insert={insert || undefined}
      onPointerDown={pointerOnly(listeners)}
    >
      <button
        type="button"
        className="kx-tm-cardbtn"
        onClick={() => void chrome.tabs.create({ url: tab.url, active: false })}
        onKeyDown={(e) => onKey(e, index)}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        title={t("Open in the background: {url}", { url: tab.url })}
      >
        <CardFace title={tab.title || tabDomain(tab.url) || tab.url} url={tab.url} favicon={tab.favicon} />
      </button>
      <div className="kx-tm-cardacts" onPointerDown={(e) => e.stopPropagation()}>
        <Menu
          label={t("Move to …")}
          icon={<FolderInput />}
          items={sessionMenuItems(board.sessions, key)}
          empty={t("No other session yet.")}
          onPick={(to) => void board.apply(resolveDrop({ kind: "tab", sessionKey: key, index }, { kind: "session", sessionKey: to }, board.sessions))}
        />
        <IconButton label={t("Remove from session")} onClick={() => void board.removeTab(s, index)}>
          <X />
        </IconButton>
      </div>
    </li>
  );
}

/** An open browser tab: click switches to it, drag puts it into a session, x closes it. */
function OpenTabCard({ t: live, picking, checked, onToggle }: { t: LiveTab; picking: boolean; checked: boolean; onToggle: () => void }) {
  const board = useBoard();
  const tab: OpenTab & { id?: number; windowId?: number } = { url: live.url, title: live.title, favIconUrl: live.favIconUrl, id: live.id, windowId: live.windowId };
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: openDndId(live.id!), data: { kind: "open", tab } satisfies DndData, disabled: picking });
  const title = live.title || tabDomain(live.url!) || live.url!;
  return (
    <li
      ref={setNodeRef}
      className="kx-tm-card kx-tm-card--open"
      data-dragging={isDragging || undefined}
      data-checked={picking && checked ? true : undefined}
      data-current={live.active || undefined}
      onPointerDown={picking ? undefined : pointerOnly(listeners)}
    >
      {picking ? (
        <label className="kx-tm-cardbtn">
          <input type="checkbox" className="kx-check kx-tm-pick" checked={checked} onChange={onToggle} aria-label={title} />
          <CardFace title={title} url={live.url!} favicon={live.favIconUrl} />
        </label>
      ) : (
        <button
          type="button"
          className="kx-tm-cardbtn"
          title={t("Switch to this tab: {url}", { url: live.url ?? "" })}
          aria-current={live.active ? "page" : undefined}
          onClick={() => {
            void chrome.tabs.update(live.id!, { active: true });
            if (board.layout === "page" && live.windowId !== undefined) void chrome.windows.update(live.windowId, { focused: true }).catch(() => undefined);
          }}
        >
          <CardFace title={title} url={live.url!} favicon={live.favIconUrl} />
        </button>
      )}
      {!picking && (
        <div className="kx-tm-cardacts" onPointerDown={(e) => e.stopPropagation()}>
          <Menu
            label={t("Add to session")}
            icon={<Plus />}
            items={sessionMenuItems(board.sessions)}
            empty={t("No session yet.")}
            onPick={(key) => void board.apply({ type: "add-open", tabs: [tab], sessionKey: key })}
          />
          <IconButton label={t("Close tab")} onClick={() => void chrome.tabs.remove(live.id!).catch(() => undefined)}>
            <X />
          </IconButton>
        </div>
      )}
    </li>
  );
}

/* ---------- open tabs of one window: save (and close), pick, drag ---------- */

/** Open tabs shown before "N weitere" in the panel (the rest is one click away). */
const OPEN_ROWS = 6;

export function OpenTabsSection({
  windowId,
  tabs,
  title,
  loading,
  current,
}: {
  windowId: number;
  tabs: LiveTab[];
  title?: string;
  loading?: boolean;
  /** the window this view belongs to (the page marks the others) */
  current?: boolean;
}) {
  const board = useBoard();
  const heading = title ?? t("Open tabs");
  const list = useMemo(() => savableTabs(tabs) as LiveTab[], [tabs]);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const id = useId();
  const skipped = tabs.length - list.length;
  const chosen = picking ? list.filter((t) => t.id !== undefined && selected.has(t.id)) : list;

  const togglePicking = () => {
    if (!picking) {
      const marked = list.filter((t) => t.highlighted);
      setSelected(new Set((marked.length > 1 ? marked : list).map((t) => t.id!)));
    }
    setPicking(!picking);
  };
  const toggle = (tabId: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(tabId)) n.add(tabId);
      return n;
    });
  const run = async (close: boolean) => {
    if (!chosen.length || busy) return;
    setBusy(true);
    await board.saveTabs({
      windowId,
      tabIds: chosen.map((t) => t.id!),
      close,
      name,
      onSaved: () => {
        setName("");
        setPicking(false);
      },
    });
    setBusy(false);
  };

  const limit = board.layout === "panel" && !picking && !showAll ? OPEN_ROWS : Infinity;
  const shown = list.slice(0, limit);
  const count = picking ? `${chosen.length}` : `${list.length}`;

  return (
    <section className="kx-tm-open" aria-labelledby={`${id}-h`} data-current={current || undefined}>
      <header className="kx-tm-sechead">
        <h2 id={`${id}-h`} className="kx-tm-h">
          {heading}
          <span className="kx-tm-count">{loading ? "…" : list.length}</span>
        </h2>
        {skipped > 0 && !loading && (
          <span className="kx-tm-meta kx-truncate" title={t("Internal pages (chrome://, about:, files) are not saved")}>
            {t("+{n} internal", { n: skipped })}
          </span>
        )}
        <span className="kxh-grow" />
        <Button size="sm" variant="ghost" aria-pressed={picking} aria-controls={`${id}-list`} onClick={togglePicking} disabled={list.length === 0}>
          {picking ? <Check /> : <SquareDashedMousePointer />}
          {picking ? t("Done") : t("Select")}
        </Button>
      </header>

      {picking && (
        <div className="kx-tm-pickbar">
          <span className="kx-tm-meta kxh-grow">{t("{chosen} of {total} selected", { chosen: chosen.length, total: list.length })}</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(list.map((t) => t.id!)))}>{t("All")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("None")}</Button>
        </div>
      )}

      {list.length > 0 ? (
        <ul id={`${id}-list`} className="kx-tm-grid kx-tm-grid--open" aria-label={t("Tabs: {title}", { title: heading })}>
          {shown.map((t) => (
            <OpenTabCard key={t.id} t={t} picking={picking} checked={selected.has(t.id!)} onToggle={() => toggle(t.id!)} />
          ))}
        </ul>
      ) : (
        !loading && <p className="kx-tm-empty-line">{t("No tabs that can be saved in this window.")}</p>
      )}
      {list.length > shown.length && (
        <button type="button" className="kx-tm-more" aria-expanded={showAll} onClick={() => setShowAll(true)}>
          {tn(list.length - shown.length, "Show {n} more tab", "Show {n} more tabs")}
        </button>
      )}
      {showAll && board.layout === "panel" && !picking && list.length > OPEN_ROWS && (
        <button type="button" className="kx-tm-more" aria-expanded onClick={() => setShowAll(false)}>
          {t("Show less")}
        </button>
      )}

      <div className="kx-tm-savebar">
        <label className="kx-tm-name">
          <Pencil aria-hidden />
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run(true)} placeholder={t("Name the session (optional)")} aria-label={t("Name of the session")} />
        </label>
        <div className="kx-tm-saveacts">
          <Button variant="primary" className="kx-tm-primary" disabled={busy || chosen.length === 0} onClick={() => void run(true)} title={t("Saves to Kortex and closes the tabs as soon as Kortex has confirmed")}>
            {busy ? <span className="kx-spinner" aria-hidden /> : <X />}
            {chosen.length ? t("Save & close {count}", { count }) : t("No tabs selected")}
          </Button>
          <Button variant="secondary" disabled={busy || chosen.length === 0} onClick={() => void run(false)} title={t("Saves to Kortex, the tabs stay open")}>
            {t("Save only")}
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ---------- one saved session (Toby's collection) ---------- */

export function SessionBlock({ s, position }: { s: SavedSession; position: number }) {
  const board = useBoard();
  const key = sessionKey(s);
  const headRef = useRef<HTMLButtonElement>(null);
  const [open, setOpenState] = useState(() => !isCollapsed(key));
  const setOpen = (v: boolean) => {
    setOpenState(v);
    rememberCollapsed(key, !v);
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const title = cardTitle(s);
  const tabsId = useId();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: sessionDndId(key),
    data: { kind: "session", sessionKey: key } satisfies DndData,
  });
  const dropping = board.over?.key === key && board.active && board.active.kind !== "session" && !(board.active.kind === "tab" && board.active.sessionKey === key && board.over.index === undefined);
  const strip = faviconStrip(s.tabs, board.layout === "page" ? 12 : 8);
  const more = s.tabs.length - strip.length;

  const restore = () => void chrome.windows.create({ url: s.tabs.map((t) => t.url) });
  const openHere = () => s.tabs.forEach((t) => void chrome.tabs.create({ url: t.url, active: false }));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sessionMarkdown(s));
      toast.success(t("Copied as Markdown list"));
    } catch {
      toast.error(t("Copying not allowed"));
    }
  };

  // Enter/Escape end the edit; the blur that may follow when the input unmounts must not save again (or save after Escape).
  const done = useRef(false);
  const startRename = () => {
    done.current = false;
    setDraft(title);
    setEditing(true);
  };
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (save) board.rename(s, draft);
    requestAnimationFrame(() => headRef.current?.focus());
  };
  const onHeadKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "F2") {
      e.preventDefault();
      startRename();
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      void board.shift(key, e.key === "ArrowUp" ? -1 : 1);
      requestAnimationFrame(() => headRef.current?.focus());
    }
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    e.stopPropagation();
    const to = e.key === "ArrowUp" ? i - 1 : i + 1;
    if (to < 0 || to >= s.tabs.length) return;
    void board.apply(resolveDrop({ kind: "tab", sessionKey: key, index: i }, { kind: "tab", sessionKey: key, index: to }, board.sessions));
    requestAnimationFrame(() => document.getElementById(tabsId)?.querySelectorAll<HTMLElement>(".kx-tm-cardbtn")[to]?.focus());
  };

  const menu: MenuEntry[] = [
    { key: "open-here", label: t("Open all here"), icon: <Plus aria-hidden /> },
    { key: "rename", label: s.item_id ? t("Rename (here only)") : t("Rename"), icon: <Pencil aria-hidden /> },
    { key: "copy", label: t("Copy as Markdown list"), icon: <Copy aria-hidden /> },
    { key: "kortex", label: s.item_id ? t("Open in Kortex") : t("Sessions folder in Kortex"), icon: <ExternalLink aria-hidden /> },
    { key: "delete", label: s.item_id ? t("Remove from the list") : t("Delete session"), icon: <Trash2 aria-hidden />, danger: true },
  ];
  const onMenu = (k: string) => {
    if (k === "open-here") openHere();
    if (k === "rename") startRename();
    if (k === "copy") void copy();
    if (k === "kortex") {
      const url = kortexSessionUrl(board.baseUrl, s);
      if (url) void chrome.tabs.create({ url });
      else void chrome.runtime.openOptionsPage();
    }
    if (k === "delete") void board.remove(s);
  };

  return (
    <li
      ref={setNodeRef}
      className="kx-tm-session"
      data-key={key}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-open={open || undefined}
      data-drop={dropping || undefined}
      data-dragging={isDragging || undefined}
      aria-label={title}
    >
      <div className="kx-tm-shead">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="kx-tm-grip"
          aria-label={t("Move session (position {position})", { position })}
          title={t("Drag to reorder (keyboard: Alt+arrow up/down on the title)")}
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden />
        </button>
        {editing ? (
          <div className="kxh-row kxh-grow">
            <label className="kx-tm-name kxh-grow">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") finish(true);
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    finish(false);
                  }
                }}
                onBlur={() => finish(true)}
                aria-label={t("New name")}
                autoFocus
              />
            </label>
            <IconButton label={t("Apply name")} onClick={() => finish(true)}>
              <Check />
            </IconButton>
          </div>
        ) : (
          <button
            ref={headRef}
            type="button"
            className="kx-tm-stitle"
            aria-expanded={open}
            aria-controls={tabsId}
            aria-keyshortcuts="F2 Alt+ArrowUp Alt+ArrowDown"
            onClick={() => setOpen(!open)}
            onDoubleClick={startRename}
            onKeyDown={onHeadKey}
          >
            <ChevronRight className="kx-tm-chevron" aria-hidden />
            <span className="kx-tm-sname">{title}</span>
            <span className="kx-tm-count">{s.tabs.length}</span>
          </button>
        )}
        <span className="kx-tm-smeta kx-truncate">
          {[sessionDateLabel(s.saved_at), s.origin === "server" ? t("from Kortex") : ""].filter(Boolean).join(" · ")}
        </span>
        <div className="kx-tm-sacts">
          <Button size="sm" variant="ghost" className="kx-tm-openall" onClick={restore} title={t("Open all tabs in a new window")} disabled={s.tabs.length === 0}>
            <AppWindow /> <span className="kx-tm-btntext">{t("Open")}</span>
          </Button>
          <Menu label={t("Session actions")} icon={<MoreHorizontal />} items={menu} onPick={onMenu} />
        </div>
      </div>

      {!open && (
        <button type="button" className="kx-tm-strip" onClick={() => setOpen(true)} aria-label={tn(s.tabs.length, "Show {n} tab", "Show {n} tabs")}>
          {strip.map((t) => (
            <span key={t.url} className="kx-tm-favbox kx-tm-favbox--sm" title={tabDomain(t.url) || t.url}>
              <Favicon src={t.favicon} size={14} />
            </span>
          ))}
          {more > 0 && <span className="kx-tm-moretabs">+{more}</span>}
          {s.tabs.length === 0 && <span className="kx-tm-moretabs">{t("Empty, drag tabs here")}</span>}
        </button>
      )}

      {open && (
        <SortableContext items={s.tabs.map((_, i) => tabDndId(key, s.tabs, i))} strategy={rectSortingStrategy}>
          <ul id={tabsId} className="kx-tm-grid" aria-label={t("Tabs of {title}", { title })}>
            {s.tabs.map((t, i) => (
              <SavedTabCard key={tabDndId(key, s.tabs, i)} s={s} index={i} onKey={onTabKey} />
            ))}
            {s.tabs.length === 0 && <li className="kx-tm-dropslot">{t("Empty. Drag open tabs here.")}</li>}
          </ul>
        </SortableContext>
      )}
    </li>
  );
}

/** Drop target "Neue Session" while an open tab is dragged. */
export function NewSessionDrop() {
  const board = useBoard();
  const { setNodeRef, isOver } = useDroppable({ id: NEW_SESSION_ID, data: { kind: "new" } satisfies DndData });
  if (board.active?.kind !== "open") return null;
  return (
    <div ref={setNodeRef} className="kx-tm-newdrop" data-over={isOver || undefined}>
      <Plus aria-hidden />
      <span className="kx-tm-newdroptext">
        <strong>{t("New session")}</strong>
        <span>{t("Drop here to start a session with this tab")}</span>
      </span>
    </div>
  );
}

/** The sorted list of saved sessions. */
export function SessionList({ sessions }: { sessions: SavedSession[] }) {
  return (
    <SortableContext items={sessions.map((s) => sessionDndId(sessionKey(s)))} strategy={verticalListSortingStrategy}>
      <ul className="kx-tm-sessions">
        {sessions.map((s, i) => (
          <SessionBlock key={s.id} s={s} position={i + 1} />
        ))}
      </ul>
    </SortableContext>
  );
}

export const useBoardSessions = () => useBoard().sessions;
/** The board's actions for shells around it (Ruhe tab manager: the agent suggestion adds open tabs to a session). */
export const useBoardActions = () => {
  const b = useBoard();
  return { apply: b.apply, sessions: b.sessions };
};
