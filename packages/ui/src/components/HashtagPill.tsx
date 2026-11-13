import type { HTMLAttributes, ReactNode } from "react";
import { t } from "@kortex/i18n";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

export type TagDomain = "ai" | "auto" | "health" | "food" | "finance" | "strategy";
export const TAG_DOMAINS: TagDomain[] = ["ai", "auto", "health", "food", "finance", "strategy"];

/** V2-11E: the domain colour lives only in the dot; the chip itself is a neutral surface. */
const domainClass: Record<TagDomain, string> = {
  ai: "[--dot:var(--tag-ai-dot)]",
  auto: "[--dot:var(--tag-auto-dot)]",
  health: "[--dot:var(--tag-health-dot)]",
  food: "[--dot:var(--tag-food-dot)]",
  finance: "[--dot:var(--tag-finance-dot)]",
  strategy: "[--dot:var(--tag-strategy-dot)]",
};

/** Maps a hashtag to a semantic colour domain (DESIGN.md section 3). Unknown tags fall back to `ai`. */
export function tagDomain(tag: string): TagDomain {
  const t = tag.replace(/^#/, "").toLowerCase();
  if (/^(automotive|oem|cloud|it)(\/|$)/.test(t)) return "auto";
  if (/^(fitness|health|mobility|jujutsu|hyrox)(\/|$)/.test(t)) return "health";
  if (/^(rezepte|recipes?|food|high-protein|low-carb)(\/|$)/.test(t)) return "food";
  if (/^(finance|real-estate|invest)(\/|$)/.test(t)) return "finance";
  if (/^(strategy|leadership|mba)(\/|$)/.test(t)) return "strategy";
  return "ai";
}

/**
 * chip  = dot + name on a tinted fill (default; where tags are read or edited: detail panel, note properties, sidebar).
 * dot   = only the coloured dot, name in the tooltip (compact contexts: list rows, cards, task rows, timeline).
 * quiet = dot + name, no fill, no border.
 */
export type HashtagPillVariant = "chip" | "dot" | "quiet";

export interface HashtagPillProps extends HTMLAttributes<HTMLSpanElement> {
  /** Tag text, with or without leading #. Domain is derived from it unless `domain` is given. */
  tag?: string;
  domain?: TagDomain;
  size?: "md" | "sm";
  variant?: HashtagPillVariant;
  noDot?: boolean;
  /** Dashed, transparent AI suggestion style. */
  suggest?: boolean;
  onRemove?: () => void;
  children?: ReactNode;
}

export function HashtagPill({ tag, domain, size = "md", variant = "chip", noDot, suggest, onRemove, className, children, ...props }: HashtagPillProps) {
  const d = domain ?? (tag ? tagDomain(tag) : "ai");
  const label = children ?? (tag ? (tag.startsWith("#") ? tag : `#${tag}`) : null);
  if (variant === "dot") {
    return (
      <span
        role="img"
        aria-label={typeof label === "string" ? label : tag}
        title={typeof label === "string" ? label : tag}
        className={cn("inline-block size-2 shrink-0 rounded-full bg-(--dot)", domainClass[d], className)}
        {...props}
      />
    );
  }
  const quiet = variant === "quiet";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill bg-surface-muted font-sans font-medium leading-none tracking-normal whitespace-nowrap text-secondary",
        size === "sm" ? "h-5 gap-[5px] pr-2 pl-1.5 text-[12px]" : "h-6 gap-1.5 pr-2.5 pl-2 text-[12px]",
        domainClass[d],
        quiet && "h-5 bg-transparent px-0",
        suggest && "border border-dashed border-subtle bg-transparent cursor-pointer",
        className,
      )}
      {...props}
    >
      {!noDot && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-(--dot)" />}
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("Remove tag")}
          className="-mr-1 inline-flex cursor-pointer border-0 bg-transparent p-0 text-inherit opacity-60 hover:opacity-100"
        >
          <X className="size-3.5 [stroke-width:var(--icon-stroke)]" />
        </button>
      )}
    </span>
  );
}
