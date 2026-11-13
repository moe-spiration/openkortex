"use client";

import { t } from "@/i18n";
import Link from "next/link";
import { JOURNAL_DAY_HREF, JOURNAL_WEEK_HREF } from "@/lib/shell/nav";

/*
 * Head of the journal (Feinschliff Live): mono path 10_Notes/Daily, the title "Tagebuch" and the flat Tag/Woche
 * switch. Both tabs edit and show the same daily notes; Woche adds the weekly review below the days.
 */
export function JournalTabs({ tab }: { tab: "day" | "week" }) {
  const tabs = [
    { id: "day", label: t("Day"), href: JOURNAL_DAY_HREF },
    { id: "week", label: t("Week"), href: JOURNAL_WEEK_HREF },
  ] as const;
  return (
    <div className="jr-head">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="jr-path">10_Notes/Daily</div>
        <h1 className="kx-h-page jr-title">{t("Journal")}</h1>
      </div>
      <nav className="kx-tabs jr-seg" aria-label={t("Journal view")}>
        {tabs.map((t) => {
          const on = t.id === tab;
          return (
            <Link key={t.id} href={t.href} className={"kx-tab" + (on ? " is-on" : "")} aria-current={on ? "page" : undefined}>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
