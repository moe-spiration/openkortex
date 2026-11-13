"use client";

import { useCallback, useEffect, useState } from "react";
import { saveLifeVision, type LifeLive } from "@/lib/data/life";
import { isAbort, readApi } from "@/lib/api/read";
import type { DataResult } from "@/lib/data/run";
import {
  LIFE_DETAILS,
  LIFE_SIGNALS,
  ROUTINE_TODAY,
  type LifeAreaDetail,
  type LifeSignal,
} from "@/lib/mock/life";
import { useShell } from "@/lib/shell/store";
import { isLiveData } from "@/lib/workspace-data";
import { useVisions } from "./useVisions";
import { t } from "@/i18n";

export interface LifeState {
  live: boolean;
  status: "ready" | "loading" | "error";
  error: string | null;
  areas: LifeAreaDetail[];
  signals: LifeSignal[];
  /** Weekday index (0 = Mo) of today in the routine grid. */
  today: number;
  visions: Record<string, string>;
  setVision: (key: string, vision: string | null) => void;
}

/** Life data: the prototype mock, or in live mode the user's areas from lib/data/life.ts. */
export function useLifeData(): LifeState {
  const live = isLiveData();
  const { showToast } = useShell();
  const [localVisions, setLocalVision] = useState<Record<string, string>>({});
  const [mockVisions, setMockVision] = useVisions();
  const [state, setState] = useState<Omit<LifeState, "visions" | "setVision" | "live">>(() =>
    live
      ? { status: "loading", error: null, areas: [], signals: [], today: ROUTINE_TODAY }
      : {
          status: "ready",
          error: null,
          areas: LIFE_DETAILS,
          signals: LIFE_SIGNALS,
          today: ROUTINE_TODAY,
        },
  );

  useEffect(() => {
    if (!live) return;
    let off = false;
    // GET /api/read/life (P7-5): not queued behind other pages' server actions; aborted on unmount.
    const ac = new AbortController();
    readApi<DataResult<LifeLive>>("life", undefined, ac.signal)
      .then((r) => {
        if (off) return;
        if (!r.ok) return setState((s) => ({ ...s, status: "error", error: r.error }));
        setLocalVision(r.data.visions);
        setState({
          status: "ready",
          error: null,
          areas: r.data.areas,
          signals: r.data.signals,
          today: r.data.today,
        });
      })
      .catch((err: unknown) => {
        if (!off && !isAbort(err)) setState((s) => ({ ...s, status: "error", error: String(err) }));
      });
    return () => {
      off = true;
      ac.abort();
    };
  }, [live]);

  const setLiveVision = useCallback(
    (key: string, vision: string | null) => {
      let before: string | undefined;
      setLocalVision((m) => {
        before = m[key];
        const next = { ...m };
        if (vision) next[key] = vision;
        else delete next[key];
        return next;
      });
      void saveLifeVision(key, vision ?? "").then((r) => {
        if (r.ok) return;
        setLocalVision((m) => {
          const next = { ...m };
          if (before) next[key] = before;
          else delete next[key];
          return next;
        });
        showToast(t("Vision not saved: {error}", { error: r.error }));
      });
    },
    [showToast],
  );

  return live
    ? { live, ...state, visions: localVisions, setVision: setLiveVision }
    : { live, ...state, visions: mockVisions, setVision: setMockVision };
}
