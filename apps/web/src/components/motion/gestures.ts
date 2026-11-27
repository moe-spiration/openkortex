/*
 * The ten icon gestures of the Ruhe concept (motion-demos.html "Animierte Icons"), and which icons carry them.
 * The CSS (packages/ui/src/styles/ruhe-motion.css) is the source of the motion; this list documents it for the tests
 * and lets GestureLayer find the icons of a control.
 */

export interface Gesture {
  /** Keyframes in ruhe-motion.css. */
  keyframes: string;
  /** Ico ids (data-ico) and Lucide icon names (class lucide-<name>) that carry it. */
  ico: string[];
  lucide: string[];
}

export const GESTURES: Record<string, Gesture> = {
  agent: { keyframes: "kx-g-twinkle", ico: ["sparkles", "orbit-sparkles"], lucide: ["sparkles", "sparkle", "wand-sparkles"] },
  reminder: { keyframes: "kx-g-ring", ico: ["bell"], lucide: ["bell", "bell-ring", "bell-plus", "bell-dot", "alarm-clock"] },
  speak: { keyframes: "kx-g-level", ico: ["mic", "orbit-mic", "audio-lines"], lucide: ["mic", "audio-lines"] },
  done: { keyframes: "kx-g-draw", ico: ["check", "todo", "orbit-todo"], lucide: ["check", "check-check", "square-check", "square-check-big", "circle-check", "circle-check-big", "list-checks"] },
  favorite: { keyframes: "kx-g-starpop", ico: ["star"], lucide: ["star"] },
  inbox: { keyframes: "kx-g-settle", ico: ["inbox", "orbit-inbox", "kx-inbox"], lucide: ["inbox", "arrow-down-to-line"] },
  sync: { keyframes: "kx-g-spin", ico: ["sync"], lucide: ["refresh-cw", "refresh-ccw", "rotate-cw", "rotate-ccw"] },
  archive: { keyframes: "kx-g-lid", ico: ["archive", "trash"], lucide: ["archive", "archive-restore", "trash", "trash-2"] },
  send: { keyframes: "kx-g-up", ico: ["send"], lucide: ["send", "send-horizontal", "arrow-up"] },
  graph: { keyframes: "kx-g-pulse", ico: ["graph"], lucide: ["network", "waypoints", "share-2", "orbit"] },
};

/** Controls whose icon gestures play on hover, focus and click. */
export const HOST_SELECTOR =
  'button, a, label, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"]';

const ICON_SELECTOR = ":scope > svg, :scope > :not(svg) > svg, :scope > :not(svg) > :not(svg) > svg";

/** True for an icon that has a gesture (by its data-ico id or its Lucide class). */
export function hasGesture(svg: Element): boolean {
  const id = svg.getAttribute("data-ico");
  const cls = svg.getAttribute("class") ?? "";
  return Object.values(GESTURES).some((g) => (id !== null && g.ico.includes(id)) || g.lucide.some((n) => cls.split(/\s+/).includes(`lucide-${n}`)));
}

/** The gesture icons of a control: up to three levels deep (like the hover rule), or the icon itself. */
export function gestureIcons(host: Element): Element[] {
  if (host.tagName.toLowerCase() === "svg") return hasGesture(host) ? [host] : [];
  return Array.from(host.querySelectorAll(ICON_SELECTOR)).filter(hasGesture);
}
