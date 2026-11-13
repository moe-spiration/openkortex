"use client";

import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface SegmentedTab<T extends string = string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedTabsProps<T extends string = string> {
  tabs: SegmentedTab<T>[];
  value: T;
  onChange?: (value: T) => void;
  size?: "md" | "sm";
  block?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Segmented control: recessed track with a raised thumb (Tactile Craft v2; styles `.kx-tabs` / `.kx-tab` in tactile.css). */
export function SegmentedTabs<T extends string = string>({
  tabs,
  value,
  onChange,
  size = "md",
  block,
  className,
  ...rest
}: SegmentedTabsProps<T>) {
  return (
    <div role="tablist" className={cn("kx-tabs", size === "sm" && "kx-tabs--sm", block && "kx-tabs--block", className)} {...rest}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" className="kx-tab" aria-selected={t.value === value} onClick={() => onChange?.(t.value)}>
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}
