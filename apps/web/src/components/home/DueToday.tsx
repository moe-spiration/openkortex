"use client";

import { t } from "@/i18n";
import Link from "next/link";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { setActionItemDone } from "@/lib/api/actions";
import { useNotes } from "@/lib/notes/store";
import { remindLabel, snoozePresets } from "@/lib/reminders";
import { useShell } from "@/lib/shell/store";
import { isLiveData, TASKS } from "@/lib/workspace-data";
import { dueToday } from "./due";
import { dueTaskLine } from "./home-utils";

/** The checkbox of a due row (Feinschliff Live `.box`), ticked with the accent ring. */
function Box({ on }: { on: boolean }) {
  return (
    <span className={"hm-cb fs-home-box" + (on ? " is-on" : "")} aria-hidden>
      {on && <Check className="kx-ico" />}
    </span>
  );
}

/**
 * "Heute fällig" (S11; Feinschliff Live `.due-i`): open tasks due today or earlier with a checkbox (done → saved to the
 * action item and its checklist line, optimistic) and "Aufgabe · <Quelle>", plus items whose reminder has come (the
 * checkbox clears the reminder, "Später" snoozes it to tomorrow morning). The title opens the source item. A ticked row
 * stays visible, struck through, until the next visit.
 */
export function DueTodayCard({ day, openNote }: { day: string | null; openNote: (id: string) => void }) {
  const { items, setReminder } = useNotes();
  const { showToast } = useShell();
  const due = useMemo(() => (day ? dueToday(Object.values(items), TASKS, day) : null), [items, day]);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const toggleTask = (id: string) => {
    const next = !done[id];
    setDone((d) => ({ ...d, [id]: next }));
    if (!isLiveData()) return;
    void setActionItemDone(id, next).then((r) => {
      if (r.ok) return;
      setDone((d) => ({ ...d, [id]: !next }));
      showToast(t("Task not saved: {error}", { error: r.error }));
    });
  };
  const tomorrow = day ? snoozePresets(new Date(), day).find((p) => p.key === "tomorrow") : undefined;
  return (
    <section className="hm-bx" aria-label={t("Due today")} aria-busy={!due}>
      <div className="hm-bx-h">
        <h2 className="e-h2">{t("Due today")}</h2>
        <span className="kxh-row" style={{ gap: 4 }}>
          {due && due.reminders.length > 0 && (
            <Link href="/reminders" className="e-link fs-home-lnk" title={t("All reminders and watched pages")}>
              {t("Reminders")}
            </Link>
          )}
          <Link href="/tasks" className="e-link fs-home-lnk">
            {t("All tasks")}
          </Link>
        </span>
      </div>
      {due && due.tasks.length === 0 && due.reminders.length === 0 && (
        <p className="e-meta" style={{ margin: 0, padding: "0 8px" }}>
          {t("Nothing is due today.")}
        </p>
      )}
      <div>
        {due?.tasks.slice(0, 6).map((task) => {
          const on = !!done[task.id];
          return (
            <div key={task.id} className={"fs-home-due" + (on ? " is-done" : "")}>
              <button type="button" role="checkbox" aria-checked={on} aria-label={t("Done: {title}", { title: task.title })} className="fs-home-due-cb" onClick={() => toggleTask(task.id)}>
                <Box on={on} />
              </button>
              <button type="button" className="fs-home-due-t" disabled={!task.sourceId} onClick={() => task.sourceId && openNote(task.sourceId)}>
                <span className="fs-home-due-ttl e-clamp1">{task.title}</span>
                <span className="fs-home-due-s e-clamp1">{dueTaskLine(task, day!)}</span>
              </button>
            </div>
          );
        })}
        {due?.reminders.slice(0, 6).map((i) => (
          <div key={i.id} className="fs-home-due">
            <button type="button" role="checkbox" aria-checked={false} aria-label={t("Done: {title}", { title: i.title })} className="fs-home-due-cb" onClick={() => setReminder(i.id, null)}>
              <Box on={false} />
            </button>
            <button type="button" className="fs-home-due-t" onClick={() => openNote(i.id)}>
              <span className="fs-home-due-ttl e-clamp1">{i.title}</span>
              <span className="fs-home-due-s e-clamp1">{t("Reminder · {when}", { when: remindLabel(i.remindAt!, day!) })}</span>
            </button>
            {tomorrow && (
              <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm fs-home-due-later" aria-label={t("Remind later: {title}", { title: i.title })} onClick={() => setReminder(i.id, tomorrow.iso)}>
                {t("Later")}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
