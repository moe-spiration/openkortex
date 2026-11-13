"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "kortex.life.v1";

/**
 * Edited area visions. The prototype keeps them in component state for the session; every area
 * is its own route here, so they persist in localStorage (Etappe 2: the area object's frontmatter).
 */
export function useVisions(): [Record<string, string>, (key: string, vision: string | null) => void] {
  const [visions, setVisions] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      const v = raw ? (JSON.parse(raw) as { visions?: Record<string, string> }) : null;
      if (v?.visions && typeof v.visions === "object") setVisions(v.visions);
    } catch {
      /* storage blocked or corrupt */
    }
  }, []);
  const set = useCallback((key: string, vision: string | null) => {
    setVisions((m) => {
      const next = { ...m };
      if (vision) next[key] = vision;
      else delete next[key];
      try {
        window.localStorage.setItem(KEY, JSON.stringify({ visions: next }));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [visions, set];
}
