"use client";

import { intlLocale, t } from "@/i18n";
import { Bell, Check, Eye } from "lucide-react";
import { useMemo } from "react";
import { todayIso } from "@/lib/date/today";
import { useNotes } from "@/lib/notes/store";
import { hasUnseenChange, isWatchableUrl, WATCH_BLOCKED, WATCH_INTERVAL_LABEL, WATCH_INTERVALS, type WatchInterval } from "@/lib/radar";
import { dateInputValue, dateToRemindIso, isDueOn, remindLabel, snoozePresets } from "@/lib/reminders";
import type { KnowledgeItem } from "@/lib/workspace-data";

/*
 * Erinnerung (snooze) and Beobachten (delta radar) of an item (S11). The reminder is `remind_at`: quick
 * options plus the shared date control; "Erledigt" clears it. For URL items "Beobachten" switches the
 * radar on (cron /api/cron/radar) and shows the last "Änderungen", or why the page is "nicht beobachtbar".
 */

const fmt = (iso: string) => new Date(iso).toLocaleString(intlLocale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function ReminderRadar({ item }: { item: KnowledgeItem }) {
  const { setReminder, patchWatch } = useNotes();
  const day = todayIso();
  const presets = useMemo(() => snoozePresets(new Date(), day), [day]);
  const due = isDueOn(item.remindAt, day);
  const watchable = isWatchableUrl(item.source?.url);
  const w = item.watch;

  return (
    <section className="kx-field" aria-label={t("Reminder and watching")} style={{ display: "grid", gap: 10, margin: "12px 0" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Bell aria-hidden className="kx-ico kx-ico--sm" />
        <span className="e-micro">{t("Reminder")}</span>
        {item.remindAt && (
          <span className={"kx-datechip" + (due ? " is-overdue" : "")}>{remindLabel(item.remindAt, day)}</span>
        )}
        {presets.map((p) => (
          <button key={p.key} type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => setReminder(item.id, p.iso)}>
            {p.label}
          </button>
        ))}
        <span className="kx-control kx-control--sm" style={{ width: 150 }}>
          <input
            type="date"
            aria-label={t("Reminder on")}
            min={day}
            value={dateInputValue(item.remindAt)}
            onChange={(e) => {
              const iso = dateToRemindIso(e.target.value);
              if (iso) setReminder(item.id, iso);
            }}
          />
        </span>
        {item.remindAt && (
          <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={() => setReminder(item.id, null)}>
            <Check aria-hidden className="kx-ico kx-ico--sm" />
            {t("Done")}
          </button>
        )}
      </div>

      {(watchable || w?.enabled) && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <Eye aria-hidden className="kx-ico kx-ico--sm" />
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" className="kx-check" checked={!!w?.enabled} onChange={(e) => patchWatch(item.id, { enabled: e.target.checked })} />
              <span className="e-micro">{t("Watch")}</span>
            </label>
            {w?.enabled && (
              <span className="kx-control kx-control--sm" style={{ width: 130 }}>
                <select aria-label={t("Check interval")} value={w.interval} onChange={(e) => patchWatch(item.id, { interval: e.target.value as WatchInterval })}>
                  {WATCH_INTERVALS.map((i) => (
                    <option key={i} value={i}>
                      {WATCH_INTERVAL_LABEL[i]}
                    </option>
                  ))}
                </select>
              </span>
            )}
            {w?.enabled && w.status !== WATCH_BLOCKED && (
              <span className="e-meta">{w.last_checked_at ? t("Last checked {when}", { when: fmt(w.last_checked_at) }) : t("Will be checked on the next run")}</span>
            )}
          </div>
          {w?.enabled && w.status === WATCH_BLOCKED && (
            <p className="e-meta" role="status" style={{ margin: 0, color: "var(--status-urgent-text)" }}>
              {t("Cannot be watched: {reason}", { reason: w.reason ?? t("Page not reachable") })}
            </p>
          )}
          {w?.last_diff && (
            <div role="region" aria-label={t("Changes")} style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 className="e-h2" style={{ margin: 0 }}>
                  {t("Changes")}
                </h2>
                {hasUnseenChange(w) && <span className="kx-datechip is-today">{t("new")}</span>}
                <span className="e-meta">{fmt(w.last_diff.at)}</span>
                {hasUnseenChange(w) && (
                  <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={() => patchWatch(item.id, { seen: true })}>
                    {t("Seen")}
                  </button>
                )}
              </div>
              <p style={{ margin: 0 }}>{w.last_diff.summary}</p>
              {(w.last_diff.added.length > 0 || w.last_diff.removed.length > 0) && (
                <details>
                  <summary className="e-meta" style={{ cursor: "pointer" }}>
                    {t("Show lines")}
                  </summary>
                  <ul className="e-meta" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {w.last_diff.added.map((l, i) => (
                      <li key={`a${i}`}>+ {l}</li>
                    ))}
                    {w.last_diff.removed.map((l, i) => (
                      <li key={`r${i}`}>− {l}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
