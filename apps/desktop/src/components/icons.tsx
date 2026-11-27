import { createLucideIcon, type IconNode } from "lucide-react";
import type { SVGProps } from "react";

/* Desktop.dc.html's own line glyphs (<symbol id="d-*">), rendered as `.kx-ico` SVGs. */

const p = (d: string, key = d): IconNode[number] => ["path", { d, key }];
const c = (cx: string, cy: string, r: string, key: string): IconNode[number] => [
  "circle",
  { cx, cy, r, key },
];
const r = (x: string, y: string, w: string, h: string, rx: string): IconNode[number] => [
  "rect",
  { x, y, width: w, height: h, rx, key: "r" },
];
const g = (name: string, node: IconNode) => createLucideIcon(name, node);

const D = {
  min: g("d-min", [p("M5 12h14")]),
  max: g("d-max", [r("5", "5", "14", "14", "1.5")]),
  x: g("d-x", [p("M6 6l12 12M18 6L6 18")]),
  shield: g("d-shield", [p("M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"), p("M9 12l2 2 4-4")]),
  sparkles: g("d-sparkles", [
    p("M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"),
    p("M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"),
  ]),
  mic: g("d-mic", [r("9", "3", "6", "11", "3"), p("M5 11a7 7 0 0 0 14 0M12 18v3")]),
  speaker: g("d-speaker", [p("M4 9v6h4l5 4V5L8 9z"), p("M16.5 8.5a5 5 0 0 1 0 7")]),
  check: g("d-check", [p("M5 12.5l4.5 4.5L19 7")]),
  plus: g("d-plus", [p("M12 5v14M5 12h14")]),
  search: g("d-search", [c("11", "11", "6.5", "a"), p("M20 20l-4.2-4.2")]),
  expand: g("d-expand", [p("M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7")]),
  grip: g("d-grip", [
    c("9", "6", "1", "a"),
    c("15", "6", "1", "b"),
    c("9", "12", "1", "c"),
    c("15", "12", "1", "d"),
    c("9", "18", "1", "e"),
    c("15", "18", "1", "f"),
  ]),
  // Lucide "link" (connect the account).
  link: g("d-link", [
    p("M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"),
    p("M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"),
  ]),
  // Lucide "bell" (reminders).
  bell: g("d-bell", [p("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"), p("M10.3 21a1.94 1.94 0 0 0 3.4 0")]),
  stop: g("d-stop", [r("6", "6", "12", "12", "2")]),
  trash: g("d-trash", [p("M4 7h16"), p("M10 11v6"), p("M14 11v6"), p("M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"), p("M9 7V4h6v3")]),
  resize: g("d-resize", [p("M20 12l-8 8"), p("M20 17l-3 3")]),
  rec: g("d-rec", [c("12", "12", "6", "a")]),
  file: g("d-file", [
    p("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"),
    p("M14 3v5h5M9 13h6M9 17h6"),
  ]),
  inbox: g("d-inbox", [p("M3 13l3-8h12l3 8v6H3z"), p("M3 13h5l1 2h6l1-2h5")]),
  task: g("d-task", [r("4", "4", "16", "16", "3"), p("M8 12l3 3 5-6")]),
  msg: g("d-msg", [p("M21 12a8 8 0 0 1-11.5 7.2L4 20l1.2-4.6A8 8 0 1 1 21 12z")]),
  cal: g("d-cal", [r("3", "5", "18", "16", "2"), p("M3 10h18M8 3v4M16 3v4")]),
  sliders: g("d-sliders", [
    p("M4 7h10M18 7h2M4 17h4M12 17h8"),
    c("16", "7", "2", "a"),
    c("10", "17", "2", "b"),
  ]),
  gear: g("d-gear", [
    c("12", "12", "3", "a"),
    p(
      "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    ),
  ]),
  power: g("d-power", [p("M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0")]),
  sync: g("d-sync", [
    p("M20 12a8 8 0 0 0-14-5.3L4 8M4 4v4h4M4 12a8 8 0 0 0 14 5.3L20 16M20 20v-4h-4"),
  ]),
  "chev-d": g("d-chev-d", [p("M6 9l6 6 6-6")]),
  "up-right": g("d-up-right", [p("M7 17L17 7M8 7h9v9")]),
  wifi: g("d-wifi", [p("M3 9a14 14 0 0 1 18 0M6 13a9 9 0 0 1 12 0M9.5 16.5a4 4 0 0 1 5 0")]),
  /** Lucide bookmark-plus: Clip (mark a moment). */
  clip: g("d-clip", [p("M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"), p("M12 7v6M9 10h6")]),
  hud: g("d-hud", [r("3", "4", "18", "16", "3"), p("M14 4v16")]),
  /** Lucide folder-open: vault and Dropzone in the Explorer. */
  folder: g("d-folder", [p("M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2")]),
};

export type DIconId = keyof typeof D;

export function DIco({
  name,
  sm,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { name: DIconId; sm?: boolean }) {
  const Icon = D[name];
  return (
    <Icon
      aria-hidden
      className={["kx-ico", sm && "kx-ico--sm", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
