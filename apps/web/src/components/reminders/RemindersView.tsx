"use client";

import { intlLocale, t } from "@/i18n";
import Link from "next/link";
import { Bell, BellRing, Check, ExternalLink, Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pictogram } from "@/components/motion/Pictogram";
import { BarButton, KbdHints, LocationBar } from "@/components/shell/Bars";
import { EmptyState, Page, PageTitle } from "@/components/shell/Page";
import { useLook } from "@/components/theme/look";
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
  if (useLook() === "ruhe") return <RemindersRuhe groups={groups} presets={presets} day={day} setReminder={setReminder} patchWatch={patchWatch} />;

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
      <PageTitle
        icon="bell"
        title={t("Reminders")}
        help={t("Due entries, upcoming reminders and pages Kortex watches for you.")}
        crumbs={[{ label: t("Reminders") }]}
      />

      {total === 0 && (
        <EmptyState title={t("Nothing to remind")} art="stack">
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

/* ---------- Ruhe (2026-11-27, web-scr2): flat sections, actions on hover / focus, J K ↵ E. Styles: ruhe-collections-b.css ---------- */

type Groups = ReturnType<typeof groupReminders<KnowledgeItem>>;
type Store = ReturnType<typeof useNotes>;

function RemindersRuhe({
  groups,
  presets,
  day,
  setReminder,
  patchWatch,
}: {
  groups: Groups;
  presets: ReturnType<typeof snoozePresets>;
  day: string;
  setReminder: Store["setReminder"];
  patchWatch: Store["patchWatch"];
}) {
  const router = useRouter();
  const order = useMemo(() => [...groups.due, ...groups.upcoming, ...groups.watched], [groups]);
  const [cur, setCur] = useState(0);
  const sel = order[Math.min(cur, order.length - 1)];
  const reminder = new Set([...groups.due, ...groups.upcoming].map((i) => i.id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !order.length) return;
      const el = document.activeElement;
      if (el && el.closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown") setCur((c) => Math.min(order.length - 1, c + 1));
      else if (k === "k" || e.key === "ArrowUp") setCur((c) => Math.max(0, c - 1));
      else if (e.key === "Enter" && sel && (!el || el === document.body)) router.push(noteHrefById(sel.id));
      else if (k === "e" && sel) {
        if (reminder.has(sel.id)) setReminder(sel.id, null);
        else patchWatch(sel.id, { enabled: false });
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const row = (i: KnowledgeItem, kind: "due" | "upcoming") => (
    <li key={i.id} className={"rz-rm-row" + (sel?.id === i.id ? " is-cur" : "")} onMouseEnter={() => setCur(order.indexOf(i))}>
      <BellRing aria-hidden size={14} strokeWidth={1.75} className={"rz-rm-ico" + (kind === "due" ? " is-due" : "")} />
      <Link href={noteHrefById(i.id)} className="rz-rm-t">
        {i.title}
      </Link>
      <span className={"rz-rm-m" + (kind === "due" ? " is-due" : "")}>{remindLabel(i.remindAt!, day)}</span>
      <span className="rz-rm-acts">
        {presets.map((p) => (
          <BarButton key={p.key} aria-label={t("Remind {when}: {title}", { when: p.label, title: i.title })} onClick={() => setReminder(i.id, p.iso)}>
            {kind === "due" && p.key === "tonight" ? t("Later") : p.label}
          </BarButton>
        ))}
        <BarButton variant="soft" icon={<Check aria-hidden size={14} strokeWidth={1.75} />} aria-label={t("Done: {title}", { title: i.title })} onClick={() => setReminder(i.id, null)}>
          {t("Done")}
        </BarButton>
      </span>
    </li>
  );

  const watchRow = (i: KnowledgeItem) => {
    const w = i.watch!;
    const unseen = hasUnseenChange(w);
    const meta =
      w.status === WATCH_BLOCKED
        ? w.reason
          ? t("cannot be watched: {reason}", { reason: w.reason })
          : t("cannot be watched")
        : w.last_diff
          ? t("Changed on {when}", { when: fmt(w.last_diff.at) })
          : w.last_checked_at
            ? t("Last checked {when}, no change", { when: fmt(w.last_checked_at) })
            : t("Not checked yet");
    return (
      <li key={i.id} className={"rz-rm-row" + (sel?.id === i.id ? " is-cur" : "")} onMouseEnter={() => setCur(order.indexOf(i))}>
        <Eye aria-hidden size={14} strokeWidth={1.75} className="rz-rm-ico" />
        <Link href={noteHrefById(i.id)} className="rz-rm-t">
          {i.title}
        </Link>
        {unseen && <span className="rz-rm-new">{t("New")}</span>}
        <span className="rz-rm-m">
          {meta} · {WATCH_INTERVAL_LABEL[w.interval]}
        </span>
        <span className="rz-rm-acts">
          {i.source?.url && (
            <a href={i.source.url} target="_blank" rel="noreferrer" className="rz-bbtn rz-bbtn--ghost" aria-label={t("Open page: {title}", { title: i.title })}>
              <ExternalLink aria-hidden size={14} strokeWidth={1.75} />
              {t("Page")}
            </a>
          )}
          {unseen && (
            <BarButton variant="soft" icon={<Check aria-hidden size={14} strokeWidth={1.75} />} onClick={() => patchWatch(i.id, { seen: true })}>
              {t("Seen")}
            </BarButton>
          )}
          <BarButton icon={<EyeOff aria-hidden size={14} strokeWidth={1.75} />} aria-label={t("Stop watching: {title}", { title: i.title })} onClick={() => patchWatch(i.id, { enabled: false })}>
            {t("Stop watching")}
          </BarButton>
        </span>
        {w.last_diff && <p className="rz-rm-diff">{w.last_diff.summary}</p>}
      </li>
    );
  };

  const section = (label: string, list: KnowledgeItem[], render: (i: KnowledgeItem) => ReactNode) =>
    list.length > 0 && (
      <section aria-label={label} className="rz-rm-sec">
        <h2 className="rz-rm-h">
          {label} <span>{list.length}</span>
        </h2>
        <ul className="rz-rm-list">{list.map(render)}</ul>
      </section>
    );

  return (
    <Page maxWidth={820}>
      <LocationBar
        icon={<Bell aria-hidden size={14} strokeWidth={1.75} />}
        crumbs={[{ label: t("Tasks"), href: "/tasks" }, { label: t("Reminders") }]}
        meta={order.length ? t("{due} due · {upcoming} upcoming · {watched} watched", { due: groups.due.length, upcoming: groups.upcoming.length, watched: groups.watched.length }) : undefined}
      />
      {order.length === 0 ? (
        <div className="rz-cb-empty">
          <Pictogram kind="stack" size="lg" />
          <h2>{t("Nothing to remind")}</h2>
          <p>{t("Set a reminder in an entry or turn on “Watch” for a web page. Due items appear here and as a notification.")}</p>
        </div>
      ) : (
        <div className="rz-rm">
          {groups.due.length === 0 && <p className="rz-rm-none">{t("Nothing is due today.")}</p>}
          {section(t("Due"), groups.due, (i) => row(i, "due"))}
          {section(t("Upcoming"), groups.upcoming, (i) => row(i, "upcoming"))}
          {section(t("Watched pages"), groups.watched, watchRow)}
          <KbdHints
            items={[
              { keys: ["J", "K"], label: t("next") },
              { keys: ["↵"], label: t("open") },
              { keys: ["E"], label: t("done") },
            ]}
          />
        </div>
      )}
    </Page>
  );
}
