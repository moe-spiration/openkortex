"use client";

import { useEffect } from "react";
import { HOST_SELECTOR, gestureIcons } from "./gestures";

/**
 * Icon gestures on the action itself (concept: "runs once on hover or on the matching action"). Hover and keyboard
 * focus are pure CSS (ruhe-motion.css); this layer adds the action: a click, tap or Enter on a control replays the
 * gesture of its icon (the star pops when you favourite, the archive lid lifts when you archive, the arrow flies
 * when you send), also on touch, where there is no hover. One delegated listener, nothing per control.
 * Bewegung "Aus" needs no check here: the CSS turns every animation off.
 */
export function GestureLayer() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const host = e.target instanceof Element ? e.target.closest(HOST_SELECTOR) : null;
      if (host) playGesture(host);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}

const timers = new WeakMap<Element, number>();

/** Replays the icon gesture(s) of a control (or of an icon itself) once. Safe to call from any action handler. */
export function playGesture(host: Element | null | undefined): void {
  if (!host || document.documentElement.dataset.look !== "ruhe") return;
  for (const svg of gestureIcons(host)) {
    const el = svg as SVGElement;
    // Restart even if hover already ran it: drop the animation for one frame, then mark the icon as playing.
    el.classList.remove("kx-gesture-play");
    el.style.animation = "none";
    void el.getBoundingClientRect();
    el.style.animation = "";
    el.classList.add("kx-gesture-play");
    window.clearTimeout(timers.get(el));
    timers.set(el, window.setTimeout(() => el.classList.remove("kx-gesture-play"), 900));
  }
}
