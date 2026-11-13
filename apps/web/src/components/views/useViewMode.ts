"use client";

import { useCallback, useEffect, useState } from "react";

export type ViewMode = "grid" | "list" | "timeline";

const KEY = "kortex.views.v1";
const MODES: ViewMode[] = ["grid", "list", "timeline"];

function read(): Record<string, ViewMode> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    const out: Record<string, ViewMode> = {};
    for (const [k, v] of Object.entries(raw)) if (MODES.includes(v as ViewMode)) out[k] = v as ViewMode;
    return out;
  } catch {
    return {};
  }
}

/**
 * View choice per space / object hub / vault folder, persisted in localStorage.
 * `mode` is null until the stored choice is read, so the list never flashes in the wrong layout.
 */
export function useViewMode(scope: string, fallback: ViewMode = "grid"): [ViewMode | null, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode | null>(null);
  useEffect(() => {
    setMode(read()[scope] ?? fallback);
  }, [scope, fallback]);
  const set = useCallback(
    (m: ViewMode) => {
      setMode(m);
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...read(), [scope]: m }));
      } catch {
        /* storage blocked: the choice just lasts for this visit */
      }
    },
    [scope],
  );
  return [mode, set];
}
