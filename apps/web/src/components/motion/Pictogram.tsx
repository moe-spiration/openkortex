import type { CSSProperties, ReactNode } from "react";

/**
 * Large animated pictograms of the "Ruhe" look (stream D, wave 6): line drawings in text tone with exactly one
 * accent element, looping slowly where nothing else happens (empty views, agent working, sync).
 * Shapes and timings: mockup-quelle/motion-demos.html. Styles and loops: packages/ui/src/styles/ruhe-motion.css.
 * Bewegung "Aus" (data-motion="reduced", see lib/settings/motion.ts) shows the still picture.
 */
import type { PictogramKind } from "./kinds";

export type { PictogramKind } from "./kinds";

export type PictogramSize = "sm" | "md" | "lg";

export function Pictogram({
  kind,
  size = "md",
  idle = false,
  className,
  style,
}: {
  kind: PictogramKind;
  /** lg 208 × 166 (a whole empty view), md 150 × 120 (panels, columns), sm 96 × 77 (palette, home cards). */
  size?: PictogramSize;
  /** Agent without a job: the sources drift slowly and nothing connects. */
  idle?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const cls = ["kx-pic", `kx-pic--${kind}`, size !== "md" && `kx-pic--${size}`, idle && "is-idle", className].filter(Boolean).join(" ");
  return (
    <svg viewBox="0 0 150 120" className={cls} style={style} aria-hidden focusable="false" data-pictogram={kind}>
      {SHAPES[kind]}
    </svg>
  );
}

const SHAPES: Record<PictogramKind, ReactNode> = {
  /* An entry drops into the tray and gets checked off. */
  inbox: (
    <>
      <g className="kx-pic-sheet">
        <rect className="kx-pic-ln kx-pic-bg" x="52" y="26" width="46" height="34" rx="4" />
        <path className="kx-pic-ln kx-pic-f" d="M60 37h30M60 45h22" />
      </g>
      <g className="kx-pic-tray">
        <path className="kx-pic-ln kx-pic-bg" d="M30 64h22l6 12h34l6-12h22v28a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6z" />
      </g>
      <path className="kx-pic-ac kx-pic-chk" d="M66 86l6 6 12-12" />
    </>
  ),
  /* Sources orbit and connect around the agent spark. */
  agent: (
    <>
      <circle className="kx-pic-ln kx-pic-f" cx="75" cy="60" r="40" strokeDasharray="2 6" />
      <g className="kx-pic-orb">
        <circle className="kx-pic-dot" cx="115" cy="60" r="4" />
        <circle className="kx-pic-dot" cx="35" cy="60" r="3" />
        <path className="kx-pic-ln kx-pic-f kx-pic-wire" d="M115 60 L 88 60" />
      </g>
      <g className="kx-pic-orb2">
        <circle className="kx-pic-dot" cx="75" cy="22" r="3.5" />
        <path className="kx-pic-ln kx-pic-f kx-pic-wire" d="M75 22 L 75 46" />
      </g>
      <g className="kx-pic-spk">
        <path className="kx-pic-ac" d="M75 46c1.6 7 5 10.4 12 12-7 1.6-10.4 5-12 12-1.6-7-5-10.4-12-12 7-1.6 10.4-5 12-12z" />
      </g>
    </>
  ),
  /* Markdown and database swap packets. */
  sync: (
    <>
      <rect className="kx-pic-ln" x="22" y="42" width="26" height="34" rx="3" />
      <rect className="kx-pic-ln" x="102" y="42" width="26" height="34" rx="3" />
      <path className="kx-pic-ln kx-pic-f" d="M28 52h14M28 59h10M108 52h14M108 59h10" />
      <g className="kx-pic-arr">
        <path className="kx-pic-ln kx-pic-f" d="M75 42a18 18 0 0 1 16 10M75 78a18 18 0 0 1-16-10" />
        <path className="kx-pic-ln kx-pic-f" d="M91 46v6h-6M59 74v-6h6" />
      </g>
      <circle className="kx-pic-acf kx-pic-pk" r="3" />
      <circle className="kx-pic-acf kx-pic-pk kx-pic-pk--b" r="3" />
    </>
  ),
  /* Cards fan out and settle, a check pops. */
  stack: (
    <>
      <g className="kx-pic-cl">
        <rect className="kx-pic-ln kx-pic-f" x="50" y="34" width="50" height="64" rx="6" />
      </g>
      <g className="kx-pic-cr">
        <rect className="kx-pic-ln kx-pic-f" x="50" y="34" width="50" height="64" rx="6" />
      </g>
      <rect className="kx-pic-ln kx-pic-bg" x="50" y="34" width="50" height="64" rx="6" />
      <path className="kx-pic-ln kx-pic-f" d="M58 46h26M58 54h34M58 62h20" />
      <g className="kx-pic-ok">
        <circle className="kx-pic-acf" cx="104" cy="30" r="10" />
        <path className="kx-pic-on" d="M99 30l3.5 3.5L109 27" />
      </g>
    </>
  ),
  /* The lens keeps looking without pushing. */
  search: (
    <>
      <g>
        <rect className="kx-pic-ln kx-pic-f kx-pic-row" x="34" y="34" width="82" height="8" rx="4" />
        <rect className="kx-pic-ln kx-pic-f kx-pic-row" x="34" y="50" width="64" height="8" rx="4" />
        <rect className="kx-pic-ln kx-pic-f kx-pic-row" x="34" y="66" width="74" height="8" rx="4" />
        <rect className="kx-pic-ln kx-pic-f kx-pic-row" x="34" y="82" width="52" height="8" rx="4" />
      </g>
      <g className="kx-pic-lens">
        <circle className="kx-pic-ln kx-pic-glass" cx="75" cy="58" r="16" />
        <path className="kx-pic-ac" d="M87 70l12 12" />
      </g>
    </>
  ),
  /* An old entry lights up again. */
  idea: (
    <>
      <circle className="kx-pic-halo kx-pic-acf" cx="75" cy="52" r="20" />
      <path className="kx-pic-ln kx-pic-ry" d="M75 18v-8" />
      <path className="kx-pic-ln kx-pic-ry" d="M100 28l6-6" />
      <path className="kx-pic-ln kx-pic-ry" d="M50 28l-6-6" />
      <path className="kx-pic-ln kx-pic-ry" d="M110 52h8" />
      <path className="kx-pic-ln kx-pic-ry" d="M40 52h-8" />
      <path className="kx-pic-ln" d="M64 74c0-8-10-12-10-24a21 21 0 0 1 42 0c0 12-10 16-10 24z" />
      <path className="kx-pic-ac" d="M66 82h18M69 90h12" />
    </>
  ),
};
