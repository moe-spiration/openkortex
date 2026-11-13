import { createLucideIcon, type IconNode } from "lucide-react";
import type { SVGProps } from "react";

/* WeeklyReview.dc.html's own line glyphs (<symbol id="wr-*">), drawn like the shell's `Ico`. */

const p = (d: string, key = d): IconNode[number] => ["path", { d, key }];

const WR = {
  spark: createLucideIcon("wr-spark", [p("M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z")]),
  check: createLucideIcon("wr-check", [p("M5 12.5l4.5 4.5L19 7")]),
  up: createLucideIcon("wr-up", [p("M12 19V5M6 11l6-6 6 6")]),
  down: createLucideIcon("wr-down", [p("M12 5v14M6 13l6 6 6-6")]),
  r: createLucideIcon("wr-r", [p("M9 6l6 6-6 6")]),
  l: createLucideIcon("wr-l", [p("M15 6l-6 6 6 6")]),
  file: createLucideIcon("wr-file", [p("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"), p("M14 3v5h5")]),
};

export function WIco({ name, sm, className, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof WR; sm?: boolean }) {
  const Icon = WR[name];
  return <Icon aria-hidden className={["kx-ico", sm && "kx-ico--sm", className].filter(Boolean).join(" ")} {...props} />;
}
