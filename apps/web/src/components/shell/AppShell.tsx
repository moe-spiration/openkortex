"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CopilotChatProvider } from "@/lib/shell/copilot-chat";
import { routeInfo } from "@/lib/shell/routes";
import { ShellStatusProvider, useShellStatus } from "@/lib/shell/status";
import { useVoiceRecorder } from "@/lib/shell/voice";
import { useShell } from "@/lib/shell/store";
import { isNewNoteKey } from "@/lib/shell/new-note";
import { installEmptyJsonGuard } from "@/lib/shell/json-guard";
import { MEETING_EXPAND_EVENT, meetingCardMode, readHiddenMeeting, writeHiddenMeeting } from "@/lib/shell/meeting-card";
import { CopilotPanel } from "./Copilot";
import { Footbar } from "./Footbar";
import { MeetingCard } from "./MeetingCard";
import { MobileNavProvider, NavScrim, useMobileNav, useNavSwipe } from "./MobileNav";
import { NoteDrawer } from "./NoteDrawer";
import { ScratchpadDrawer } from "@/components/scratchpad/ScratchpadDrawer";
import { ReminderNotifier } from "@/components/reminders/ReminderNotifier";
import { Toast } from "./Toasts";
// Palette and shortcut overview load on first use (cmdk + dialog stay out of every page's first load); preloaded when idle.
const loadOverlays = () => import("./Overlays");
const CommandPalette = dynamic(() => loadOverlays().then((m) => m.CommandPalette), { ssr: false });
const KeysOverlay = dynamic(() => loadOverlays().then((m) => m.KeysOverlay), { ssr: false });
import { Onboarding, useFirstRunOnboarding } from "@/components/onboarding/Onboarding";
import { Sidebar } from "./Sidebar";
import { SidebarResizer } from "./SidebarResizer";
import { readWidth, SIDEBAR_DEFAULT, writeWidth } from "./sidebar-width";
import { Titlebar } from "./Titlebar";
import { HeaderHosts, HeaderSlotProvider } from "./Bars";
import { TipProvider } from "@/components/ui/primitives";
import { TitleTips } from "@/components/ui/TitleTips";
import { ShellBackdrop } from "@/components/theme/ShellBackdrop";

/*
 * Web workspace shell (Tactile Craft v2): a frame (--lum-0 with the accent glow or the theme-pack backdrop) that
 * holds the titlebar across the full width and the sidebar, around the recessed canvas island (routed content,
 * Orbit-Bar, drawer, overlays). Layout: tactile.css (.kx-app-shell grid). Below 860 px the sidebar is a drawer
 * (./MobileNav). Sidebar hidden / shown: prefs.sidebarClosed (data-sb on <html>).
 */

/** Main views prefetched once the shell is idle (cheap server pages only). */
const PREFETCH_VIEWS = ["/home", "/inbox", "/tasks", "/journal"];

/** Runs `fn` when the browser is idle (fallback: after 1.5 s); returns the cancel function. */
function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const t = setTimeout(fn, 1500);
  return () => clearTimeout(t);
}

function useGlobalKeys() {
  const s = useShell();
  const nav = useMobileNav();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Text entry anywhere (inputs, selects, the block editor) keeps "?"; buttons and the page don't.
      const typing = !!t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
      const question = e.key === "?" || (e.code === "Slash" && e.shiftKey);
      if (question && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        s.setKeys(!s.keys);
      } else if (e.key === "Escape") {
        // An open menu or popover (base-ui) handles its own Escape: it closes, the drawer behind it stays.
        // Not while it is already closing (exit transition): then focus is still inside, but the Escape is for the drawer.
        const pop = t?.closest?.('[role="menu"], .kx-pop, .kc-pop');
        if (pop && !pop.hasAttribute("data-closed") && !pop.hasAttribute("data-ending-style")) return;
        // W11: the open navigation drawer (below 860 px) closes first.
        if (nav.open) nav.setOpen(false);
        else if (s.keys) s.setKeys(false);
        else if (s.rec) s.stopRec(false);
        else if (s.palette) s.setPalette(false);
        else if (s.modelOpen) s.setModelOpen(false);
        else if (s.copilot) s.setCopilot(false);
        else if (s.drawer.id && !s.drawer.pinned) s.closeDrawer();
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "\\" || e.key === "|" || e.code === "Backslash")) {
        // Tactile Craft: Ctrl+Backslash hides / shows the sidebar (titlebar toggle); Ctrl+Shift+Backslash switches
        // single / split view (feedback round 2 #9). The icon rail stays in Settings and the palette.
        // Not with Alt: on German keyboards AltGr (= Ctrl+Alt) types the backslash itself.
        e.preventDefault();
        if (e.shiftKey) s.setSplit(!s.drawer.pinned);
        else if (nav.narrow) nav.setOpen(!nav.open);
        else s.toggleSidebar();
      } else if (isNewNoteKey(e)) {
        // Universal entry to a new editor note (decision 8). Ctrl+N is reserved by most browsers; Alt+N always works.
        e.preventDefault();
        s.openNewNote();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === " " || e.code === "Space")) {
        e.preventDefault();
        if (s.rec) s.stopRec(true);
        else s.startRec("tap");
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        s.setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s, nav]);
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ShellStatusProvider>
      <MobileNavProvider>
        <ShellLayout>{children}</ShellLayout>
      </MobileNavProvider>
    </ShellStatusProvider>
  );
}

function ShellLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Live: the card belongs to a real meeting item (newest of the last 3 h); none = no card or chip.
  const liveMeeting = useShellStatus().meeting;
  const info = routeInfo(pathname);
  const shell = useShell();
  const { drawer, copilot, palette, keys, meeting, setMeeting } = shell;
  const [meetingPinned, setMeetingPinned] = useState(false);
  const nav = useMobileNav();
  const swipe = useNavSwipe();
  // Feedback round 2 #5: sidebar width per device (200-360 px), read before the first paint.
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  useLayoutEffect(() => setSidebarWidth(readWidth()), []);
  const commitSidebarWidth = useCallback((w: number) => {
    setSidebarWidth(w);
    writeWidth(w);
  }, []);
  useGlobalKeys();
  // W5: an empty response parsed as JSON in the background never breaks the page.
  useEffect(() => installEmptyJsonGuard(), []);
  // fx2-perf: the BlockNote editor is code-split (loaded on the first opened note). Warm its chunk once the shell is
  // idle, so opening the first note does not wait for ~400 kB of editor code.
  useEffect(() => whenIdle(() => void import("@kortex/ui/editor").catch(() => {})), []);
  useEffect(() => whenIdle(() => void loadOverlays().catch(() => {})), []);
  // fx2-perf: prefetch the main views once idle, so their first visit switches without a server round trip. Only views
  // whose server page is cheap (no workspace snapshot, no graph build); the router keeps them (next.config staleTimes).
  const router = useRouter();
  useEffect(
    () =>
      whenIdle(() => {
        for (const href of PREFETCH_VIEWS) if (href !== pathname) router.prefetch(href);
      }),
    // Once per session: the prefetched entries outlive navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  );
  useFirstRunOnboarding();
  useVoiceRecorder();

  // V2-03e: TL;DR / Tasks / Flashcards chips only while a note is open (drawer or full note), never on overview pages.
  // The new-note editor (/notes/new) has no saved note yet, so no chips there.
  // Card, chip or nothing (lib/shell/meeting-card.ts). Reader / note pages show the chip until the user expands it;
  // a closed meeting stays closed across reloads (the Windows app reloads the web app with every hand-over).
  const [hiddenMeeting, setHiddenMeeting] = useState<string | null>(null);
  useEffect(() => setHiddenMeeting(readHiddenMeeting()), []);
  const mcMode = meetingCardMode({
    hasMeeting: !!liveMeeting,
    noteId: liveMeeting?.noteId ?? null,
    state: meeting,
    hiddenNoteId: hiddenMeeting,
    drawerOpen: !!drawer.id,
    onHome: info.view === "home",
    pinned: meetingPinned,
  });
  const mcFull = mcMode === "full";
  const mcDock = mcMode === "dock";
  // The Home strip's "Aufklappen" (MEETING_EXPAND_EVENT) opens the floating card.
  useEffect(() => {
    const on = () => {
      setMeeting("full");
      setMeetingPinned(true);
    };
    window.addEventListener(MEETING_EXPAND_EVENT, on);
    return () => window.removeEventListener(MEETING_EXPAND_EVENT, on);
  }, [setMeeting]);
  const hideMeeting = () => {
    const id = liveMeeting?.noteId ?? null;
    setHiddenMeeting(id);
    writeHiddenMeeting(id);
    setMeetingPinned(false);
  };

  return (
    <CopilotChatProvider>
      <TipProvider>
      {/* Tactile Craft: grid frame (titlebar row, sidebar column, canvas island). data-nav says whether the mobile
          drawer (< 860 px) is open; the sidebar width is --layout-sidebar (resizer). */}
      <div
        className="kx-app-shell"
        data-nav={nav.open ? "open" : "closed"}
        onTouchStart={swipe.onTouchStart}
        onTouchEnd={swipe.onTouchEnd}
        style={{ "--layout-sidebar": `${sidebarWidth}px` } as CSSProperties}
      >
        <ShellBackdrop />
        <Titlebar />
        <Sidebar />
        <SidebarResizer width={sidebarWidth} onChange={setSidebarWidth} onCommit={commitSidebarWidth} />
        <NavScrim />
        <main className="kx-main-window">
          <HeaderSlotProvider>
          {/* Ruhe header system: the view's LocationBar and ViewBar render here (./Bars), above list, split and drawer. */}
          <HeaderHosts />
          <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              {/* --kx-footbar-safe: space the floating Orbit-Bar takes at the bottom (16 + 58 px, Tactile Craft) plus 16px air.
                  Views that scroll on their own (graph, inbox detail) pad their bottom with it. */}
              <div
                className="kx-scroll"
                data-view-host
                style={{ flex: 1, minHeight: 0, "--kx-footbar-safe": "90px", scrollPaddingBottom: "var(--kx-footbar-safe)" } as CSSProperties}
              >
                {children}
              </div>
              {mcFull && liveMeeting && (
                <MeetingCard
                  meeting={liveMeeting}
                  onMinimize={() => {
                    setMeeting("min");
                    setMeetingPinned(false);
                  }}
                  onHide={hideMeeting}
                />
              )}
            </div>
            <NoteDrawer />
            {/* Feinschliff Live: the Orbit-Bar (with its chips and answer card) floats centred over list and editor,
                so it sits in the row that holds both, after the drawer (stacks above it). */}
            {copilot && <CopilotPanel />}
            <Footbar
              liveDock={mcDock}
              onLiveExpand={() => {
                setMeeting("full");
                setMeetingPinned(true);
                shell.closeDrawer();
              }}
              onLiveHide={hideMeeting}
            />
            <ScratchpadDrawer />
            <ReminderNotifier />
            {palette && <CommandPalette />}
            {keys && <KeysOverlay />}
            {shell.onboarding > 0 && <Onboarding />}
            <Toast />
            <TitleTips />
          </div>
          </HeaderSlotProvider>
        </main>
      </div>
      </TipProvider>
    </CopilotChatProvider>
  );
}
