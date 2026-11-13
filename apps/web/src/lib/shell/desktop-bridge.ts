"use client";

import { t } from "@/i18n";
import { useSyncExternalStore } from "react";
import { isTauri } from "./window-controls";

/*
 * Bridge to the Windows app when the web app runs in its main window (0.6.4, device test 0.6.3:
 * "Orbit-Bar and live HUD must work seamlessly together"). The desktop core grants the web origin
 * exactly four commands (apps/desktop/src-tauri/src/main_bridge.rs):
 * - "Meeting aufnehmen" in the Orbit-Bar runs the native meeting recording (microphone and system
 *   sound, live transcript, coaching). Minimizing the window then shows the HUD pill.
 * - The Orbit-Bar's own microphone recording (dictation) is reported, so minimizing shows the pill
 *   for it too; the pill's stop button comes back as `stop-web-recording`.
 * The core answers with `kortex:desktop` window events. In a browser, or in a desktop app without
 * the bridge (before 0.6.4), nothing changes: the web keeps its own microphone recording.
 */

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export type DesktopEvent =
  | { type: "meeting"; recording: boolean; elapsed: number; uploading?: boolean }
  | { type: "stop-web-recording" };

export interface DesktopMeeting {
  /** The bridge answered: the Orbit-Bar records meetings natively. */
  available: boolean;
  recording: boolean;
  /** Date.now() at the start (from the core's elapsed seconds); null without a recording. */
  startedAt: number | null;
}

const IDLE: DesktopMeeting = { available: false, recording: false, startedAt: null };

let state: DesktopMeeting = IDLE;
let users = 0;
let off: (() => void) | null = null;
let webRecReported = false;
const listeners = new Set<() => void>();
const eventListeners = new Set<(e: DesktopEvent) => void>();

function invoker(w: unknown = typeof window === "undefined" ? undefined : window): Invoke | null {
  if (!isTauri(w)) return null;
  const internals = (w as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function" ? (internals.invoke as Invoke) : null;
}

function set(next: Partial<DesktopMeeting>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** Validates the detail of a `kortex:desktop` event (the core is trusted, the shape is still checked). */
export function parseDesktopEvent(detail: unknown): DesktopEvent | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  if (d.type === "stop-web-recording") return { type: "stop-web-recording" };
  if (d.type === "meeting" && typeof d.recording === "boolean") {
    const elapsed = typeof d.elapsed === "number" && d.elapsed >= 0 ? d.elapsed : 0;
    return {
      type: "meeting",
      recording: d.recording,
      elapsed,
      ...(typeof d.uploading === "boolean" ? { uploading: d.uploading } : {}),
    };
  }
  return null;
}

/** The meeting state after a core answer or event (`now` = Date.now()). */
export function meetingFrom(
  recording: boolean,
  elapsed: number,
  now: number,
): Pick<DesktopMeeting, "recording" | "startedAt"> {
  return recording
    ? { recording: true, startedAt: now - Math.max(0, elapsed) * 1000 }
    : { recording: false, startedAt: null };
}

function onEvent(ev: Event) {
  const e = parseDesktopEvent((ev as CustomEvent).detail);
  if (!e) return;
  if (e.type === "meeting") set(meetingFrom(e.recording, e.elapsed, Date.now()));
  eventListeners.forEach((l) => l(e));
}

/**
 * Starts listening and asks the core whether the bridge is there (refcounted; returns the release).
 * Does nothing outside the desktop app.
 */
export function initDesktopBridge(): () => void {
  const invoke = invoker();
  if (!invoke) return () => {};
  users++;
  if (users === 1) {
    window.addEventListener("kortex:desktop", onEvent);
    off = () => window.removeEventListener("kortex:desktop", onEvent);
    invoke("main_meeting_state").then(
      (r) => {
        const m = r as { recording?: boolean; elapsed?: number } | null;
        set({ available: true, ...meetingFrom(!!m?.recording, m?.elapsed ?? 0, Date.now()) });
      },
      // Older desktop app without the bridge: the web keeps its own recording.
      () => set({ available: false }),
    );
  }
  return () => {
    users--;
    if (users === 0) {
      off?.();
      off = null;
    }
  };
}

export function desktopMeeting(): DesktopMeeting {
  return state;
}

/** Native meeting recording available (desktop app 0.6.4+ with the bridge). */
export function desktopRecorderAvailable(): boolean {
  return state.available && invoker() !== null;
}

/** Starts the native meeting recording; rejects with the core's message. */
export async function startDesktopMeeting(): Promise<void> {
  const invoke = invoker();
  if (!invoke) throw new Error(t("Only in the Windows app"));
  const r = (await invoke("main_start_meeting")) as { elapsed?: number } | null;
  set(meetingFrom(true, r?.elapsed ?? 0, Date.now()));
}

/** Stops it; `uploading` = the protocol follows (account connected). */
export async function stopDesktopMeeting(): Promise<{ uploading: boolean }> {
  const invoke = invoker();
  if (!invoke) throw new Error(t("Only in the Windows app"));
  const r = (await invoke("main_stop_meeting")) as { uploading?: boolean } | null;
  set(meetingFrom(false, 0, Date.now()));
  return { uploading: !!r?.uploading };
}

/** Tells the core that the Orbit-Bar's own microphone recording runs (or ended); only on a change. */
export function reportWebRecording(active: boolean): void {
  const invoke = invoker();
  if (!invoke || active === webRecReported) return;
  webRecReported = active;
  invoke("main_web_recording", { active }).catch(() => {
    /* older desktop app without the bridge: no pill for the web recording */
  });
}

/** Subscribes to core events (`stop-web-recording` from the pill). Returns the unsubscribe. */
export function onDesktopEvent(fn: (e: DesktopEvent) => void): () => void {
  eventListeners.add(fn);
  return () => {
    eventListeners.delete(fn);
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const serverSnapshot = () => IDLE;

/** The native meeting recording as the Orbit-Bar shows it. */
export function useDesktopMeeting(): DesktopMeeting {
  return useSyncExternalStore(subscribe, desktopMeeting, serverSnapshot);
}
