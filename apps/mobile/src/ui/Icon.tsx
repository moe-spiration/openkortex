import Svg, { Circle, Path, Rect } from "react-native-svg";

/* Line icons of the mobile prototype (`<symbol id="mb-*">` in Mobile.dc.html), 24 grid, 1.6 stroke. */

type Shape = { t: "p"; d: string } | { t: "c"; cx: number; cy: number; r: number } | { t: "r"; x: number; y: number; w: number; h: number; rx?: number };

const p = (d: string): Shape => ({ t: "p", d });
const c = (cx: number, cy: number, r: number): Shape => ({ t: "c", cx, cy, r });
const r = (x: number, y: number, w: number, h: number, rx?: number): Shape => ({ t: "r", x, y, w, h, rx });

const ICONS = {
  home: [p("M4 11l8-7 8 7v9H4z")],
  list: [p("M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01")],
  inbox: [p("M3 13l3-8h12l3 8v6H3z"), p("M3 13h5l1 2h6l1-2h5")],
  life: [c(12, 12, 9), p("M12 3v18M3 12h18")],
  sun: [c(12, 12, 4), p("M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41")],
  search: [c(11, 11, 6.5), p("M20 20l-4.2-4.2")],
  mic: [r(9, 3, 6, 11, 3), p("M5 11a7 7 0 0 0 14 0M12 18v3")],
  stop: [r(6, 6, 12, 12, 2)],
  play: [p("M8 5l11 7-11 7z")],
  check: [p("M5 12.5l4.5 4.5L19 7")],
  sparkles: [p("M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"), p("M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z")],
  tag: [p("M3 12V4h8l10 10-8 8z"), c(7.5, 8.5, 1)],
  share: [c(6, 12, 2.5), c(17, 6, 2.5), c(17, 18, 2.5), p("M8.2 10.8l6.6-3.6M8.2 13.2l6.6 3.6")],
  bolt: [p("M13 3L5 14h6l-1 7 8-11h-6z")],
  msg: [p("M21 12a8 8 0 0 1-11.5 7.2L4 20l1.2-4.6A8 8 0 1 1 21 12z")],
  mail: [r(3, 5, 18, 14, 2), p("M3 7l9 6 9-6")],
  link: [p("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1")],
  heart: [p("M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z")],
  send: [p("M12 19V5M5 12l7-7 7 7")],
  x: [p("M6 6l12 12M18 6L6 18")],
  sync: [p("M20 12a8 8 0 0 0-14-5.3L4 8M4 4v4h4M4 12a8 8 0 0 0 14 5.3L20 16M20 20v-4h-4")],
  note: [p("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"), p("M14 3v5h5M9 13h6M9 17h4")],
  camera: [p("M4 8h3l2-3h6l2 3h3v11H4z"), c(12, 13, 3.5)],
  plus: [p("M12 5v14M5 12h14")],
  sort: [p("M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3")],
  grid: [r(4, 4, 7, 7, 1.5), r(13, 4, 7, 7, 1.5), r(4, 13, 7, 7, 1.5), r(13, 13, 7, 7, 1.5)],
  time: [p("M6 4v16"), c(6, 8, 2), c(6, 16, 2), p("M11 8h9M11 16h9")],
  chev: [p("M9 6l6 6-6 6")],
  flame: [p("M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3 0-6 1-8.5z")],
  archive: [r(3, 4, 18, 4, 1), p("M5 8v11h14V8M10 12h4")],
  star: [p("M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z")],
  trash: [p("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3")],
  folder: [p("M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z")],
  // Editor (A3), Lucide line shapes.
  bold: [p("M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z")],
  italic: [p("M10 5h8M6 19h8M14 5l-4 14")],
  strike: [p("M4 12h16M16 6.5A4 3 0 0 0 12 5c-2.5 0-4 1.3-4 3 0 1.2.8 2 2 2.5M8 17.5a4 3 0 0 0 4 1.5c2.5 0 4-1.3 4-3 0-.6-.2-1.2-.5-1.6")],
  code: [p("M9 7l-5 5 5 5M15 7l5 5-5 5")],
  wiki: [p("M8 4H5v16h3M16 4h3v16h-3")],
  checkSquare: [r(4, 4, 16, 16, 3), p("M8.5 12l2.5 2.5 4.5-5")],
  square: [r(4, 4, 16, 16, 3)],
  indent: [p("M3 5h18M11 12h10M11 19h10M3 9l4 3-4 3")],
  outdent: [p("M3 5h18M11 12h10M11 19h10M7 9l-4 3 4 3")],
  arrowUp: [p("M12 19V5M6 11l6-6 6 6")],
  arrowDown: [p("M12 5v14M6 13l6 6 6-6")],
  type: [p("M4 7V5h16v2M9 19h6M12 5v14")],
  quote: [p("M5 17c2.5-1 3.5-3 3.5-6V7H5v4h3.5M14 17c2.5-1 3.5-3 3.5-6V7H14v4h3.5")],
  listOrdered: [p("M10 6h10M10 12h10M10 18h10M4 5h1.5v4M4 9h3M4 15.5c.3-.6 1-1 1.6-1 .8 0 1.4.5 1.4 1.2 0 1.3-3 1.6-3 3.3h3")],
  minus: [p("M5 12h14")],
  heading: [p("M6 5v14M18 5v14M6 12h12")],
  // Swipe tray of Heute verarbeitet (Lucide flag, mail-open).
  bell: [p("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"), p("M10.3 21a1.94 1.94 0 0 0 3.4 0")],
  eye: [p("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"), c(12, 12, 3)],
  eyeOff: [p("M10.7 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20")],
  flag: [p("M4 22V4M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1")],
  // Type icons of the registry (@kortex/db typeIcon, Lucide shapes).
  clapperboard: [p("M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"), p("m6.2 5.3 3.1 3.9M12.4 3.4l3.1 4M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z")],
  book: [p("M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20")],
  bag: [p("M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"), p("M3 6h18M16 10a4 4 0 0 1-8 0")],
  pin: [p("M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"), c(12, 10, 3)],
  receipt: [p("M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"), p("M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11")],
  user: [c(12, 8, 4), p("M20 21a8 8 0 0 0-16 0")],
  target: [c(12, 12, 10), c(12, 12, 6), c(12, 12, 2)],
  mailOpen: [p("M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"), p("M22 10l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10")],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  color: string;
  /** Pixel size; the prototype uses 16 (default), 14 (`kx-ico--sm`), 22 (tab bar), 24 (orb). */
  size?: number;
  strokeWidth?: number;
  rotate?: number;
}

export function Icon({ name, color, size = 16, strokeWidth = 1.6, rotate }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={rotate ? { transform: [{ rotate: `${rotate}deg` }] } : undefined}>
      {(ICONS[name] ?? []).map((s, i) => {
        const common = { stroke: color, strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;
        if (s.t === "p") return <Path key={i} d={s.d} {...common} />;
        if (s.t === "c") return <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} {...common} />;
        return <Rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} {...common} />;
      })}
    </Svg>
  );
}
