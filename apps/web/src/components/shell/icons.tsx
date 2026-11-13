import {
  Eye,
  ShieldCheck,
  Archive,
  Vault,
  Star,
  ArrowDownToLine,
  Boxes,
  Clipboard,
  CornerDownRight,
  FileText,
  Globe,
  Hash,
  Image,
  Inbox,
  Layers,
  Mic,
  ScanSearch,
  Settings,
  Sparkles,
  SquareCheck,
  Sun,
  Zap,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  LayoutTemplate,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  SquarePen,
  Upload,
  ArrowUp,
  Building2,
  Calendar,
  ChevronsUpDown,
  ArrowUpRight,
  FilePlus,
  Highlighter,
  Landmark,
  Lightbulb,
  MessageSquare,
  Pencil,
  Rocket,
  Target,
  Wrench,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns2,
  Flame,
  Folder,
  Keyboard,
  LayoutGrid,
  Link,
  List,
  Mail,
  Lock,
  LogOut,
  Maximize2,
  Minus,
  Monitor,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Square,
  User,
  X,
  createLucideIcon,
  type IconNode,
  type LucideIcon,
  Notebook,
  Paperclip,
  Trash2,
  CornerDownLeft,
} from "lucide-react";
import type { SVGProps } from "react";

/*
 * Icon set of the web workspace (design/reference/WebApp.dc.html, <symbol id="w-*">).
 * Stock Lucide icons where Lucide draws the same glyph; the rest are the prototype's own line
 * glyphs wrapped with createLucideIcon, so every icon renders the same way (24 grid, stroke via .kx-ico).
 */
const p = (d: string, key = d): IconNode[number] => ["path", { d, key }];
const glyph = (name: string, node: IconNode) => createLucideIcon(name, node);

const KxHome = glyph("kx-home", [p("M3 11l9-8 9 8"), p("M5 10v10h14V10")]);
const KxGraph = glyph("kx-graph", [
  ["circle", { cx: "6", cy: "6", r: "2.5", key: "a" }],
  ["circle", { cx: "18", cy: "8", r: "2.5", key: "b" }],
  ["circle", { cx: "12", cy: "18", r: "2.5", key: "c" }],
  p("M8.2 7l7.6 .8M7.5 8l3.3 8M16.8 10l-3.6 6.2"),
]);
const KxBook = glyph("kx-book", [p("M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"), p("M4 19V5M8 7h7")]);
const KxVideo = glyph("kx-video", [
  ["rect", { x: "3", y: "5", width: "18", height: "14", rx: "3", key: "r" }],
  p("M10 9.5v5l4.5-2.5z"),
]);
const KxAi = glyph("kx-ai", [
  ["rect", { x: "4", y: "8", width: "16", height: "12", rx: "3", key: "r" }],
  p("M12 4v4M9 13v2M15 13v2"),
  ["circle", { cx: "12", cy: "3.5", r: "1", key: "c" }],
]);
const KxRecipe = glyph("kx-recipe", [p("M6 3v7a2 2 0 0 0 2 2v9M10 3v7a2 2 0 0 1-2 2M17 3c-2 2-3 5-3 8h3v10")]);
const KxPanel = glyph("kx-panel", [
  ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2", key: "r" }],
  p("M13 4v16"),
]);
const KxSparkles = glyph("kx-sparkles", [
  p("M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"),
  p("M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"),
]);
const KxTimeline = glyph("kx-timeline", [
  p("M6 3v18"),
  ["circle", { cx: "6", cy: "7", r: "2", key: "a" }],
  ["circle", { cx: "6", cy: "17", r: "2", key: "b" }],
  p("M12 7h9M12 17h9"),
]);
const KxCards = glyph("kx-cards", [
  ["rect", { x: "6", y: "3", width: "14", height: "14", rx: "2", key: "r" }],
  p("M3 7v12a2 2 0 0 0 2 2h12"),
]);
const KxGear = glyph("kx-gear", [
  ["circle", { cx: "12", cy: "12", r: "3", key: "c" }],
  p(
    "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  ),
]);
const KxChart = glyph("kx-chart", [p("M4 20V10M10 20V4M16 20v-7M21 20H3")]);
const KxLife = glyph("kx-life", [
  ["circle", { cx: "12", cy: "12", r: "9", key: "c" }],
  p("M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"),
]);
const KxFinance = glyph("kx-finance", [p("M4 19h16M6 16V10M10 16V7M14 16v-5M18 16V5")]);
const KxVentures = glyph("kx-ventures", [p("M5 19c2-6 6-12 14-14-2 8-8 12-14 14z"), p("M9 15l-3-3")]);
// Sidebar glyphs where Lucide's shape differs from the prototype's own symbol (QA: 1:1 icons).
const circle = (cx: string, cy: string, r: string, key: string): IconNode[number] => ["circle", { cx, cy, r, key }];
const KxSun = glyph("kx-sun", [circle("12", "12", "4", "c"), p("M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4")]);
const KxInbox = glyph("kx-inbox", [p("M22 12h-6l-2 3h-4l-2-3H2"), p("M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z")]);
const KxTodo = glyph("kx-todo", [["rect", { x: "3", y: "3", width: "18", height: "18", rx: "3", key: "r" }], p("M8 12l3 3 5-6")]);
const KxZap = glyph("kx-zap", [p("M13 2L4 14h7l-1 8 9-12h-7z")]);
const KxNote = glyph("kx-note", [p("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"), p("M14 3v5h5M9 13h6M9 17h6")]);
const KxMic = glyph("kx-mic", [["rect", { x: "9", y: "3", width: "6", height: "12", rx: "3", key: "r" }], p("M5 11a7 7 0 0 0 14 0M12 18v3")]);
const KxGlobe = glyph("kx-globe", [circle("12", "12", "9", "c"), p("M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18")]);
const KxReview = glyph("kx-review", [["rect", { x: "3", y: "5", width: "18", height: "16", rx: "2", key: "r" }], p("M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4")]);
const KxHealth = glyph("kx-health", [p("M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z")]);
const KxCareer = glyph("kx-career", [["rect", { x: "3", y: "7", width: "18", height: "13", rx: "2", key: "r" }], p("M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18")]);
const KxRelations = glyph("kx-relations", [
  circle("8", "9", "3", "a"),
  circle("16", "9", "3", "b"),
  p("M3 19c.8-3 3-4.5 5-4.5s4.2 1.5 5 4.5M11 19c.8-3 3-4.5 5-4.5s4.2 1.5 5 4.5"),
]);
const KxGrowth = glyph("kx-growth", [p("M12 21V11M12 11C12 7 9 4 5 4c0 4 3 7 7 7zM12 13c0-3 2.5-5.5 6-5.5 0 3.5-2.5 5.5-6 5.5z")]);

const KxImage = glyph("kx-image", [
  ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2", key: "r" }],
  circle("9", "10", "1.6", "c"),
  p("M21 16l-5-5-8 9"),
]);

const KxPalette = glyph("kx-palette", [
  p("M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1 .2-2.2 1.3-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"),
  ["circle", { cx: "7.5", cy: "11", r: "1", key: "a" }],
  ["circle", { cx: "10", cy: "7", r: "1", key: "b" }],
  ["circle", { cx: "14.5", cy: "7", r: "1", key: "c" }],
]);

/** Prototype symbol id (without the `w-` prefix) → icon. */
export const ICONS = {
  home: KxHome,
  sun: KxSun,
  inbox: KxInbox,
  todo: KxTodo,
  graph: KxGraph,
  zap: KxZap,
  "i-note": KxNote,
  "i-meeting": KxMic,
  "i-article": KxGlobe,
  "i-book": KxBook,
  "i-video": KxVideo,
  "i-ai": KxAi,
  "i-recipe": KxRecipe,
  folder: Folder,
  // Lucide "Vault" (safe), so the Vault no longer looks like the Archiv box next to it.
  vault: Vault,
  "chev-r": ChevronRight,
  "chev-d": ChevronDown,
  "chev-u": ChevronUp,
  split: Columns2,
  panel: KxPanel,
  search: Search,
  sparkles: KxSparkles,
  x: X,
  plus: Plus,
  send: ArrowUp,
  grid: LayoutGrid,
  list: List,
  timeline: KxTimeline,
  cards: KxCards,
  check: Check,
  sync: RefreshCw,
  stop: Square,
  gear: KxGear,
  palette: KxPalette,
  user: User,
  bell: Bell,
  lock: Lock,
  logout: LogOut,
  key: Keyboard,
  rail: PanelLeft,
  review: KxReview,
  mic: KxMic,
  link: Link,
  image: KxImage,
  minimize: Minus,
  expand: Maximize2,
  flame: Flame,
  chart: KxChart,
  life: KxLife,
  "l-health": KxHealth,
  "l-career": KxCareer,
  "l-finance": KxFinance,
  "l-ventures": KxVentures,
  "l-relations": KxRelations,
  "l-growth": KxGrowth,
  monitor: Monitor,
  // Note sheet and reader (NoteSheet.dc.html ns-*, Reader.dc.html rd-*)
  calendar: Calendar,
  "up-right": ArrowUpRight,
  "file-plus": FilePlus,
  highlighter: Highlighter,
  message: MessageSquare,
  pencil: Pencil,
  updown: ChevronsUpDown,
  // Domain objects, same glyphs as OBJECT_TYPES in @kortex/ui
  "o-person": User,
  "o-project": Rocket,
  "o-organization": Building2,
  "o-concept": Lightbulb,
  "o-tool": Wrench,
  "o-asset": Landmark,
  "o-goal": Target,
  // Tactile Craft titlebar and sidebar
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "chev-l": ChevronLeft,
  "panel-close": PanelLeftClose,
  "panel-open": PanelLeftOpen,
  "square-pen": SquarePen,
  template: LayoutTemplate,
  upload: Upload,
  menu: Menu,
  moon: Moon,
  square: Square,
  minus: Minus,
  // Orbit-Bar (click dummy names, stock Lucide). Where the frame already draws its own prototype glyph under the
  // same name (sun, inbox, mic …), the bar's Lucide variant is "orbit-<name>" so neither look changes.
  "arrow-down-to-line": ArrowDownToLine,
  boxes: Boxes,
  clipboard: Clipboard,
  "corner-down-right": CornerDownRight,
  "file-text": FileText,
  globe: Globe,
  hash: Hash,
  layers: Layers,
  "scan-search": ScanSearch,
  eye: Eye,
  "shield-check": ShieldCheck,
  "orbit-image": Image,
  "orbit-inbox": Inbox,
  "orbit-mic": Mic,
  "orbit-settings": Settings,
  "orbit-sparkles": Sparkles,
  "orbit-sun": Sun,
  "orbit-todo": SquareCheck,
  "orbit-zap": Zap,
  // G4: Favoriten / Archiv
  star: Star,
  archive: Archive,
  // Mail an Kortex (Settings → Connectors)
  mail: Mail,
  // fx3: Scratchpad (titlebar, Neu menu, orbit bar)
  notebook: Notebook,
  // Feinschliff Live: orbit attach / send, scratchpad entry actions
  paperclip: Paperclip,
  trash: Trash2,
  "corner-down-left": CornerDownLeft,
} satisfies Record<string, LucideIcon>;

export type IconId = keyof typeof ICONS;

export interface IcoProps extends SVGProps<SVGSVGElement> {
  name: IconId;
  /** Class size (16 px md, 14 sm, 20 lg) or an exact pixel size (Orbit-Bar). */
  size?: "sm" | "md" | "lg" | number;
}

/** `.kx-ico` sized icon: CSS sets 16px (14 sm / 20 lg) and stroke 1.6 like the prototype. */
export function Ico({ name, size = "md", className, ...props }: IcoProps) {
  const Icon = ICONS[name];
  const cls = ["kx-ico", size === "sm" && "kx-ico--sm", size === "lg" && "kx-ico--lg", className].filter(Boolean).join(" ");
  const px = typeof size === "number" ? { style: { width: size, height: size } } : {};
  return <Icon aria-hidden className={cls} {...px} {...props} />;
}
