"use client";

import { useEffect, useState } from "react";
import type { LifeScore } from "@/lib/data/life";
import { isAbort, readApi } from "@/lib/api/read";
import type { DataResult } from "@/lib/data/run";
import { isLiveData } from "@/lib/workspace-data";

/*
 * Life area scores for the sidebar (WP-M). Live: GET /api/read/life-scores (lib/data/life.ts loadLifeScores()), the same
 * computeLife() as the Life overview, refreshed on focus at most once a minute. Mock: null (the
 * sidebar keeps the prototype values).
 */

const MIN_GAP_MS = 60_000;

export function useLifeScores(): LifeScore[] | null {
  const live = isLiveData();
  const [scores, setScores] = useState<LifeScore[] | null>(null);
  useEffect(() => {
    if (!live) return;
    let alive = true;
    let last = 0;
    let ac: AbortController | null = null;
    const load = () => {
      if (Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      ac?.abort();
      ac = new AbortController();
      void readApi<DataResult<LifeScore[]>>("life-scores", undefined, ac.signal)
        .then((r) => alive && r.ok && setScores(r.data))
        .catch((err: unknown) => {
          if (!isAbort(err)) console.warn("[kortex] life scores not loaded:", err);
        });
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      ac?.abort();
      window.removeEventListener("focus", load);
    };
  }, [live]);
  return scores;
}
