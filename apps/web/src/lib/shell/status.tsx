"use client";

import { t } from "@/i18n";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/api/actions";
import { isAbort, readApi } from "@/lib/api/read";
import { GARDENER_STATUS, INBOX_ACTIVE, LIVE_MEETING, isLiveData } from "@/lib/workspace-data";
import { isActive } from "./capture-core";
import { gardenerView, meetingView, type GardenerView, type MeetingCardData, type ShellStatusData } from "./status-core";
import { useShell } from "./store";

/*
 * Live shell texts (WP-K): the sidebar's AI Gardener line and inbox badge and the meeting card
 * come from the signed-in user's items (server/settings/status.ts via GET /api/read/status), polled every 30 s, on focus
 * and shortly after a capture changes state. Mock mode keeps the prototype values.
 */

const POLL_MS = 30_000;

interface ShellStatusValue {
  live: boolean;
  gardener: GardenerView;
  /** Inbox badge: server-side inbox + processing, plus captures not yet accepted. */
  inboxCount: number;
  /** Current meeting (newest meeting item of the last 3 h); null = no card. */
  meeting: MeetingCardData | null;
  data: ShellStatusData | null;
  refresh: () => void;
}

const Ctx = createContext<ShellStatusValue | null>(null);

const MOCK_GARDENER: GardenerView = { label: GARDENER_STATUS.label, detail: GARDENER_STATUS.detail, tone: "synced" };

export function ShellStatusProvider({ children }: { children: ReactNode }) {
  const live = isLiveData();
  const { captures } = useShell();
  const [data, setData] = useState<ShellStatusData | null>(null);
  const busy = useRef(false);
  // The read in flight, aborted when the provider unmounts.
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    if (!live || busy.current) return;
    busy.current = true;
    const ac = new AbortController();
    inflight.current = ac;
    void readApi<ActionResult<ShellStatusData>>("status", undefined, ac.signal)
      .then((res) => res.ok && setData(res.data))
      .catch((err: unknown) => {
        if (!isAbort(err)) console.warn("[kortex] status not loaded:", err);
      })
      .finally(() => {
        busy.current = false;
        if (inflight.current === ac) inflight.current = null;
      });
  }, [live]);
  useEffect(() => () => inflight.current?.abort(), []);

  useEffect(() => {
    if (!live) return;
    refresh();
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [live, refresh]);

  // A capture changed state (sent, processed, failed): re-read the counts shortly after.
  const captureKey = captures.map((c) => `${c.id}:${c.status}`).join("|");
  useEffect(() => {
    if (!live || !captureKey) return;
    const t = setTimeout(refresh, 1200);
    return () => clearTimeout(t);
  }, [live, captureKey, refresh]);

  const value = useMemo<ShellStatusValue>(() => {
    if (!live)
      return {
        live,
        gardener: MOCK_GARDENER,
        inboxCount: INBOX_ACTIVE.length + captures.filter(isActive).length,
        // Prototype parity: the mock meeting is a running live session (W1 chip, hover, card, clip).
        meeting: { ...LIVE_MEETING, processing: false, live: true, startedAt: null },
        data: null,
        refresh,
      };
    const sending = captures.filter((c) => c.status === "sending").length;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
      live,
      gardener: data ? gardenerView(data, tz) : { label: "AI Gardener", detail: t("Loading status"), tone: "synced" },
      // Until the first poll answers: the server-rendered snapshot plus active captures.
      inboxCount: data ? data.queued + data.processing + sending : INBOX_ACTIVE.length + captures.filter(isActive).length,
      meeting: data?.meeting ? meetingView(data.meeting, tz) : null,
      data,
      refresh,
    };
  }, [live, data, captures, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShellStatus(): ShellStatusValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShellStatus must be used inside <ShellStatusProvider>");
  return v;
}
