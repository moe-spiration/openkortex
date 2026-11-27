"use client";

import { t } from "@/i18n";
import Link from "next/link";
import { JOURNAL_DAY_HREF, JOURNAL_WEEK_HREF } from "@/lib/shell/nav";
import { Ico } from "@/components/shell/icons";
import { useLook } from "@/components/theme/look";
import { CalendarDays, NotebookPen } from "lucide-react";
import { LocationBar, ViewBar } from "@/components/shell/Bars";

/*
 * Head of the journal (Feinschliff Live): mono path 10_Notes/Daily, the title "Tagebuch" and the flat Tag/Woche
 * switch. Both tabs edit and show the same daily notes; Woche adds the weekly review below the days.
 */
export function JournalTabs({ tab }: { tab: "day" | "week" }) {
  const tabs = [
    { id: "day", label: t("Day"), href: JOURNAL_DAY_HREF },
    { id: "week", label: t("Week"), href: JOURNAL_WEEK_HREF },
  ] as const;
  if (useLook() === "ruhe")
    return (
      <>
        <LocationBar
          icon={<NotebookPen aria-hidden size={14} strokeWidth={1.75} />}
          crumbs={[{ label: t("Journal"), href: JOURNAL_DAY_HREF }, { label: tab === "week" ? t("Weekly review") : t("Day") }]}
        />
        <ViewBar label={t("Journal view")}>
          <nav className="rz-viewbar-tabs" aria-label={t("Journal view")}>
            {tabs.map((x) => (
              <Link key={x.id} href={x.href} className="rz-vt" aria-current={x.id === tab ? "page" : undefined}>
                {x.id === "week" ? <CalendarDays aria-hidden size={13} strokeWidth={1.75} /> : <NotebookPen aria-hidden size={13} strokeWidth={1.75} />}
                <span className="rz-vt-l">{x.label}</span>
              </Link>
            ))}
          </nav>
        </ViewBar>
      </>
    );
  return (
    <div className="jr-head kx-pagetitle">
      <span className="kx-pagetitle-ico" aria-hidden>
        <Ico name="sun" />
      </span>
      <div className="kx-pagetitle-text" style={{ minWidth: 0, flex: 1 }}>
        <div className="jr-path kx-eyebrow">10_Notes/Daily</div>
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
