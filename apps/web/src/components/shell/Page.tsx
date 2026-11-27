import type { ReactNode } from "react";
import { t } from "@/i18n";
import { Pictogram, type PictogramKind } from "@/components/motion/Pictogram";

/* Page scaffolding of the workspace views (prototype: padding 26px 32px 170px, kx-h-page, kx-emptystate). */

export function Page({ children, maxWidth = 1160, gap = 22 }: { children: ReactNode; maxWidth?: number; gap?: number }) {
  // Bottom padding keeps the last content clear of the floating footbar (at least --kx-footbar-safe).
  return (
    <div
      className="kx-page"
      style={{
        padding: "26px 32px max(170px, var(--kx-footbar-safe, 100px))",
        maxWidth,
        margin: "0 auto",
        display: "grid",
        gap,
      }}
    >
      {children}
    </div>
  );
}

/** Page head: Ruhe location bar or the classic head (see ./Bars). */
export { PageTitle } from "./Bars";

/** Prototype empty-state illustration (orbit rings, AI spark, two dots). */
function EmptyArt() {
  return (
    <svg viewBox="0 0 160 110" width={160} height={110} aria-hidden fill="none" className="kx-art-classic">
      <circle cx="80" cy="56" r="40" stroke="var(--border-subtle)" strokeWidth="1.5" />
      <circle cx="80" cy="56" r="26" stroke="var(--border-subtle)" strokeWidth="1.5" strokeDasharray="3 5" />
      <path d="M80 34l4.2 11 11 4.2-11 4.2-4.2 11-4.2-11-11-4.2 11-4.2z" fill="var(--accent-ai)" opacity="0.9" />
      <circle cx="118" cy="40" r="4" fill="var(--accent-checkin)" />
      <circle cx="46" cy="78" r="3" fill="var(--tag-auto-dot)" />
    </svg>
  );
}

/** Empty view. `art` picks the animated pictogram the Ruhe look shows instead of the classic illustration. */
export function EmptyState({ title, children, actions, art = "inbox" }: { title: string; children: ReactNode; actions?: ReactNode; art?: PictogramKind }) {
  return (
    <div className="kx-emptystate kx-in">
      <EmptyArt />
      <Pictogram kind={art} size="lg" className="kx-art-ruhe" />
      <strong className="kx-h-section">
        {title}
      </strong>
      <span className="kx-help" style={{ fontSize: "calc(13px * var(--kx-fs, 1))", lineHeight: 1.4, maxWidth: 420 }}>
        {children}
      </span>
      {actions && (
        <div className="kxh-row" style={{ gap: 8 }}>
          {actions}
        </div>
      )}
    </div>
  );
}

/** Placeholder for a view whose full UI lands in a later Etappe. */
export function ViewPlaceholder({ what }: { what: string }) {
  return (
    <EmptyState title={t("Coming in the next stage")}>
      {t("{what} is being built here. Navigation, tabs, footbar and copilot already work.", { what })}
    </EmptyState>
  );
}

export { dayLabel } from "@/lib/format";
export { NoteList } from "./NoteList";
