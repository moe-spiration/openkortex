"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Same timing as <TipProvider>: a short delay, then neighbouring tooltips show at once. */
const DELAY_MS = 450;
const WARM_MS = 600;
const GAP = 6;
const EDGE = 8;

type TipState = { text: string; x: number; y: number; above: boolean } | null;

/**
 * App-wide replacement for the browser's native `title` tooltips (grey OS boxes, ~1 s delay, Win32 look in the
 * Windows app): the first hover moves an element's `title` to `data-kx-tip` (and to `aria-label` when the element
 * has no accessible name yet), and one floating `.kx-tip` in the Kortex look shows it. Components keep writing
 * plain `title=` props; when React later changes the prop, the next hover picks the new text up.
 */
export function TitleTips() {
  const [tip, setTip] = useState<TipState>(null);
  const timer = useRef<number | null>(null);
  const current = useRef<Element | null>(null);
  const warmUntil = useRef(0);

  useEffect(() => {
    const clear = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = () => {
      clear();
      if (current.current) warmUntil.current = Date.now() + WARM_MS;
      current.current = null;
      setTip(null);
    };
    const adopt = (el: Element): string | null => {
      const title = el.getAttribute("title");
      if (title !== null) {
        el.removeAttribute("title");
        if (title.trim()) {
          el.setAttribute("data-kx-tip", title);
          if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby") && !(el.textContent ?? "").trim()) {
            el.setAttribute("aria-label", title);
          }
        } else el.removeAttribute("data-kx-tip");
      }
      return el.getAttribute("data-kx-tip");
    };
    const show = (el: Element, text: string) => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      const above = r.bottom + 40 > window.innerHeight;
      setTip({ text, x: r.left + r.width / 2, y: above ? r.top - GAP : r.bottom + GAP, above });
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const target = e.target instanceof Element ? e.target.closest("[title], [data-kx-tip]") : null;
      if (target === current.current) return;
      hide();
      if (!target) return;
      const text = adopt(target);
      if (!text) return;
      current.current = target;
      const wait = Date.now() < warmUntil.current ? 0 : DELAY_MS;
      timer.current = window.setTimeout(() => show(target, text), wait);
    };
    const onOut = (e: PointerEvent) => {
      const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
      if (current.current && to && current.current.contains(to)) return;
      if (current.current && e.target instanceof Element && !current.current.contains(e.target)) return;
      hide();
    };
    const dismiss = () => {
      clear();
      current.current = null;
      setTip(null);
    };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("blur", dismiss);
    return () => {
      clear();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss, true);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("blur", dismiss);
    };
  }, []);

  const box = useRef<HTMLDivElement | null>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!tip || !box.current) return setShift(0);
    // Keep the tooltip inside the window horizontally.
    const r = box.current.getBoundingClientRect();
    const left = tip.x - r.width / 2;
    const right = tip.x + r.width / 2;
    setShift(left < EDGE ? EDGE - left : right > window.innerWidth - EDGE ? window.innerWidth - EDGE - right : 0);
  }, [tip]);

  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      className="kx-tip kx-tip--title"
      style={{
        position: "fixed",
        left: tip.x + shift,
        top: tip.y,
        translate: tip.above ? "-50% -100%" : "-50% 0",
        pointerEvents: "none",
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
