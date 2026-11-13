import type { ReactNode } from "react";
import { Check, Clock, TriangleAlert } from "lucide-react";

export type StatusTone = "ok" | "warn" | "error";

const ICON = { ok: Check, warn: Clock, error: TriangleAlert } as const;

/**
 * A status, not a tag: neutral chip, colour only on the icon (green = done, amber = pending/mock,
 * red = failed; V2-11E "colour only with meaning"). Tag colours are never used for this.
 */
export function StatusChip({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
  const Icon = ICON[tone];
  return (
    <span className={`kx-statechip kx-statechip--${tone} ${className ?? ""}`}>
      <Icon className="size-3.5 shrink-0 [stroke-width:1.8]" aria-hidden />
      {children}
    </span>
  );
}
