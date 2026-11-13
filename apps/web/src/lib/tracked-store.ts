"use client";

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

/*
 * Context-free state slices with automatic, per-component subscriptions (fx2-perf).
 *
 * The shell and notes providers each hand out one big state object (useShell(), useNotes()). Through plain React
 * context every consumer re-rendered whenever any field changed, so one keystroke in the Orbit-Bar re-rendered the
 * sidebar, the titlebar and the open view. A provider now publishes its value into a TrackedStore, and useTracked()
 * returns a proxy that records which fields the component reads while it renders. The component re-renders only when
 * one of those fields changes.
 *
 * Functions are handed out as stable wrappers that call the latest implementation, so actions (showToast, openNote,
 * setContent ...) never cause a re-render and never go stale. A function that reads state while rendering (notes'
 * `get`) is declared in `reads`: reading it subscribes to the named field instead.
 */

type AnyFn = (...args: never[]) => unknown;

export interface TrackedStore<T extends object> {
  get: () => T;
  subscribe: (fn: () => void) => () => void;
  /** @internal stable function wrappers, one per key. */
  fn: (key: PropertyKey) => AnyFn;
  /** @internal function keys that read state during render: key → state field. */
  reads: Partial<Record<PropertyKey, PropertyKey>>;
}

function createStore<T extends object>(initial: T, reads: Partial<Record<PropertyKey, PropertyKey>>) {
  let value = initial;
  const subs = new Set<() => void>();
  const wrappers = new Map<PropertyKey, AnyFn>();
  const store: TrackedStore<T> = {
    get: () => value,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    fn(key) {
      let w = wrappers.get(key);
      if (!w) {
        w = (...args: never[]) => (value[key as keyof T] as AnyFn)(...args);
        wrappers.set(key, w);
      }
      return w;
    },
    reads,
  };
  const publish = (next: T) => {
    if (next === value) return;
    value = next;
    for (const fn of subs) fn();
  };
  return { store, publish };
}

/**
 * Provider side: returns the store for `value`. The store is published after every commit (layout phase, before
 * paint), so subscribers re-render in the same frame.
 */
export function useTrackedStore<T extends object>(value: T, reads: Partial<Record<keyof T, keyof T>> = {}): TrackedStore<T> {
  const [{ store, publish }] = useState(() => createStore(value, reads as Partial<Record<PropertyKey, PropertyKey>>));
  useLayoutEffect(() => publish(value), [publish, value]);
  return store;
}

/** Consumer side: the store's current value; the component re-renders only when a field it read changes. */
export function useTracked<T extends object>(store: TrackedStore<T>): T {
  const ref = useRef<{ keys: Set<PropertyKey>; base: T; version: number } | null>(null);
  ref.current ??= { keys: new Set(), base: store.get(), version: 0 };
  const track = ref.current;

  const getVersion = () => {
    const next = store.get();
    if (next !== track.base) {
      for (const k of track.keys) {
        if (!Object.is(track.base[k as keyof T], next[k as keyof T])) {
          track.version++;
          break;
        }
      }
      track.base = next;
    }
    return track.version;
  };
  useSyncExternalStore(store.subscribe, getVersion, getVersion);

  // The subscription is what this render reads (a field read only in a branch that is not taken costs nothing).
  // Reads from handlers and effects add to it until the next render; they see the latest value either way.
  track.keys.clear();
  const current = store.get();
  track.base = current;
  return useMemo(
    () =>
      new Proxy(current, {
        // Reads go to the latest published value: while rendering that is `current`; in an event handler or effect that
        // closed over the proxy it is the fresh state (a field read only there is not stale for want of a re-render).
        get(_target, key) {
          const v = store.get()[key as keyof T] as unknown;
          if (typeof v === "function") {
            const dep = store.reads[key];
            if (dep !== undefined) track.keys.add(dep);
            return store.fn(key);
          }
          if (typeof key === "symbol") return v;
          track.keys.add(key);
          return v;
        },
      }),
    [current, store, track],
  );
}
