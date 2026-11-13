"use client";

import { useEffect, type RefObject } from "react";
import { drawerCssWidth, type DrawerAttr } from "./drawer-width";

/**
 * Writes data-drawer and --drawer-w on the canvas island while `attr` is set; the owner removes them again when it
 * unmounts. `null` leaves the island alone (the drawer-mode sheet, whose drawer already owns the contract).
 */
export function useDrawerContract(attr: DrawerAttr | null, width: number, anchor?: RefObject<HTMLElement | null>) {
  const owns = attr !== null;
  useEffect(() => {
    if (attr === null) return;
    const el = (anchor?.current?.closest(".kx-main-window") ?? document.querySelector(".kx-main-window")) as HTMLElement | null;
    if (!el) return;
    el.dataset.drawer = attr;
    el.style.setProperty("--drawer-w", drawerCssWidth(attr, width));
  }, [attr, width, anchor]);
  useEffect(() => {
    if (!owns) return;
    return () => {
      const el = document.querySelector(".kx-main-window") as HTMLElement | null;
      if (!el) return;
      delete el.dataset.drawer;
      el.style.removeProperty("--drawer-w");
    };
  }, [owns]);
}
