"use client";

import { useRouter } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { todayIso } from "@/lib/date/today";
import { NEW_NOTE_PICK_TEMPLATE } from "@/lib/shell/new-note";
import { DOMAIN_OBJECT_FOLDERS, NEW_OBJECT_TITLE } from "@/lib/objects/schema";
import { useNotes } from "@/lib/notes/store";
import { useCapture } from "@/lib/shell/capture";
import { objectHref } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { useDesktopMeeting } from "@/lib/shell/desktop-bridge";
import { SCRATCHPAD_COUNT_EVENT, SCRATCHPAD_EVENT, SCRATCHPAD_OPEN_EVENT, SCRATCHPAD_SHORTCUT_LABEL, SCRATCHPAD_TOGGLE } from "@/lib/scratchpad/client";
import { JOURNAL_DAY_HREF } from "@/lib/shell/nav";
import { hasWindowControls, subscribeWindowControls, windowControls } from "@/lib/shell/window-controls";
import { PRODUCT_NAME, t, tn, tx } from "@/i18n";
import { Ico, type IconId } from "./icons";
import { NavMenuButton } from "./MobileNav";
import { TabStrip } from "./TabBar";

/*
 * Titlebar of the frame (Tactile Craft v2, decision 2; dummy `Titlebar`): one bar across sidebar and canvas with
 * the logo, sidebar toggle (Ctrl+\), the document tabs, search (Ctrl+K, the command palette), the Scratchpad and the
 * "Neu" split button and, once the desktop app registers a controller, Windows-style window buttons.
 * Left of "Neu" sits the Scratchpad button (fx3; also in the Neu menu, the orbit bar and Alt+J).
 * Below 860 px it is compact: menu button, the active tab, Scratchpad, "Neu" and search.
 */

/** One flat key chip per shortcut ("Ctrl K", "Alt N"), as in the prototype's .kbd. */
const keys = (k: string[]) => (
  <span className="tc-keys" aria-hidden>
    <kbd className="kx-kbd">{k.join(" ")}</kbd>
  </span>
);

interface NewItem {
  label: string;
  hint?: string;
  icon: IconId;
  keys?: string[];
  /** Disabled entries say why in `hint`. */
  disabled?: boolean;
  run?: () => void;
}

const openScratchpad = () => window.dispatchEvent(new Event(SCRATCHPAD_EVENT));

/** Field of the Tasks view that creates a task: its aria-label or placeholder starts with "New task" (English) or "Neue Aufgabe" (German). */
const NEW_TASK_FIELD = ["New task", "Neue Aufgabe"].map((s) => `input[aria-label^="${s}"], input[placeholder^="${s}"]`).join(", ");

/** "Neu > Aufgabe": opens /tasks and puts the cursor into its new-task field once the view has rendered. */
function newTask(router: ReturnType<typeof useRouter>) {
  if (window.location.pathname !== "/tasks") router.push("/tasks");
  const until = Date.now() + 4000;
  const tryFocus = () => {
    const el = document.querySelector<HTMLInputElement>(NEW_TASK_FIELD);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.focus();
    } else if (Date.now() < until) setTimeout(tryFocus, 80);
  };
  setTimeout(tryFocus, 0);
}

function NewButton() {
  const router = useRouter();
  const { openNewNote, openNote, startMeeting } = useShell();
  const desktopRec = useDesktopMeeting();
  const notes = useNotes();
  const { capture } = useCapture();
  // base-ui Menu: focus on open, arrow keys, typeahead, Escape back to the trigger, outside click.
  const [open, setOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  // Audit 0.6.1 W-13: creates the object in its type folder and opens it (before: only a hint toast).
  const objectEntry = (type: "person" | "project" | "goal", label: string, icon: IconId): NewItem => ({
    label,
    icon,
    run: () => {
      const { item, ready } = notes.createNote({ title: NEW_OBJECT_TITLE[type], contentMd: "", folder: DOMAIN_OBJECT_FOLDERS[type], objectType: type });
      router.push(objectHref(type));
      openNote(item.id);
      void ready;
    },
  });
  // Feinschliff Live: the five entries of the preview first (no group label), the older extras below "Weitere".
  const groups: { label: string; items: NewItem[]; hideLabel?: boolean }[] = [
    {
      label: t("Create"),
      hideLabel: true,
      items: [
        { label: t("New note"), hint: t("Empty editor, Markdown"), icon: "file-plus", keys: ["Alt", "N"], run: () => openNewNote() },
        { label: "Scratchpad", hint: t("Quick notes and snippets"), icon: "notebook", keys: ["Alt", "J"], run: openScratchpad },
        { label: t("Journal today"), hint: `10_Notes/Daily/${todayIso()}.md`, icon: "sun", run: () => router.push(JOURNAL_DAY_HREF) },
        // The orbit's /meeting command: in the Windows app the native recording (mic + system sound, HUD pill),
        // in the browser the web's microphone recording (transcript lands in the inbox).
        {
          label: t("Record meeting"),
          hint: desktopRec.available ? t("Microphone and system sound, live HUD when minimized") : t("Recording through the microphone, Ctrl Shift Space"),
          icon: "mic",
          run: startMeeting,
        },
        { label: t("Task"), hint: t("New task under Tasks"), icon: "todo", run: () => newTask(router) },
      ],
    },
    {
      label: tx("group", "More"),
      items: [
        { label: t("From template …"), hint: t("Meeting, project brief, daily note"), icon: "template", run: () => openNewNote({ template: NEW_NOTE_PICK_TEMPLATE }) },
        { label: t("Upload file"), hint: t("PDF, EPUB, image, Markdown"), icon: "upload", run: () => file.current?.click() },
        objectEntry("person", t("Person"), "o-person"),
        objectEntry("project", t("Project"), "o-project"),
        objectEntry("goal", t("Goal"), "o-goal"),
      ],
    },
  ];

  return (
    <div style={{ position: "relative" }}>
      <Menu.Root open={open} onOpenChange={setOpen}>
        <span className="tc-newbtn">
          <button type="button" className="tc-nb-main" onClick={() => openNewNote()} aria-label={t("New note")} aria-keyshortcuts="Alt+N Control+N">
            <Ico name="plus" />
            <span className="tc-nb-label">{t("New")}</span>
          </button>
          <Menu.Trigger className="tc-nb-more" aria-label={t("More options for New")}>
            <Ico name="chev-d" />
          </Menu.Trigger>
        </span>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={6} style={{ zIndex: 70 }}>
            <Menu.Popup className="kx-menu kx-pop tc-newmenu" aria-label={t("New")}>
              {groups.map((g) => (
                <Menu.Group key={g.label} aria-label={g.label}>
                  {!g.hideLabel && <Menu.GroupLabel className="kx-menu-label">{g.label}</Menu.GroupLabel>}
                  {g.items.map((m) => (
                    <Menu.Item key={m.label} disabled={m.disabled} className="kx-menu-item" title={m.hint} onClick={() => m.run?.()}>
                      <Ico name={m.icon} size="sm" className="fs-nm-ico" />
                      <span className="kx-truncate tc-mi-text">{m.label}</span>
                      {m.keys && <span className="tc-mi-end">{keys(m.keys)}</span>}
                    </Menu.Item>
                  ))}
                </Menu.Group>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <input
        ref={file}
        type="file"
        hidden
        multiple
        accept=".pdf,.epub,.md,.markdown,.txt,image/*"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          for (const f of files) void capture({ file: f });
        }}
      />
    </div>
  );
}

function WindowButtons() {
  const w = windowControls();
  return (
    <span className="tc-win" aria-label={t("Window buttons")}>
      <button type="button" className="tc-wbtn" aria-label={t("Minimize")} onClick={() => void w.minimize()}>
        <Ico name="minus" />
      </button>
      <button type="button" className="tc-wbtn tc-wbtn--max" aria-label={t("Maximize")} onClick={() => void w.toggleMaximize()}>
        <Ico name="square" />
      </button>
      <button type="button" className="tc-wbtn tc-wbtn--close" aria-label={t("Close")} onClick={() => void w.close()}>
        <Ico name="x" />
      </button>
    </span>
  );
}

function TipButton({ tip, label, onClick, icon, on, align, keyshortcuts, className }: { tip: string; label: string; onClick: () => void; icon: IconId; on?: boolean; align?: "start"; keyshortcuts?: string; className?: string }): ReactNode {
  return (
    <button
      type="button"
      className={"tc-ibtn" + (on ? " is-on" : "") + (className ? " " + className : "")}
      data-tip={tip}
      data-tip-align={align}
      aria-label={label}
      aria-keyshortcuts={keyshortcuts}
      onClick={onClick}
    >
      <Ico name={icon} />
    </button>
  );
}

/** Scratchpad button with the number of open entries (ScratchpadDrawer announces it after each load). */
function ScratchButton() {
  const [n, setN] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setN(Math.max(0, Number((e as CustomEvent<number>).detail) || 0));
    const onOpen = (e: Event) => setOpen(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(SCRATCHPAD_COUNT_EVENT, on);
    window.addEventListener(SCRATCHPAD_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(SCRATCHPAD_COUNT_EVENT, on);
      window.removeEventListener(SCRATCHPAD_OPEN_EVENT, onOpen);
    };
  }, []);
  return (
    <button
      type="button"
      className={"tc-ibtn tc-scratch-btn" + (open ? " is-on" : "")}
      data-tip={open ? undefined : `Scratchpad  ${SCRATCHPAD_SHORTCUT_LABEL.replace("+", " ")}`}
      aria-label={n ? tn(n, "Open Scratchpad, {n} entry", "Open Scratchpad, {n} entries") : t("Open Scratchpad")}
      aria-keyshortcuts="Alt+J"
      aria-expanded={open}
      onClick={() => window.dispatchEvent(new CustomEvent(SCRATCHPAD_EVENT, { detail: SCRATCHPAD_TOGGLE }))}
    >
      <Ico name="notebook" />
      {n > 0 && (
        <span className="tc-scratch-n" aria-hidden>
          {n > 99 ? "99+" : n}
        </span>
      )}
    </button>
  );
}

export function Titlebar() {
  const { prefs, toggleSidebar, setPalette } = useShell();
  // Window buttons only once the desktop app registered a controller (not merely inside Tauri, which keeps its
  // native frame until the custom one is switched on); the server snapshot is false, so hydration agrees.
  const desktop = useSyncExternalStore(subscribeWindowControls, hasWindowControls, () => false);
  const closed = prefs.sidebarClosed;

  return (
    <header className="tc-titlebar" data-tauri-drag-region>
      <div className="tc-tb-left">
        <NavMenuButton />
        <span className="tc-brand">
          <span className="kx-appmark" aria-hidden />
          <span className="tc-brand-title">{PRODUCT_NAME}</span>
        </span>
        <TipButton
          className="tc-hide-m"
          tip={(closed ? t("Show sidebar") : t("Hide sidebar")) + "  Ctrl \\"}
          align="start"
          label={closed ? t("Show sidebar") : t("Hide sidebar")}
          keyshortcuts="Control+Backslash"
          icon={closed ? "panel-open" : "panel-close"}
          on={closed}
          onClick={toggleSidebar}
        />
      </div>
      <TabStrip />
      <div className={"tc-tb-right" + (desktop ? " has-win" : "")}>
        {/* Feinschliff A2 (2026-11-07): wide search that also asks, Scratchpad with its count, "Neu" as the accent
            button. Split view stays on Ctrl+Shift+\\, back/forward on the mouse and Alt+arrows, the theme switch sits in
            the sidebar footer. */}
        <button type="button" className="tc-search" onClick={() => setPalette(true)} aria-label={t("Search or ask")} aria-keyshortcuts="Control+K Meta+K">
          <Ico name="search" />
          <span className="tc-search-label">{t("Search or ask")}</span>
          {keys(["Ctrl", "K"])}
        </button>
        <ScratchButton />
        <NewButton />
        {desktop && <WindowButtons />}
      </div>
    </header>
  );
}
