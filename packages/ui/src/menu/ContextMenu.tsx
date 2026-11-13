"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, Check, ChevronLeft, ChevronRight, ExternalLink, FileDown, FolderInput, GraduationCap, Link2, PanelRight, Pencil, Star, StarOff, Tag, Trash2, Undo2, type LucideIcon } from "lucide-react";
import { t } from "@kortex/i18n";
import { navigate, placeMenu } from "./keys";
import type { ActionId, MenuAction, MenuIcon, MenuSection } from "./model";

/*
 * The right-click menu (feedback round 2, #3). Opens at the pointer or, via Shift+F10 / the Menu key, at the
 * focused row. Arrow keys move, Enter / Space run, Esc closes (or goes back from a sub-list), Left / Right
 * enter and leave "Verschieben" and "Tags". Moving and tagging are second steps inside the same menu.
 */

const ICONS: Record<MenuIcon, LucideIcon> = {
  open: ExternalLink,
  split: PanelRight,
  link: Link2,
  move: FolderInput,
  tag: Tag,
  star: Star,
  "star-off": StarOff,
  archive: Archive,
  unarchive: ArchiveRestore,
  trash: Trash2,
  check: Check,
  undo: Undo2,
  accept: Check,
  export: FileDown,
  edit: Pencil,
  study: GraduationCap,
};

export const menuIcon = (icon: MenuIcon): LucideIcon => ICONS[icon];

type Level = "root" | "folders" | "tags";

type Row =
  | { kind: "action"; key: string; action: MenuAction }
  | { kind: "back"; key: string; label: string }
  | { kind: "folder"; key: string; path: string }
  | { kind: "tag"; key: string; label: string; on: boolean }
  | { kind: "input"; key: string }
  | { kind: "sep"; key: string }
  | { kind: "empty"; key: string; text: string };

const interactive = (r: Row) => r.kind !== "sep" && r.kind !== "empty";

export interface ContextMenuProps {
  /** Where to open (viewport coordinates); `null` keeps the menu closed. */
  at: { x: number; y: number } | null;
  sections: readonly MenuSection[];
  /** Folder paths offered by "Verschieben nach …". */
  folders?: readonly string[];
  /** Tags offered by "Tags …". */
  tags?: readonly string[];
  /** Tags the target already has (shown checked). */
  activeTags?: readonly string[];
  /** Open directly in a sub-list (bulk bar buttons). */
  initialLevel?: "folders" | "tags";
  label?: string;
  /** `arg` is the chosen folder path (move) or the tag to toggle (tags). */
  onAction: (id: ActionId, arg?: string) => void;
  onClose: () => void;
}

export function ContextMenu({ at, sections, folders = [], tags = [], activeTags = [], initialLevel, label = t("Context menu"), onAction, onClose }: ContextMenuProps) {
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [level, setLevel] = useState<Level>("root");
  const [active, setActive] = useState(0);
  const [draft, setDraft] = useState("");
  /** Row of the root list the user came from, so "back" lands on it again. */
  const origin = useRef(0);

  // Every opening starts at the root (or the requested sub-list) with the first entry highlighted.
  useEffect(() => {
    if (!at) return;
    setLevel(initialLevel ?? "root");
    setActive(initialLevel ? 1 : 0);
    setDraft("");
  }, [at, initialLevel]);

  const rows = useMemo<Row[]>(() => {
    if (level === "folders") {
      const list: Row[] = [{ kind: "back", key: "back", label: t("Move to") }];
      if (!folders.length) list.push({ kind: "empty", key: "none", text: t("No folders available") });
      for (const f of folders) list.push({ kind: "folder", key: `f:${f}`, path: f });
      return list;
    }
    if (level === "tags") {
      const list: Row[] = [{ kind: "back", key: "back", label: t("Tags") }];
      const known = [...new Set([...activeTags, ...tags])];
      for (const tag of known) list.push({ kind: "tag", key: `t:${tag}`, label: tag, on: activeTags.includes(tag) });
      list.push({ kind: "input", key: "new" });
      return list;
    }
    const list: Row[] = [];
    sections.forEach((s, i) => {
      if (i > 0 && s.length) list.push({ kind: "sep", key: `s${i}` });
      for (const action of s) list.push({ kind: "action", key: action.id, action });
    });
    return list;
  }, [level, sections, folders, tags, activeTags]);

  const stops = useMemo(() => rows.filter(interactive), [rows]);
  const current = stops[active];

  // Keep the menu inside the window, and the keyboard focus on it.
  useLayoutEffect(() => {
    const el = box.current;
    if (!at || !el) return;
    const pos = placeMenu(at, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight });
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    el.style.visibility = "visible";
  }, [at, level, rows.length]);

  useEffect(() => {
    if (!at) return;
    const previous = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, [at]);

  useEffect(() => {
    if (current?.kind === "input") input.current?.focus();
    else box.current?.focus({ preventScroll: true });
  }, [current?.kind, level]);

  // Outside clicks, scrolling and window changes close the menu.
  useEffect(() => {
    if (!at) return;
    const openedAt = performance.now();
    const close = (e: Event) => {
      if (e.type === "pointerdown" && box.current?.contains(e.target as Node)) return;
      if (e.type === "scroll" && box.current?.contains(e.target as Node)) return;
      // Focusing the clicked row can scroll it out from under a sticky bar right as the menu opens: not a user scroll.
      if (e.type === "scroll" && performance.now() - openedAt < 500) return;
      onClose();
    };
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [at, onClose]);

  const goTo = useCallback((next: Level, from?: number) => {
    if (from !== undefined) origin.current = from;
    setLevel(next);
    setActive(next === "root" ? origin.current : 1);
  }, []);

  const run = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      switch (row.kind) {
        case "action":
          if (row.action.submenu) goTo(row.action.submenu, active);
          else {
            onAction(row.action.id);
            onClose();
          }
          return;
        case "back":
          goTo("root");
          return;
        case "folder":
          onAction("move", row.path);
          onClose();
          return;
        case "tag":
          onAction("tags", row.label);
          onClose();
          return;
        case "input": {
          const v = draft.trim();
          if (v) {
            onAction("tags", v.startsWith("#") ? v : `#${v}`);
            onClose();
          }
          return;
        }
      }
    },
    [active, draft, goTo, onAction, onClose],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const typing = current?.kind === "input" && document.activeElement === input.current;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (level !== "root" && !initialLevel) goTo("root");
      else onClose();
      return;
    }
    if (e.key === "Tab") {
      onClose();
      return;
    }
    const next = navigate(active, stops.length, e.key);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
      return;
    }
    if (typing) {
      if (e.key === "Enter") {
        e.preventDefault();
        run(current);
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      run(current);
    } else if (e.key === "ArrowRight" && current?.kind === "action" && current.action.submenu) {
      e.preventDefault();
      run(current);
    } else if ((e.key === "ArrowLeft" || e.key === "Backspace") && level !== "root" && !initialLevel) {
      e.preventDefault();
      goTo("root");
    }
  };

  if (!at || typeof document === "undefined") return null;

  let stop = -1;
  return createPortal(
    <div
      ref={box}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className="kx-menu"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: "fixed", left: at.x, top: at.y, zIndex: 2000, visibility: "hidden", minWidth: 232, maxWidth: 320, maxHeight: "min(440px, calc(100vh - 16px))", overflowY: "auto", outline: "none" }}
    >
      {rows.map((row) => {
        if (row.kind === "sep") return <div key={row.key} role="separator" style={{ height: 1, margin: "4px 6px", background: "var(--border-subtle)" }} />;
        if (row.kind === "empty")
          return (
            <div key={row.key} className="kx-menu-label" style={{ textTransform: "none", letterSpacing: 0 }}>
              {row.text}
            </div>
          );
        stop += 1;
        const index = stop;
        const selected = index === active;
        const common = { "data-active": selected || undefined, onMouseEnter: () => setActive(index) } as const;

        if (row.kind === "action") {
          const Icon = ICONS[row.action.icon];
          return (
            <div key={row.key} role="menuitem" aria-haspopup={row.action.submenu ? "menu" : undefined} className={`kx-menu-item${selected ? " is-selected" : ""}${row.action.danger ? " kx-menu-item--danger" : ""}`} onClick={() => run(row)} {...common}>
              <Icon size={16} aria-hidden />
              <span>{row.action.label}</span>
              {row.action.submenu ? <ChevronRight size={14} aria-hidden style={{ marginLeft: "auto", color: "var(--text-muted)" }} /> : row.action.shortcut ? <span className="kx-hint">{row.action.shortcut}</span> : null}
            </div>
          );
        }
        if (row.kind === "back")
          return (
            <div key={row.key} role="menuitem" className={`kx-menu-item${selected ? " is-selected" : ""}`} onClick={() => run(row)} style={{ fontWeight: 600 }} {...common}>
              <ChevronLeft size={16} aria-hidden />
              <span>{row.label}</span>
            </div>
          );
        if (row.kind === "folder")
          return (
            <div key={row.key} role="menuitem" className={`kx-menu-item${selected ? " is-selected" : ""}`} onClick={() => run(row)} {...common}>
              <FolderInput size={16} aria-hidden />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.path}</span>
            </div>
          );
        if (row.kind === "tag")
          return (
            <div key={row.key} role="menuitemcheckbox" aria-checked={row.on} className={`kx-menu-item${selected ? " is-selected" : ""}`} onClick={() => run(row)} {...common}>
              {row.on ? <Check size={16} aria-hidden /> : <Tag size={16} aria-hidden />}
              <span>{row.label}</span>
            </div>
          );
        return (
          <div key={row.key} role="menuitem" className={`kx-menu-item${selected ? " is-selected" : ""}`} {...common}>
            <Tag size={16} aria-hidden />
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("New tag, Enter")}
              aria-label={t("Add new tag")}
              style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: "transparent", color: "inherit", font: "inherit" }}
            />
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
