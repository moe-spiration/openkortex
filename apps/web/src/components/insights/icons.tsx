import { createLucideIcon, type IconNode } from "lucide-react";
import type { SVGProps } from "react";

/* Insights.dc.html's own line glyphs (<symbol id="in-*">), drawn like the shell's `Ico`. */

const p = (d: string, key = d): IconNode[number] => ["path", { d, key }];
const c = (cx: string, cy: string, r: string, key: string): IconNode[number] => [
  "circle",
  { cx, cy, r, key },
];

const IN = {
  "in-spark": createLucideIcon("in-spark", [
    p("M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"),
  ]),
  "in-up": createLucideIcon("in-up", [p("M7 17L17 7M8 7h9v9")]),
  "in-down": createLucideIcon("in-down", [p("M7 7l10 10M17 8v9H8")]),
  "in-r": createLucideIcon("in-r", [p("M9 6l6 6-6 6")]),
  "in-book": createLucideIcon("in-book", [
    p("M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"),
    p("M4 19V5M8 7h7"),
  ]),
  "in-pod": createLucideIcon("in-pod", [
    c("12", "11", "3", "a"),
    p("M7.5 15.5a6.5 6.5 0 1 1 9 0M12 14v7"),
  ]),
  "in-cal": createLucideIcon("in-cal", [
    ["rect", { x: "3", y: "5", width: "18", height: "16", rx: "2", key: "r" }],
    p("M3 10h18M8 3v4M16 3v4"),
  ]),
  "in-compass": createLucideIcon("in-compass", [
    c("12", "12", "9", "a"),
    p("M15.5 8.5l-2 5-5 2 2-5z"),
  ]),
  "in-layers": createLucideIcon("in-layers", [p("M12 3l9 5-9 5-9-5z"), p("M3 13l9 5 9-5")]),
  "in-link": createLucideIcon("in-link", [
    p(
      "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    ),
  ]),
  "in-target": createLucideIcon("in-target", [
    c("12", "12", "9", "a"),
    c("12", "12", "5", "b"),
    c("12", "12", "1", "c"),
  ]),
  "in-plus": createLucideIcon("in-plus", [p("M12 5v14M5 12h14")]),
  "in-graph": createLucideIcon("in-graph", [
    c("6", "6", "2.5", "a"),
    c("18", "8", "2.5", "b"),
    c("10", "18", "2.5", "c"),
    p("M8.3 7l7.3.7M7 8.3l2.2 7.4M16.4 10l-4.6 6"),
  ]),
  "in-clock": createLucideIcon("in-clock", [c("12", "12", "9", "a"), p("M12 7v5l3 2")]),
};

export type InIconId = keyof typeof IN;

export function InIco({
  name,
  sm,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { name: InIconId; sm?: boolean }) {
  const Icon = IN[name];
  return (
    <Icon
      aria-hidden
      className={["kx-ico", sm && "kx-ico--sm", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
