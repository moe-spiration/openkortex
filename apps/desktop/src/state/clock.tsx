import { useSyncExternalStore } from "react";

/**
 * Meeting clock store (device test 0.6.2, "HUD träge"): `meeting:tick` arrives once a second. It
 * used to be React state in the provider, so every tick re-rendered the whole tree of every window
 * (HUD, pill, tray, Meeting-Center). Now only the components that show the time subscribe here.
 */

export const fmtClock = (n: number) => {
  const h = Math.floor(n / 3600);
  const mm = String(Math.floor(n / 60) % 60).padStart(2, "0");
  const ss = String(n % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

type Sub = () => void;

export function createClockStore() {
  let sec = 0;
  const subs = new Set<Sub>();
  return {
    get: () => sec,
    set(v: number) {
      const next = Math.max(0, Math.floor(v));
      if (next === sec) return;
      sec = next;
      subs.forEach((f) => f());
    },
    subscribe(f: Sub) {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}

export const clockStore = createClockStore();

/** Elapsed meeting seconds; re-renders only the calling component. */
export function useClockSec(): number {
  return useSyncExternalStore(clockStore.subscribe, clockStore.get, clockStore.get);
}

/** `mm:ss` of the running meeting. */
export function useClock(): string {
  return fmtClock(useClockSec());
}

/** The meeting clock as text; the only part of a window that re-renders per tick. */
export function Clock() {
  return useClock();
}
