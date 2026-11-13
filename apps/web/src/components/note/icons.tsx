import {
  Archive,
  ArrowUpRight,
  AtSign,
  Bell,
  Ellipsis,
  FolderInput,
  Layers,
  ListChecks,
  BookOpen,
  Boxes,
  Brain,
  Building2,
  Calendar,
  Check,
  ChefHat,
  ChevronDown,
  ChevronUp,
  Columns2,
  File,
  FileCode,
  FileText,
  FolderKanban,
  Folder,
  Globe,
  Hash,
  Image,
  Info,
  Landmark,
  LayoutTemplate,
  Lightbulb,
  Link,
  Maximize2,
  Mic,
  Minimize2,
  NotebookPen,
  Play,
  Plus,
  Podcast,
  Rocket,
  Shapes,
  SmilePlus,
  Sparkles,
  SquareCheck,
  Sun,
  Target,
  Trash2,
  User,
  Wrench,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import type { ItemType } from "@/lib/workspace-data";

/*
 * Lucide icons of the drawer and the editor (Tactile Craft v2: line icons, --icon-stroke 1.5). Own set so package C
 * does not touch the shell's icon map (package A).
 */

const ICONS = {
  "arrow-up-right": ArrowUpRight,
  "at-sign": AtSign,
  "book-open": BookOpen,
  archive: Archive,
  bell: Bell,
  ellipsis: Ellipsis,
  "folder-input": FolderInput,
  layers: Layers,
  "list-checks": ListChecks,
  boxes: Boxes,
  calendar: Calendar,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  "columns-2": Columns2,
  file: File,
  "file-code": FileCode,
  "file-text": FileText,
  folder: Folder,
  "folder-kanban": FolderKanban,
  hash: Hash,
  image: Image,
  info: Info,
  "layout-template": LayoutTemplate,
  link: Link,
  "maximize-2": Maximize2,
  mic: Mic,
  "minimize-2": Minimize2,
  "notebook-pen": NotebookPen,
  plus: Plus,
  shapes: Shapes,
  "smile-plus": SmilePlus,
  sparkles: Sparkles,
  "square-check": SquareCheck,
  sun: Sun,
  "trash-2": Trash2,
  x: X,
} satisfies Record<string, LucideIcon>;

export type NoteIconName = keyof typeof ICONS;

export function NIco({ name, size = 14, className, ...props }: { name: NoteIconName; size?: number } & Omit<LucideProps, "ref">) {
  const Icon = ICONS[name];
  return <Icon aria-hidden size={size} strokeWidth={1.5} className={className ? `kx-nico ${className}` : "kx-nico"} {...props} />;
}

/** Monochrome type glyph (dummy TYPES): content types and the 7 domain objects. */
const TYPE_ICONS: Record<ItemType, LucideIcon> = {
  note: NotebookPen,
  meeting: Mic,
  article: Globe,
  book: BookOpen,
  video: Play,
  podcast: Podcast,
  ai: Brain,
  recipe: ChefHat,
  person: User,
  project: Rocket,
  organization: Building2,
  concept: Lightbulb,
  tool: Wrench,
  asset: Landmark,
  goal: Target,
};

export function TypeIcon({ type, size = 14 }: { type: ItemType; size?: number }) {
  const Icon = TYPE_ICONS[type] ?? NotebookPen;
  return <Icon aria-hidden size={size} strokeWidth={1.5} className="kx-nico" />;
}
