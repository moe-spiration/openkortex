import type { HTMLAttributes, ReactNode } from "react";
import { Building2, FileText, Landmark, Lightbulb, Rocket, Target, User, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export type ObjectType = "note" | "project" | "person" | "organization" | "concept" | "tool" | "asset" | "goal";

export interface ObjectTypeConfig {
  label: string;
  Icon: LucideIcon;
  /** Icon colour only (V2-11E: type colour is a small accent on the glyph, never a tinted box). */
  className: string;
}

export const OBJECT_TYPES: Record<ObjectType, ObjectTypeConfig> = {
  note: { label: "Note", Icon: FileText, className: "text-muted" },
  project: { label: "Project", Icon: Rocket, className: "text-(--tag-ai-dot)" },
  person: { label: "Person", Icon: User, className: "text-(--tag-auto-dot)" },
  organization: { label: "Organization", Icon: Building2, className: "text-(--tag-auto-dot)" },
  concept: { label: "Concept", Icon: Lightbulb, className: "text-(--tag-strategy-dot)" },
  tool: {
    label: "Tool",
    Icon: Wrench,
    className: "text-checkin",
  },
  asset: { label: "Asset", Icon: Landmark, className: "text-(--tag-food-dot)" },
  goal: { label: "Goal", Icon: Target, className: "text-(--tag-health-dot)" },
};

export interface ObjectBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  type: ObjectType;
  /** Hide the text label (icon only). */
  iconOnly?: boolean;
  /** Overrides the type label (e.g. a content type like "Meeting" on the neutral note badge). */
  label?: ReactNode;
  /** Rendered after the label, e.g. a dropdown chevron. */
  children?: ReactNode;
}

export function ObjectBadge({ type, iconOnly, label: labelOverride, className, children, ...props }: ObjectBadgeProps) {
  const { label: typeLabel, Icon, className: tone } = OBJECT_TYPES[type];
  const label = labelOverride ?? typeLabel;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-pill bg-surface-muted px-2 text-xs font-medium leading-none tracking-normal whitespace-nowrap text-secondary",
        className,
      )}
      title={iconOnly && typeof label === "string" ? label : undefined}
      {...props}
    >
      <Icon className={cn("size-3.5 shrink-0 [stroke-width:var(--icon-stroke)]", tone)} aria-hidden />
      {!iconOnly && label}
      {children}
    </span>
  );
}
