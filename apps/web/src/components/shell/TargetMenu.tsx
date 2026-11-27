"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useCopilotChat } from "@/lib/shell/copilot-chat";
import {
  CAPTURE_TARGETS,
  SEARCH_SCOPES,
  TARGET_NEW_NOTE,
  availableScopes,
  spaceContext,
  targetLabel,
  type SpaceContext,
} from "@/lib/shell/orbit";
import { intlLocale, t } from "@/i18n";
import { routeInfo } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { AUTO_SPACES } from "@/lib/workspace-data";
import { Ico, type IconId } from "./icons";

/*
 * Orbit-Bar chips (Tactile Craft decision 9, click dummy `ghostchip` + `Menu`):
 *   Festhalten → Ziel-Chip (Inbox = Auto, Nur Inbox, Tagesnotiz, Aufgabe, Aktueller Space, Neue Notiz)
 *   Fragen     → Suchbereich-Chip (Alles, Dieser Space, Geöffnete Notiz, Nur Objekte)
 * Both open a Level-2 popover above the bar with inline search; arrows / Enter / Esc work in it.
 */

export interface PopItem {
  id: string;
  label: string;
  help?: string;
  icon?: IconId;
  on?: boolean;
  /** Tooltip why it can't be picked (rendered dimmed, skipped by the arrows). */
  disabled?: string;
  badge?: string;
}
export interface PopGroup {
  label: string;
  items: PopItem[];
}

/** Closes a popover on outside pointer-down. */
export function useOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [ref, open, close]);
}

/** Level-2 popover with an optional inline search, groups and keyboard navigation. */
export function OrbitPopover({
  label,
  search,
  groups,
  onPick,
  onClose,
  head,
  foot,
  empty = t("Nothing found"),
  query,
  onQuery,
}: {
  label: string;
  search?: string;
  groups: PopGroup[];
  onPick: (id: string) => void;
  onClose: () => void;
  head?: ReactNode;
  foot?: ReactNode;
  empty?: string;
  /** Controlled search (the model menu filters its catalog itself). */
  query?: string;
  onQuery?: (q: string) => void;
}) {
  const [own, setOwn] = useState("");
  const q = query ?? own;
  const setQ = onQuery ?? setOwn;
  const shown = useMemo(() => {
    if (onQuery) return groups;
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => (i.label + " " + (i.help ?? "")).toLowerCase().includes(needle)) }))
      .filter((g) => g.items.length);
  }, [groups, q, onQuery]);
  const flat = shown.flatMap((g) => g.items);
  const [active, setActive] = useState(() => Math.max(0, flat.findIndex((i) => i.on)));
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (search) input.current?.focus();
    else list.current?.querySelector<HTMLElement>("[data-active='true']")?.focus();
  }, [search]);
  useEffect(() => setActive((a) => Math.min(a, Math.max(0, flat.length - 1))), [flat.length]);

  const move = (dir: 1 | -1) => {
    for (let i = 1; i <= flat.length; i++) {
      const at = (active + dir * i + flat.length * 2) % flat.length;
      if (!flat[at]!.disabled) {
        setActive(at);
        if (!search) list.current?.querySelectorAll<HTMLElement>("[role='menuitemradio']")[at]?.focus();
        return;
      }
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      const it = flat[active];
      if (it && !it.disabled) {
        e.preventDefault();
        onPick(it.id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  let idx = -1;
  return (
    <div className="kx-orbit-pop tc-float" role="menu" aria-label={label} onKeyDown={onKey}>
      {search && (
        <label className="kx-orbit-pop-q">
          <Ico name="scan-search" size={14} />
          <input ref={input} aria-label={search} placeholder={search} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      )}
      {head}
      <div ref={list} className="kx-orbit-pop-list">
        {shown.map((g) => (
          <div key={g.label} role="group" aria-label={g.label}>
            <div className="kx-orbit-micro">{g.label}</div>
            {g.items.map((it) => {
              idx++;
              const at = idx;
              return (
                <button
                  key={it.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={!!it.on}
                  aria-disabled={it.disabled ? true : undefined}
                  title={it.disabled}
                  data-active={at === active}
                  tabIndex={at === active ? 0 : -1}
                  className={"kx-orbit-mi" + (at === active ? " is-active" : "") + (it.on ? " is-on" : "")}
                  onMouseEnter={() => !it.disabled && setActive(at)}
                  onClick={() => !it.disabled && onPick(it.id)}
                >
                  {it.icon && (
                    <span className="kx-orbit-glyph" aria-hidden>
                      <Ico name={it.icon} size={11} />
                    </span>
                  )}
                  <span className="kx-orbit-mi-text">
                    <span className="kx-truncate">{it.label}</span>
                    {it.help && <span className="kx-orbit-mi-help kx-truncate">{it.help}</span>}
                  </span>
                  {it.on ? (
                    <small>
                      <Ico name="check" size={13} />
                    </small>
                  ) : it.badge ? (
                    <small>{it.badge}</small>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
        {!flat.length && <div className="kx-orbit-pop-empty">{empty}</div>}
      </div>
      {foot}
    </div>
  );
}

/** The current view's space context ("Aktueller Space"). */
export function useSpaceContext(): SpaceContext | null {
  const pathname = usePathname();
  return useMemo(() => spaceContext(routeInfo(pathname), AUTO_SPACES), [pathname]);
}

const dayLabel = () =>
  new Intl.DateTimeFormat(intlLocale(), { weekday: "short", day: "numeric", month: "long" }).format(new Date());

/** Ziel-Chip (Festhalten). "Neue Notiz" hands the field text to the editor. */
export function TargetMenu({
  onNewNote,
  context,
}: {
  onNewNote: () => void;
  /** Ruhe: the open entry a capture links ([[Title]]); `on` while it is the target. */
  context?: { title: string; on: boolean; set: (on: boolean) => void };
}) {
  const { captureTarget, setCaptureTarget } = useShell();
  const space = useSpaceContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const items: PopItem[] = CAPTURE_TARGETS.map((c) => ({
    id: c.id,
    label: c.id === "space" && space ? space.label : t(c.label),
    help:
      c.id === "journal"
        ? `${dayLabel()} · Mind Dump`
        : c.id === "space" && space
          ? space.folderPath
            ? t("Folder {path}", { path: space.folderPath })
            : t("Current space")
          : t(c.help),
    icon: c.icon,
    on: c.id === captureTarget && !context?.on,
    disabled: c.id === "space" && !space ? t("There is no space or folder in this view") : undefined,
  }));
  items.push({ id: "new-note", label: t(TARGET_NEW_NOTE.label), help: t(TARGET_NEW_NOTE.help), icon: "file-plus" });
  if (context) items.unshift({ id: "context", label: context.title, help: t("Inbox, linked to the open entry"), icon: "link", on: context.on });
  const effective = captureTarget === "space" && !space ? "auto" : captureTarget;
  const chipLabel = context?.on ? context.title : targetLabel(effective, space);
  const chipIcon: IconId = context?.on ? "orbit-inbox" : (CAPTURE_TARGETS.find((c) => c.id === effective)?.icon ?? "orbit-inbox");
  return (
    <div ref={ref} className="kx-orbit-optwrap">
      <button
        type="button"
        className="kx-orbit-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("Target when capturing: {target}", { target: chipLabel })}
        title={t("Target when capturing")}
        onClick={() => setOpen(!open)}
      >
        <Ico name="arrow-down-to-line" size={14} className="kx-rz-hide" />
        <Ico name={chipIcon} size={14} className="kx-rz-only" />
        <span className="kx-orbit-chip-l kx-truncate">{chipLabel}</span>
        <Ico name="chev-d" size={14} />
      </button>
      {open && (
        <OrbitPopover
          label={t("Target when capturing")}
          search={t("Search target …")}
          groups={[{ label: t("Capture in"), items }]}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            setOpen(false);
            if (id === "new-note") onNewNote();
            else if (id === "context") context?.set(true);
            else {
              context?.set(false);
              setCaptureTarget(id as (typeof CAPTURE_TARGETS)[number]["id"]);
            }
          }}
        />
      )}
    </div>
  );
}

/** Suchbereich-Chip (Fragen): the copilot's RAG scope (/api/chat mode + folder / item). */
export const AUTONOMY_LEVELS = [
  { id: "read", label: () => t("Read only"), help: () => t("Searches and answers, changes nothing"), icon: "eye" },
  { id: "ask", label: () => t("Ask first"), help: () => t("Proposes changes, you confirm them"), icon: "shield-check" },
  { id: "self", label: () => t("On its own"), help: () => t("Makes changes at once, you can undo them"), icon: "orbit-zap" },
] as const;

/** How far the agent may go (Orbit-Bar, Fragen): read only, ask first (default), on its own. */
export function AutonomyMenu() {
  const chat = useCopilotChat();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const current = AUTONOMY_LEVELS.find((l) => l.id === chat.autonomy) ?? AUTONOMY_LEVELS[1];
  const items: PopItem[] = AUTONOMY_LEVELS.map((l) => ({ id: l.id, label: l.label(), help: l.help(), icon: l.icon, on: l.id === chat.autonomy }));
  return (
    <div ref={ref} className="kx-orbit-optwrap">
      <button
        type="button"
        className="kx-orbit-chip kx-orbit-chip--agent"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("Agent: {level}", { level: current.label() })}
        title={`${t("How far the agent may go")}: ${current.label()}`}
        onClick={() => setOpen(!open)}
      >
        <Ico name={current.icon} size={14} />
        <span className="kx-orbit-chip-l kx-truncate">{current.label()}</span>
        <Ico name="chev-d" size={14} />
      </button>
      {open && (
        <OrbitPopover
          label={t("Agent autonomy")}
          groups={[{ label: t("The agent may"), items }]}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            setOpen(false);
            chat.setAutonomy(id as (typeof AUTONOMY_LEVELS)[number]["id"]);
          }}
        />
      )}
    </div>
  );
}

export function ScopeMenu() {
  const chat = useCopilotChat();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const can = availableScopes(chat.scope);
  const current = SEARCH_SCOPES.find((s) => s.id === chat.searchScope) ?? SEARCH_SCOPES[0]!;
  const items: PopItem[] = SEARCH_SCOPES.map((s) => ({
    id: s.id,
    label: t(s.label),
    help:
      s.id === "note" && chat.scope.itemTitle
        ? chat.scope.itemTitle
        : s.id === "space" && chat.scope.folderPath
          ? chat.scope.folderPath
          : t(s.help),
    icon: s.icon,
    on: s.id === chat.searchScope,
    disabled: can.includes(s.id) ? undefined : s.id === "note" ? t("No note open") : t("No folder in view"),
  }));
  return (
    <div ref={ref} className="kx-orbit-optwrap">
      <button
        type="button"
        className="kx-orbit-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("Search scope: {scope}", { scope: t(current.label) })}
        title={t("Search scope of the question")}
        onClick={() => setOpen(!open)}
      >
        <Ico name="scan-search" size={14} />
        <span className="kx-orbit-chip-l kx-truncate">{t(current.label)}</span>
        <Ico name="chev-d" size={14} />
      </button>
      {open && (
        <OrbitPopover
          label={t("Search scope")}
          groups={[{ label: t("Search in"), items }]}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            setOpen(false);
            chat.setSearchScope(id as (typeof SEARCH_SCOPES)[number]["id"]);
          }}
        />
      )}
    </div>
  );
}
