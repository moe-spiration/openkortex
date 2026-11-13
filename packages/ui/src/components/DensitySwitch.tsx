"use client";

import { t } from "@kortex/i18n";
import { Rows2, Rows3, Rows4 } from "lucide-react";
import { cn } from "../lib/cn";

/** Density scale (audit 3.4): komfort 40 / kompakt 36 / dicht 32 px rows. Tokens: tokens.css `[data-density]`. */
export type Density = "komfort" | "kompakt" | "dicht";
export const DENSITIES: readonly Density[] = ["komfort", "kompakt", "dicht"];
/** Labels in the current language (getters, so the exported shape stays a plain record). */
export const DENSITY_LABELS: Record<Density, string> = {
  get komfort() {
    return t("Comfortable");
  },
  get kompakt() {
    return t("Compact");
  },
  get dicht() {
    return t("Dense");
  },
};
export const isDensity = (v: unknown): v is Density => typeof v === "string" && (DENSITIES as readonly string[]).includes(v);

const ICONS = { komfort: Rows2, kompakt: Rows3, dicht: Rows4 } as const;

/** Icon segment for the view heads (dummy `DensitySeg`); `labels` shows the words instead (settings). */
export function DensitySwitch({
  value,
  onChange,
  labels,
  className,
}: {
  value: Density;
  onChange: (d: Density) => void;
  labels?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("tc-seg", labels && "tc-seg--text", className)} role="group" aria-label={t("Density")}>
      {DENSITIES.map((d) => {
        const Icon = ICONS[d];
        return (
          <button
            key={d}
            type="button"
            aria-pressed={value === d}
            aria-label={labels ? undefined : t("Density {level}", { level: DENSITY_LABELS[d] })}
            title={t("Density: {level}", { level: DENSITY_LABELS[d] })}
            onClick={() => onChange(d)}
          >
            {labels ? DENSITY_LABELS[d] : <Icon aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
