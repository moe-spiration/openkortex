"use client";

import { t } from "@/i18n";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { useShell } from "@/lib/shell/store";
import { Ico } from "./icons";
import { SWIPE_EDGE, swipeIntent } from "./mobile-nav";

/*
 * W11 mobile web: below 860 px (Tactile Craft breakpoint) the sidebar is a drawer, an overlay with a scrim.
 * It opens from the menu button in the titlebar (or a swipe from the left edge) and closes on a tap
 * outside, a swipe to the left, Escape, and after navigating. The layout itself is CSS
 * (tactile.css, "Mobile"); this module holds the open state and the behaviour. The sidebar
 * stays in the DOM: while closed on a narrow screen it is inert, so focus and screen readers skip it.
 */

/** Same breakpoint as the CSS (`@media (max-width: 859.98px)`, tactile.css). */
export const NARROW_QUERY = "(max-width: 859.98px)";

/** matchMedia as state; false on the server and before mount. */
export function useMedia(query: string): boolean {
  const [hit, setHit] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setHit(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return hit;
}

const useNarrow = () => useMedia(NARROW_QUERY);

interface MobileNavState {
  /** Viewport below 860 px. */
  narrow: boolean;
  /** Drawer open (only meaningful while narrow). */
  open: boolean;
  setOpen: (v: boolean) => void;
}

const Ctx = createContext<MobileNavState>({ narrow: false, open: false, setOpen: () => {} });

export const useMobileNav = () => useContext(Ctx);

const sidebarEl = () => document.querySelector<HTMLElement>("aside.kx-sidebar");
const menuButtonEl = () => document.querySelector<HTMLElement>("[data-nav-button]");

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const narrow = useNarrow();
  const [open, setOpenRaw] = useState(false);
  const isOpen = narrow && open;
  const setOpen = useCallback((v: boolean) => setOpenRaw(v), []);
  const pathname = usePathname();
  const { drawer } = useShell();

  // Wider again: the drawer state no longer applies.
  useEffect(() => {
    if (!narrow) setOpenRaw(false);
  }, [narrow]);

  // Navigating, or opening a note, from the drawer closes it.
  useEffect(() => {
    setOpenRaw(false);
  }, [pathname, drawer.id]);

  // Closed on a narrow screen: the off-canvas sidebar is inert. Open: focus moves into it, and back to
  // the menu button when it closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    const aside = sidebarEl();
    if (!aside) return;
    const hide = narrow && !isOpen;
    aside.inert = hide;
    if (hide) aside.setAttribute("aria-hidden", "true");
    else aside.removeAttribute("aria-hidden");
    if (narrow) {
      aside.setAttribute("role", "dialog");
      aside.setAttribute("aria-modal", isOpen ? "true" : "false");
    } else {
      aside.removeAttribute("role");
      aside.removeAttribute("aria-modal");
    }
    if (isOpen && !wasOpen.current) {
      const target = aside.querySelector<HTMLElement>('.kx-row.is-active, [aria-current="page"]') ?? aside.querySelector<HTMLElement>("a, button");
      target?.focus({ preventScroll: true });
    } else if (!isOpen && wasOpen.current && narrow && (!document.activeElement || document.activeElement === document.body || aside.contains(document.activeElement))) {
      menuButtonEl()?.focus({ preventScroll: true });
    }
    wasOpen.current = isOpen;
  }, [narrow, isOpen]);

  const value = useMemo(() => ({ narrow, open: isOpen, setOpen }), [narrow, isOpen, setOpen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Menu button at the start of the titlebar; CSS shows it only below 860 px. */
export function NavMenuButton() {
  const { open, setOpen } = useMobileNav();
  return (
    <button
      type="button"
      data-nav-button
      className="tc-ibtn tc-nav-btn"
      aria-label={t("Open navigation")}
      aria-expanded={open}
      title={t("Navigation")}
      onClick={() => setOpen(!open)}
    >
      <Ico name="menu" />
    </button>
  );
}

/** Scrim behind the open drawer; a tap closes it. */
export function NavScrim() {
  const { open, setOpen } = useMobileNav();
  return <div className={"kx-nav-scrim" + (open ? " is-open" : "")} aria-hidden onClick={() => setOpen(false)} />;
}

/**
 * Touch handlers for the shell: a swipe to the left closes the open drawer, a swipe to the right that
 * starts at the left edge opens it. Mostly-vertical moves (scrolling) are ignored.
 */
export function useNavSwipe() {
  const { narrow, open, setOpen } = useMobileNav();
  const start = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      const t = e.touches[0];
      if (!narrow || !t || e.touches.length > 1) return;
      start.current = open || t.clientX <= SWIPE_EDGE ? { x: t.clientX, y: t.clientY } : null;
    },
    [narrow, open],
  );
  const onTouchEnd = useCallback(
    (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      const t = e.changedTouches[0];
      if (!s || !t) return;
      const intent = swipeIntent(s, { x: t.clientX, y: t.clientY }, open);
      if (intent) setOpen(intent === "open");
    },
    [open, setOpen],
  );
  return { onTouchStart, onTouchEnd };
}
