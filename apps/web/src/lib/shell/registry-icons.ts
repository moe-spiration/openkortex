import { AudioLines, Bot, CalendarDays, CirclePlay, FileText, LayoutList, MessageSquareCode, Share2, ShoppingBag, type LucideIcon } from "lucide-react";
import { pageIcon } from "@/lib/notes/page-icons";

/*
 * Lucide component of a type registry icon name (TYPE_REGISTRY[type].icon, kebab case). Reuses the curated page icon
 * set and adds the registry names it lacks, so the bundle stays small; registry-icons.test.ts checks that every
 * registered type resolves, so a new type with a new icon fails there instead of rendering the fallback.
 */

const EXTRA: Record<string, LucideIcon> = {
  "calendar-days": CalendarDays,
  "circle-play": CirclePlay,
  bot: Bot,
  "audio-lines": AudioLines,
  "share-2": Share2,
  "shopping-bag": ShoppingBag,
  "message-square-code": MessageSquareCode,
  "layout-list": LayoutList,
};

/** The registry icon, or null for an unknown name. */
export function registryIconOrNull(name: string): LucideIcon | null {
  return EXTRA[name] ?? pageIcon(name)?.Icon ?? null;
}

/** The registry icon, falling back to the document glyph. */
export const registryIcon = (name: string): LucideIcon => registryIconOrNull(name) ?? FileText;
