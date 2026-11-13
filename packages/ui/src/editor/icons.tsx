import { createLucideIcon, type IconNode } from "lucide-react";

/* Prototype glyphs (design/reference/NoteSheet.dc.html, <symbol id="ns-*">), drawn like Lucide icons. */
const p = (d: string, key = d): IconNode[number] => ["path", { d, key }];

export const HeadingIcon = createLucideIcon("kx-ns-h", [p("M5 5v14M19 5v14M5 12h14")]);
export const TodoIcon = createLucideIcon("kx-ns-todo", [
  ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "3", key: "r" }],
  p("M8 12l3 3 5-6"),
]);
export const CalloutIcon = createLucideIcon("kx-ns-callout", [
  p("M21 12a8 8 0 0 1-11.5 7.2L4 20l1.2-4.6A8 8 0 1 1 21 12z"),
]);
export const CodeIcon = createLucideIcon("kx-ns-code", [
  p("M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"),
]);
export const SparklesIcon = createLucideIcon("kx-ns-sparkles", [
  p("M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"),
  p("M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"),
]);
export const NoteIcon = createLucideIcon("kx-ns-i-note", [
  p("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"),
  p("M14 3v5h5M9 13h6M9 17h6"),
]);

export {
  FilePlus as SubpageIcon,
  Image as ImageIcon,
  Table as TableIcon,
  Link2 as LinkIcon,
  AtSign as MentionIcon,
  Type as TextIcon,
  Heading1 as Heading1Icon,
  Heading2 as Heading2Icon,
  Heading3 as Heading3Icon,
  List as BulletIcon,
  ListOrdered as NumberedIcon,
  Quote as QuoteIcon,
  ChevronRight as ToggleIcon,
  Minus as DividerIcon,
  Copy as DuplicateIcon,
  Trash2 as DeleteIcon,
  Repeat2 as TurnIntoIcon,
  PenLine as RewriteIcon,
  Scissors as ShortenIcon,
  ArrowRightToLine as ContinueIcon,
  ListTree as SummarizeIcon,
  MessageCircleQuestion as AskIcon,
  WandSparkles as CustomAiIcon,
  Sun as DailyNoteIcon,
} from "lucide-react";
