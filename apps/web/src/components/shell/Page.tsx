import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/i18n";
import { Ico } from "./icons";

/* Page scaffolding of the workspace views (prototype: padding 26px 32px 170px, kx-h-page, kx-emptystate). */

export function Page({ children, maxWidth = 1160, gap = 22 }: { children: ReactNode; maxWidth?: number; gap?: number }) {
  // Bottom padding keeps the last content clear of the floating footbar (at least --kx-footbar-safe).
  return <div style={{ padding: "26px 32px max(170px, var(--kx-footbar-safe, 100px))", maxWidth, margin: "0 auto", display: "grid", gap }}>{children}</div>;
}

export function PageTitle({
  title,
  help,
  eyebrow,
  crumbs,
  aside,
}: {
  title: ReactNode;
  help?: ReactNode;
  eyebrow?: ReactNode;
  crumbs?: { label: string; href?: string }[];
  aside?: ReactNode;
}) {
  return (
    <div>
      {crumbs && (
        <nav className="kx-crumbs" aria-label={t("Path")}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "contents" }}>
              {i > 0 && <Ico name="chev-r" className="kx-sep" />}
              {c.href ? (
                <Link href={c.href}>{c.label}</Link>
              ) : (
                <span aria-current={i === crumbs.length - 1 ? "page" : undefined} style={{ padding: "0 6px" }}>
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginTop: crumbs ? 6 : 0 }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          {eyebrow && <div className="kx-eyebrow">{eyebrow}</div>}
          <h1 className="kx-h-page" style={{ margin: eyebrow ? "2px 0 0" : 0 }}>
            {title}
          </h1>
          {help && (
            <p className="kx-help" style={{ margin: "4px 0 0" }}>
              {help}
            </p>
          )}
        </div>
        {aside}
      </div>
    </div>
  );
}

/** Prototype empty-state illustration (orbit rings, AI spark, two dots). */
function EmptyArt() {
  return (
    <svg viewBox="0 0 160 110" width={160} height={110} aria-hidden fill="none">
      <circle cx="80" cy="56" r="40" stroke="var(--border-subtle)" strokeWidth="1.5" />
      <circle cx="80" cy="56" r="26" stroke="var(--border-subtle)" strokeWidth="1.5" strokeDasharray="3 5" />
      <path d="M80 34l4.2 11 11 4.2-11 4.2-4.2 11-4.2-11-11-4.2 11-4.2z" fill="var(--accent-ai)" opacity="0.9" />
      <circle cx="118" cy="40" r="4" fill="var(--accent-checkin)" />
      <circle cx="46" cy="78" r="3" fill="var(--tag-auto-dot)" />
    </svg>
  );
}

export function EmptyState({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="kx-emptystate kx-in">
      <EmptyArt />
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
