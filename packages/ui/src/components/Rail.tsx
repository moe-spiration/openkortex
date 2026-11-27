"use client";

import { t } from "@kortex/i18n";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { railEdges, railStep, type RailEdges } from "./rail-edges";

/*
 * Horizontal strips without a scrollbar (Tactile Craft v2, decision 7; dummy `Rail` and `HScroll`, the
 * /insights "Weitere Impulse" pattern): soft fade at the hidden edge, arrows that are disabled at the ends,
 * scroll-snap per item. Styles: tactile.css (.tc-rail*, .tc-hs*).
 */

function useRailEdges() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<RailEdges>({ left: false, right: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = railEdges(el);
    setEdges((e) => (e.left === next.left && e.right === next.right ? e : next));
  }, []);
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [update]);
  const scroll = useCallback((dir: -1 | 1, step?: number) => {
    const el = ref.current;
    if (!el) return;
    // Bewegung "Aus" is data-motion="reduced" on <html> (the app resolves the user's choice against the OS there).
    const reduced = typeof document !== "undefined" && document.documentElement.dataset.motion === "reduced";
    el.scrollBy({ left: dir * railStep(el.clientWidth, step), behavior: reduced ? "auto" : "smooth" });
  }, []);
  return { ref, edges, update, scroll };
}

const fade = (e: RailEdges) => cn(e.right && "is-fade-r", e.left && "is-fade-l");

export interface RailProps {
  /** Section title (h2, 15/500). */
  title?: ReactNode;
  /** Quiet text before the arrows (e.g. "7 Mixes · aus Deinen Hashtags"); hidden below 860 px. */
  meta?: ReactNode;
  /** Extra controls in the head, before the arrows. */
  actions?: ReactNode;
  /** Pixels per arrow click (default: 80 % of the visible width). */
  step?: number;
  /** Gap between the items in px (default 8). */
  gap?: number;
  /** Accessible name of the strip when there is no title. */
  "aria-label"?: string;
  className?: string;
  children: ReactNode;
}

/** Strip with a head (title, meta, arrows) and snap-scrolling items. */
export function Rail({ title, meta, actions, step, gap, className, children, ...rest }: RailProps) {
  const { ref, edges, update, scroll } = useRailEdges();
  return (
    <section className={cn("tc-rail-wrap", className)} aria-label={rest["aria-label"]}>
      <div className="tc-rail-head">
        {title ? <h2 className="tc-rail-title">{title}</h2> : null}
        <span className="tc-grow" />
        {meta ? <span className="tc-rail-meta">{meta}</span> : null}
        {actions}
        <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={t("Scroll back")} disabled={!edges.left} onClick={() => scroll(-1, step)}>
          <ChevronLeft className="kx-ico" aria-hidden />
        </button>
        <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={t("Scroll forward")} disabled={!edges.right} onClick={() => scroll(1, step)}>
          <ChevronRight className="kx-ico" aria-hidden />
        </button>
      </div>
      <div
        ref={ref}
        className={cn("tc-rail", fade(edges))}
        style={gap != null ? ({ "--rail-gap": `${gap}px` } as CSSProperties) : undefined}
        onScroll={update}
      >
        {children}
      </div>
    </section>
  );
}

export interface HScrollProps {
  className?: string;
  /** Class of the scrolling element (e.g. a table wrapper). */
  innerClassName?: string;
  children: ReactNode;
}

/** Any horizontal overflow (tables, week calendar on small screens): no scrollbar, edge fade, round arrows at the sides. */
export function HScroll({ className, innerClassName, children }: HScrollProps) {
  const { ref, edges, update, scroll } = useRailEdges();
  return (
    <div className={cn("tc-hs", className)}>
      <div ref={ref} className={cn("tc-hs-in", fade(edges), innerClassName)} onScroll={update}>
        {children}
      </div>
      {edges.left && (
        <button type="button" className="tc-hs-btn tc-hs-btn--l" aria-label={t("Scroll left")} onClick={() => scroll(-1)}>
          <ChevronLeft className="kx-ico" aria-hidden />
        </button>
      )}
      {edges.right && (
        <button type="button" className="tc-hs-btn tc-hs-btn--r" aria-label={t("Scroll right")} onClick={() => scroll(1)}>
          <ChevronRight className="kx-ico" aria-hidden />
        </button>
      )}
    </div>
  );
}
