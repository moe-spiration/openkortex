"use client";

import { intlLocale, t } from "@/i18n";
import Link from "next/link";
import { Bell, BellRing, Check, ExternalLink, Eye, EyeOff } from "lucide-react";
import { useMemo } from "react";
import { EmptyState, Page, PageTitle } from "@/components/shell/Page";
import { todayIso } from "@/lib/date/today";
import { useNotes } from "@/lib/notes/store";
import { hasUnseenChange, WATCH_BLOCKED, WATCH_INTERVAL_LABEL } from "@/lib/radar";
import { remindLabel, snoozePresets } from "@/lib/reminders";
import { noteHrefById } from "@/lib/shell/routes";
import type { KnowledgeItem } from "@/lib/workspace-data";
import { groupReminders } from "./groups";

/*
 * Erinnerungen: everything that wants attention in one place. "Fällig" (reminders at or before today),
 * "Demnächst" (later reminders) and "Beobachtete Seiten" (delta radar, server/radar) with the last change.
 * Actions mirror the note sheet: Snooze (Später / Morgen / Nächste Woche), Erledigt (clears the reminder),
 * Beobachten aus. Everything goes through the notes store, so it is optimistic and persisted like elsewhere.
 */

const fmt = (iso: string) => new Date(iso).toLocaleString(intlLocale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Title({ item, meta }: { item: KnowledgeItem; meta: string }) {
  return (
    <span style={{ minWidth: 0, flex: 1 }}>
      <Link href={noteHrefById(item.id)} className="hm-cont-t e-clamp1" style={{ display: "block" }}>
        {item.title}
      </Link>
      <span className="e-meta e-clamp1" style={{ display: "block" }}>
        {meta}
      </span>
    </span>
  );
}

export function RemindersView() {
  const { items, setReminder, patchWatch } = useNotes();
  const day = todayIso();
  const groups = useMemo(() => groupReminders(Object.values(items), day), [items, day]);
  const presets = useMemo(() => snoozePresets(new Date(), day), [day]);
  const total = groups.due.length + groups.upcoming.length + groups.watched.length;

  const reminderRow = (i: KnowledgeItem, overdue: boolean) => (
    <li key={i.id} className="kxh-row" style={{ gap: 8, padding: "6px 0", flexWrap: "wrap" }}>
      <BellRing aria-hidden className="kx-ico kx-ico--sm" style={{ flex: "none" }} />
      <Title item={i} meta={remindLabel(i.remindAt!, day)} />
      <span className="kxh-row" style={{ gap: 6, flex: "none", flexWrap: "wrap" }}>
        {presets.map((p) => (
          <button key={p.key} type="button" className="kx-btn kx-btn--ghost kx-btn--sm" aria-label={t("Remind {when}: {title}", { when: p.label, title: i.title })} onClick={() => setReminder(i.id, p.iso)}>
            {overdue && p.key === "tonight" ? t("Later") : p.label}
          </button>
        ))}
        <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" aria-label={t("Done: {title}", { title: i.title })} onClick={() => setReminder(i.id, null)}>
          <Check aria-hidden className="kx-ico kx-ico--sm" />
          {t("Done")}
        </button>
      </span>
    </li>
  );

  return (
    <Page maxWidth={860}>
      <PageTitle title={t("Reminders")} help={t("Due entries, upcoming reminders and pages Kortex watches for you.")} crumbs={[{ label: t("Reminders") }]} />

      {total === 0 && (
        <EmptyState title={t("Nothing to remind")}>
          {t("Set a reminder in an entry or turn on “Watch” for a web page. Due items appear here and as a notification.")}
        </EmptyState>
      )}

      {groups.due.length > 0 && (
        <section aria-label={t("Due")} className="hm-bx">
          <div className="hm-bx-h">
            <h2 className="e-h2">{t("Due")}</h2>
            <span className="e-meta">{groups.due.length}</span>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{groups.due.map((i) => reminderRow(i, true))}</ul>
        </section>
      )}

      {groups.upcoming.length > 0 && (
        <section aria-label={t("Upcoming")} className="hm-bx">
          <div className="hm-bx-h">
            <h2 className="e-h2">{t("Upcoming")}</h2>
            <span className="e-meta">{groups.upcoming.length}</span>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{groups.upcoming.map((i) => reminderRow(i, false))}</ul>
        </section>
      )}

      {groups.watched.length > 0 && (
        <section aria-label={t("Watched pages")} className="hm-bx">
          <div className="hm-bx-h">
            <h2 className="e-h2">{t("Watched pages")}</h2>
            <span className="e-meta">{groups.watched.length}</span>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {groups.watched.map((i) => {
              const w = i.watch!;
              const unseen = hasUnseenChange(w);
              const blocked = w.status === WATCH_BLOCKED;
              const meta = blocked
                ? w.reason
                  ? t("cannot be watched: {reason}", { reason: w.reason })
                  : t("cannot be watched")
                : w.last_diff
                  ? t("Changed on {when}", { when: fmt(w.last_diff.at) })
                  : w.last_checked_at
                    ? t("Last checked {when}, no change", { when: fmt(w.last_checked_at) })
                    : t("Not checked yet");
              return (
                <li key={i.id} style={{ padding: "6px 0", display: "grid", gap: 4 }}>
                  <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <Eye aria-hidden className="kx-ico kx-ico--sm" style={{ flex: "none" }} />
                    <Title item={i} meta={`${meta} · ${WATCH_INTERVAL_LABEL[w.interval]}`} />
                    {unseen && (
                      <span className="kx-pill kx-pill--ai" style={{ flex: "none" }}>
                        {t("New")}
                      </span>
                    )}
                    <span className="kxh-row" style={{ gap: 6, flex: "none", flexWrap: "wrap" }}>
                      {i.source?.url && (
                        <a href={i.source.url} target="_blank" rel="noreferrer" className="kx-btn kx-btn--ghost kx-btn--sm" aria-label={t("Open page: {title}", { title: i.title })}>
                          <ExternalLink aria-hidden className="kx-ico kx-ico--sm" />
                          {t("Page")}
                        </a>
                      )}
                      {unseen && (
                        <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => patchWatch(i.id, { seen: true })}>
                          <Check aria-hidden className="kx-ico kx-ico--sm" />
                          {t("Seen")}
                        </button>
                      )}
                      <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" aria-label={t("Stop watching: {title}", { title: i.title })} onClick={() => patchWatch(i.id, { enabled: false })}>
                        <EyeOff aria-hidden className="kx-ico kx-ico--sm" />
                        {t("Stop watching")}
                      </button>
                    </span>
                  </div>
                  {w.last_diff && (
                    <p className="e-meta" style={{ margin: "0 0 0 24px" }}>
                      {w.last_diff.summary}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {total > 0 && groups.due.length === 0 && (
        <p className="e-meta" style={{ margin: 0 }}>
          <Bell aria-hidden className="kx-ico kx-ico--sm" style={{ verticalAlign: "-2px", marginRight: 6 }} />
          {t("Nothing is due today.")}
        </p>
      )}
    </Page>
  );
}
