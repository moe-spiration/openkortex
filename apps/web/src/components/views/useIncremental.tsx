"use client";

import { startTransition, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { INCREMENT, nextShown } from "./incremental";
import { t } from "@/i18n";

/**
 * Lazy rendering of a long list: the first `step` rows render at once, the next batch when the sentinel nears the
 * viewport (600 px ahead, so scrolling does not hit an edge). The count goes back to the first batch when `resetKey`
 * changes (filter, sort, view), not when rows change in place (optimistic edits). `reveal(i)` renders up to row i
 * first and then runs `then` (scroll to a day, J/K stepping).
 */
export function useIncremental(
  total: number,
  resetKey: string,
  opts: { step?: number; root?: Element | null } = {},
) {
  const step = opts.step ?? INCREMENT;
  const [state, setState] = useState({ key: resetKey, shown: step });
  // Reset during render (no extra frame with the old count).
  const shown = state.key === resetKey ? state.shown : step;
  if (state.key !== resetKey) setState({ key: resetKey, shown: step });

  const more = total > shown;
  const observer = useRef<IntersectionObserver | null>(null);
  const sentinel = useCallback(
    (el: Element | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el || typeof IntersectionObserver === "undefined") return;
      observer.current = new IntersectionObserver(
        (entries) => {
          // A transition: the next batch renders without blocking the scroll that brought it in.
          if (entries.some((e) => e.isIntersecting))
            startTransition(() => setState((s) => ({ key: s.key, shown: nextShown(s.shown, total, step) })));
        },
        // Root: the page scroller (.kx-scroll), so the 600 px margin applies to it and not to the window.
        { root: opts.root ?? el.closest(".kx-scroll"), rootMargin: "600px 0px" },
      );
      observer.current.observe(el);
    },
    // `shown` too: a fresh observer reports at once if the sentinel is still in reach after a batch (tall screens).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [total, step, opts.root, shown],
  );
  useEffect(() => () => observer.current?.disconnect(), []);

  const reveal = useCallback(
    (index: number, then?: () => void) => {
      if (index >= shown)
        setState((s) => ({ key: s.key, shown: nextShown(s.shown, total, step, index) }));
      // Two frames: React commits the new rows, then the caller can find and scroll to them.
      if (then) requestAnimationFrame(() => requestAnimationFrame(then));
    },
    [shown, total, step],
  );

  return { shown: Math.min(shown, total), more, sentinel, reveal };
}

/** Renders `items` in batches (see useIncremental); the sentinel line says how many are left. */
export function LazyItems<T>({
  items,
  render,
  resetKey,
  step,
}: {
  items: readonly T[];
  render: (item: T, index: number) => ReactNode;
  resetKey: string;
  step?: number;
}) {
  const lazy = useIncremental(items.length, resetKey, { step });
  return (
    <>
      {items.slice(0, lazy.shown).map(render)}
      {lazy.more && (
        <div ref={lazy.sentinel} className="kx-meta" data-load-more style={{ padding: "8px 4px" }}>
          {t("{n} more …", { n: items.length - lazy.shown })}
        </div>
      )}
    </>
  );
}
