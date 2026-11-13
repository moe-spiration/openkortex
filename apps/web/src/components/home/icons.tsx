import { createLucideIcon, type IconNode } from "lucide-react";
import type { SVGProps } from "react";

/* The Home prototype's own line glyphs (Home.dc.html <symbol id="hm-*">), drawn like the shell's `Ico`. */

const p = (d: string, key = d): IconNode[number] => ["path", { d, key }];

const HM = {
  mic: createLucideIcon("hm-mic", [["rect", { x: "9", y: "3", width: "6", height: "12", rx: "3", key: "r" }], p("M5 11a7 7 0 0 0 14 0M12 18v3")]),
  play: createLucideIcon("hm-play", [p("M8 5l11 7-11 7z")]),
  sparkles: createLucideIcon("hm-sparkles", [
    p("M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"),
    p("M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"),
  ]),
  flame: createLucideIcon("hm-flame", [p("M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z")]),
  sync: createLucideIcon("hm-sync", [p("M20 12a8 8 0 0 0-14-5.3L4 8M4 4v4h4M4 12a8 8 0 0 0 14 5.3L20 16M20 20v-4h-4")]),
  check: createLucideIcon("hm-check", [p("M5 12.5l4.5 4.5L19 7")]),
  "up-right": createLucideIcon("hm-up-right", [p("M7 17L17 7M8 7h9v9")]),
  sliders: createLucideIcon("hm-sliders", [
    p("M4 7h10M18 7h2M4 17h4M12 17h8"),
    ["circle", { cx: "16", cy: "7", r: "2", key: "a" }],
    ["circle", { cx: "10", cy: "17", r: "2", key: "b" }],
  ]),
  chev: createLucideIcon("hm-chev", [p("M6 9l6 6 6-6")]),
};

export type HomeIconId = keyof typeof HM;

export function HIco({ name, sm, className, ...props }: SVGProps<SVGSVGElement> & { name: HomeIconId; sm?: boolean }) {
  const Icon = HM[name];
  return <Icon aria-hidden className={["kx-ico", sm && "kx-ico--sm", className].filter(Boolean).join(" ")} {...props} />;
}
