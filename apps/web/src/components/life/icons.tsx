import { createLucideIcon, type IconNode } from "lucide-react";
import type { SVGProps } from "react";

/* Life.dc.html's own line glyphs (<symbol id="lf-*">), drawn like the shell's `Ico`. */

const p = (d: string, key = d): IconNode[number] => ["path", { d, key }];

const LF = {
  l: createLucideIcon("lf-l", [p("M15 6l-6 6 6 6")]),
  spark: createLucideIcon("lf-spark", [p("M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z")]),
  target: createLucideIcon("lf-target", [
    ["circle", { cx: "12", cy: "12", r: "8", key: "a" }],
    ["circle", { cx: "12", cy: "12", r: "4", key: "b" }],
    ["circle", { cx: "12", cy: "12", r: "0.8", key: "c" }],
  ]),
  edit: createLucideIcon("lf-edit", [p("M4 20h4L19 9l-4-4L4 16z")]),
};

export function LIco({ name, sm, className, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof LF; sm?: boolean }) {
  const Icon = LF[name];
  return <Icon aria-hidden className={["kx-ico", sm && "kx-ico--sm", className].filter(Boolean).join(" ")} {...props} />;
}
