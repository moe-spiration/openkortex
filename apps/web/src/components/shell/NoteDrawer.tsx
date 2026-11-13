"use client";

import { t } from "@/i18n";
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { NoteSheet } from "@/components/note/NoteSheet";
import { DrawerGrip } from "@/components/note/DrawerGrip";
import { useDrawerContract } from "@/lib/notes/drawer-contract";
import { DW_HALF, clampWidth, readDrawerWidth, writeDrawerWidth } from "@/lib/notes/drawer-width";
import { useShell } from "@/lib/shell/store";
import { NARROW_QUERY, useMedia } from "./MobileNav";

/*
 * Note drawer (Feinschliff Live, dummy "Editor"; Tactile Craft v2 decision 6 for the grip): a flush panel on the right
 * of the canvas, separated from the list by a hairline (no floating card, fs-editor.css). Starts at 44 % of the canvas, the header toggle switches to half width (50/50), the grip on the left edge
 * resizes it between 28 and 72 % (no numbers shown), the width is remembered (lib/notes/drawer-width.ts). The split
 * view (Ctrl+Shift+\, drawer.pinned) shows it at half width. Below 860 px it covers the canvas and the grip is off.
 *
 * Contract with packages B and D: `.kx-main-window` carries data-drawer="none|half|full" and --drawer-w (the drawer's
 * share while it sits beside the view, else 0%), so the Orbit-Bar centres in the free area and collections densify.
 */
export function NoteDrawer() {
  const { drawer, setSplit } = useShell();
  const narrow = useMedia(NARROW_QUERY);
  const [width, setWidthState] = useState<number>(44);
  const ref = useRef<HTMLElement>(null);
  const open = !!drawer.id;

  useLayoutEffect(() => setWidthState(readDrawerWidth()), []);
  const effective = drawer.pinned ? DW_HALF : width;
  const setWidth = useCallback(
    (w: number) => {
      const next = clampWidth(w);
      // Leaving 50 % ends the split view (pinned), so the toggle and the grip stay the only width controls.
      if (drawer.pinned && next !== DW_HALF) setSplit(false);
      setWidthState(next);
      writeDrawerWidth(next);
    },
    [drawer.pinned, setSplit],
  );

  useDrawerContract(open ? "half" : "none", effective, ref);

  if (!open || !drawer.id) return null;
  return (
    <aside
      ref={ref}
      aria-label={t("Note")}
      className="kx-drawer fs-ed"
      data-size="half"
      style={{ "--dw": `${effective}%` } as CSSProperties}
    >
      {!narrow && <DrawerGrip width={effective} setWidth={setWidth} />}
      <NoteSheet id={drawer.id} mode="drawer" width={effective} setWidth={setWidth} />
    </aside>
  );
}
