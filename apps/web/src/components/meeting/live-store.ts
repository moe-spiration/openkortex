"use client";

import { t } from "@/i18n";
import { useEffect, useState, useSyncExternalStore } from "react";
import { isLiveData } from "@/lib/workspace-data";
import type { LiveSession } from "@/server/meeting/live-core";

/*
 * Live meeting session for the web (W1, docs/plans/2026-10-30-meeting-capture.md): one shared
 * poller of GET /api/meeting/live for the orbit-bar chip, its hover preview and the floating card.
 * It runs only while a component needs it (refcount) and the shell status says a meeting is live.
 */

export const LIVE_POLL_MS = 5_000;

type Listener = () => void;

let session: LiveSession | null = null;
let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: AbortController | null = null;
const listeners = new Set<Listener>();

const emit = () => listeners.forEach((l) => l());

async function load() {
  if (inflight || (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
  const ac = new AbortController();
  inflight = ac;
  try {
    const res = await fetch("/api/meeting/live", { cache: "no-store", credentials: "same-origin", signal: ac.signal });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; session?: LiveSession | null } | null;
    if (body?.ok) {
      session = body.session ?? null;
      emit();
    }
  } catch {
    /* offline or aborted: keep the last state */
  } finally {
    if (inflight === ac) inflight = null;
  }
}

function retain() {
  users++;
  if (users === 1) {
    void load();
    timer = setInterval(() => void load(), LIVE_POLL_MS);
  }
  return () => {
    users--;
    if (users === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      inflight?.abort();
      inflight = null;
    }
  };
}

const subscribe = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Mock mode (prototype parity): the conversation of Desktop.dc.html as a running session. */
export const MOCK_SESSION: LiveSession = {
  item_id: "n2",
  title: "Q4 Architecture Sync",
  state: "recording",
  started_at: "",
  updated_at: "",
  segments: 3,
  last_sec: 1116,
  tail: [
    { ts: "00:18:09", sec: 1089, channel: 0, who: "Max", text: "We hash every file with SHA-256 and put a .conflict.md next to it when they diverge." },
    { ts: "00:18:21", sec: 1101, channel: 1, who: "Priya", text: "And who decides which version wins?" },
    { ts: "00:18:36", sec: 1116, channel: 1, who: "Tom", text: "The user should see that before anything gets overwritten." },
  ],
  clips: [],
  cards: [{ kind: "fact", text: "Tom asks about conflict cases. Mention the SHA-256 checksum and the .conflict.md from doc 02." }],
  transcriber: "edenai:deepgram",
};

/** The running session while `enabled` (the shell status reported a live meeting), else null. */
export function useLiveSession(enabled: boolean): LiveSession | null {
  const live = isLiveData();
  useEffect(() => (enabled && live ? retain() : undefined), [enabled, live]);
  const s = useSyncExternalStore(subscribe, () => session, () => null);
  if (!enabled) return null;
  return live ? s : MOCK_SESSION;
}

/** Seconds since `startedAt`, ticking once a second (null without a start, and before mount: no SSR mismatch). */
export function useElapsed(startedAt: string | null | undefined): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt || now == null) return null;
  const t = Date.parse(startedAt);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 1000)) : null;
}

export const fmtElapsed = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const mm = String(Math.floor(sec / 60) % 60).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** Marks a moment of the running meeting ("Clip"). Resolves to an error text or null. */
export async function clipMoment(itemId: string, text: string): Promise<string | null> {
  if (!isLiveData()) return null;
  try {
    const res = await fetch("/api/meeting/live", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "clip", item_id: itemId, text: text.trim() || null, source: "web" }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
    if (!res.ok || !body?.ok) return body?.error?.message ?? t("Clip failed ({status})", { status: res.status });
    void load();
    return null;
  } catch {
    return t("No connection");
  }
}

/** Tests: reset the module state. */
export function resetLiveStore(next: LiveSession | null = null) {
  session = next;
  emit();
}
