"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isLiveData } from "@/lib/workspace-data";

/*
 * A note that the store does not know yet (live mode). New items reach the store through a new
 * workspace snapshot, which `router.refresh()` loads (e.g. after a capture). A navigation started
 * while that refresh is in flight aborts it, and a page change inside the workspace does not reload
 * the layout, so the snapshot never arrived and a freshly captured note opened as "Notiz nicht
 * gefunden" (e2e notes-prod, 2026-10-25). The note view therefore asks for a fresh snapshot itself:
 * at once, then twice more with a pause, and only after that gives up.
 */

/** Pause before each attempt; the last entry is the grace period after the final refresh. */
const DELAYS_MS = [0, 1500, 4000, 4000];

/** True while a missing note is still being looked for (show "loading", not "not found"). */
export function useRefreshWhenMissing(id: string, missing: boolean): boolean {
  const router = useRouter();
  const live = isLiveData();
  const [state, setState] = useState({ id, tries: 0 });
  const tries = state.id === id ? state.tries : 0;

  useEffect(() => {
    if (!live || !missing || tries >= DELAYS_MS.length) return;
    const t = setTimeout(() => {
      if (tries < DELAYS_MS.length - 1) router.refresh();
      setState({ id, tries: tries + 1 });
    }, DELAYS_MS[tries]);
    return () => clearTimeout(t);
  }, [live, missing, tries, id, router]);

  return live && missing && tries < DELAYS_MS.length;
}
