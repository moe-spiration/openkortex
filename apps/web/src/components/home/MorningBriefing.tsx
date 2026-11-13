"use client";

import { intlLocale, t, tn } from "@/i18n";
import { useState } from "react";
import { ChevronDown, Hash, Inbox, Sparkles, SquareCheckBig } from "lucide-react";
import type { BriefingView } from "@/lib/data/home";
import type { BriefingItem } from "@/lib/mock/home";
import { HIco } from "./icons";

const dueLabel = (due: string, today: string | null) => {
  if (today && due <= today) return due === today ? t("due today") : t("overdue");
  const date = new Date(`${due.slice(0, 10)}T12:00:00Z`).toLocaleDateString(intlLocale(), { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  return t("due {date}", { date });
};

/**
 * Briefing as a glass card (Tactile Craft v2, dummy `.brief`): the day's AI sentence with action chips
 * ("Inbox triagieren", the most active hashtag) and, unfolded, the action items with their checkboxes.
 */
export function MorningBriefing({
  briefing,
  done,
  today,
  tag,
  onToggle,
  onOpenNote,
  onInbox,
  onTag,
  inboxCount = 0,
}: {
  /** Entries waiting in the Inbox (the sidebar badge value); shown on the "Inbox triagieren" chip. */
  inboxCount?: number;
  /** Null while today's briefing loads for the first time. */
  briefing: BriefingView | null;
  done: Record<string, boolean>;
  today: string | null;
  /** Hashtag of the action chip (the first Smart Mix), e.g. "#ai/llm"; null hides the chip. */
  tag: string | null;
  onToggle: (item: BriefingItem) => void;
  onOpenNote: (id: string) => void;
  onInbox: () => void;
  onTag: (tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const items = briefing?.items ?? [];
  const canOpen = items.length > 0 || !!briefing?.noteId;
  // Open action items (the ones not ticked yet), as in the prototype chip "2 Action Items".
  const openCount = items.filter((b) => !done[b.key]).length;
  const tagLabel = tag?.replace(/^#/, "") ?? null;
  return (
    <section className="hm-brief" aria-label="Morning Briefing" aria-busy={!briefing?.summary}>
      <span className="tc-glyph" aria-hidden>
        <Sparkles className="kx-ico" />
      </span>
      <div className="hm-brief-body">
        <p>
          <b>{briefing?.title ?? "Morning Briefing"}</b>{" "}
          {briefing?.summary ?? <span style={{ color: "var(--t3)" }}>{t("Being written for today…")}</span>}
        </p>
        {/* Feinschliff Live `.chips`: the action chips on their own row below the sentence, with real counts. */}
        <div className="hm-brief-chips fs-home-chips">
          <button type="button" className="e-chip" onClick={onInbox} aria-label={t("Triage Inbox")}>
            <Inbox className="kx-ico" aria-hidden />
            {t("Triage Inbox")}
            {inboxCount > 0 && <span className="e-num fs-home-chip-n">{inboxCount}</span>}
          </button>
          {tag && tagLabel && (
            <button type="button" className="e-chip" onClick={() => onTag(tag)} aria-label={t("Open hashtag {tag}", { tag: tagLabel })}>
              <Hash className="kx-ico" aria-hidden />
              {tagLabel}
            </button>
          )}
          {canOpen && (
            <button type="button" className="e-chip" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <SquareCheckBig className="kx-ico" aria-hidden />
              {open ? t("Less") : openCount ? tn(openCount, "{n} action item", "{n} action items") : t("Action items")}
              <ChevronDown className="kx-ico" aria-hidden style={open ? { transform: "rotate(180deg)" } : undefined} />
            </button>
          )}
        </div>
        {open && canOpen && briefing && (
          <div className="hm-brief-items kx-in">
            {items.map((b) => {
              const d = !!done[b.key];
              return (
                <label key={b.key} className={"kx-ed-todo" + (d ? " is-done" : "")} style={{ cursor: "pointer", fontSize: "calc(13px * var(--kx-fs, 1))", alignItems: "center", minHeight: 34 }}>
                  <input type="checkbox" className="kx-check" style={{ marginTop: 0 }} checked={d} onChange={() => onToggle(b)} aria-label={b.text} />
                  <span>
                    {b.text}{" "}
                    {b.ts ? (
                      <span className="e-num" style={{ color: "var(--t3)", fontSize: "calc(12px * var(--kx-fs, 1))" }}>
                        [{b.ts}]
                      </span>
                    ) : b.due ? (
                      <span className="e-meta">{dueLabel(b.due, today)}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
            {briefing.noteId && (
              <div>
                <button type="button" className="e-btn" onClick={() => onOpenNote(briefing.noteId!)}>
                  {briefing.noteLabel}
                  <HIco name="up-right" sm />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
