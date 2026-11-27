"use client";

import { getLocale, intlLocale, t } from "@/i18n";
import { Check, Mail, MessageSquare, NotebookPen, Sparkles } from "lucide-react";
import { memo, useMemo, useState, type ReactNode } from "react";
import type { DomainObjectType } from "@kortex/db/domain";
import { dossierTimeline, ownNotesOf, parseDossier, removeOpenPoint, setOwnNotes } from "@/lib/dossier";
import type { BacklinkGroups } from "@/lib/notes/backlinks";
import { initialsOf, whenLine } from "@/lib/notes/facts";
import { useNotes } from "@/lib/notes/store";
import { useCopilotChat } from "@/lib/shell/copilot-chat";
import { COMMAND_SKILL, ORBIT_COMMANDS, type CommandId } from "@/lib/shell/orbit";
import { useShell } from "@/lib/shell/store";
import { createActionItem } from "@/lib/api/actions";
import { dayLabel } from "@/lib/format";
import { MOCK_TODAY, NOTE_TYPES, isLiveData, type KnowledgeItem } from "@/lib/workspace-data";
import { objectOptionLabel } from "@/lib/objects/schema";
import { TypeIcon } from "./icons";
import { MarkdownStatic } from "./MarkdownStatic";
import { PropertyTable } from "./PropertyPills";

/*
 * Akte (living dossier) of a person, organization or project in the Ruhe look (artifact "Kortex Ruhe-Iteration",
 * screen 06; gap web-b W2). Built anew instead of the note page with cover and pills:
 *
 *   main   avatar + name + one line (role · company · place), "Stand der Dinge" (accent surface, kept by the agent),
 *          "Offene Punkte" (tick = done and off the list, "Übernehmen" = a task), "Verlauf" (timeline of the linked
 *          meetings and mentions), "Eigene Notizen" (never written by the agent, edited in place)
 *   aside  properties as a key/value table, "Verknüpft", "Vor dem nächsten Gespräch" (briefing, mail), the vault path
 *
 * The data is the note's Markdown (lib/dossier.ts) plus its metadata; nothing new is stored. NoteSheet switches to
 * it under <html data-look="ruhe"> for the dossier types; Vivid keeps the note page. Styles: ruhe-akte.css.
 */

const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(intlLocale(), { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** One line under the name: role · company for a person, kind · industry for a company, status · target for a project. */
function subtitleOf(item: KnowledgeItem): string {
  const m = item.metadata;
  const s = (k: string) => (typeof m[k] === "string" && m[k] ? (m[k] as string) : "");
  const parts =
    item.type === "person"
      ? [s("role") && s("organization") ? t("{role} at {organization}", { role: s("role"), organization: s("organization") }) : s("role") || s("organization"), s("location")]
      : item.type === "organization"
        ? [s("org_type") && objectOptionLabel(s("org_type")), s("industry"), s("location")]
        : [s("project_status") && objectOptionLabel(s("project_status")), s("target_date") && t("until {date}", { date: shortDate(s("target_date")) })];
  return parts.filter(Boolean).join(" · ");
}

/** Normalized text for matching an open point with a task. */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

interface Props {
  item: KnowledgeItem;
  /** The live Markdown (deferred). */
  md: string;
  groups: BacklinkGroups;
  objects: KnowledgeItem[];
  full: boolean;
  onTitle: (title: string) => void;
}

export const ObjectDossier = memo(function ObjectDossier({ item, md, groups, objects, full, onTitle }: Props) {
  const { setContent } = useNotes();
  const { openNote, showToast } = useShell();
  const chat = useCopilotChat();
  const dossier = useMemo(() => parseDossier(md), [md]);
  const timeline = useMemo(() => dossierTimeline(groups.meetings, groups.mentions, 8), [groups]);
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set());

  const run = (id: CommandId) => {
    const skill = COMMAND_SKILL[id];
    const cmd = ORBIT_COMMANDS.find((c) => c.id === id)?.cmd;
    if (!skill || !cmd) return;
    if (!chat.live) return showToast(t("The agent needs an account (not available in mock mode)"));
    chat.send(`${cmd} ${item.title}`, { skill });
  };

  // Tasks that already came out of this dossier (action items of the entry, or taken over in this session).
  const tasks = new Set([...item.actionItems.filter((a) => !a.done).map((a) => norm(a.text)), ...taken]);

  const tick = (point: string) => {
    const before = md;
    setContent(item.id, removeOpenPoint(md, point));
    showToast(t("“{title}” done", { title: point }), { label: t("Undo"), run: () => setContent(item.id, before) });
  };
  const takeOver = (point: string) => {
    setTaken((s) => new Set(s).add(norm(point)));
    const done = () => showToast(t("Task created: {title}", { title: point.slice(0, 60) }));
    if (!isLiveData()) return done();
    void createActionItem({ title: point, sourceItemId: item.id, context: item.title }).then((r) => {
      if (r.ok) return done();
      setTaken((s) => {
        const next = new Set(s);
        next.delete(norm(point));
        return next;
      });
      showToast(t("Task not created: {error}", { error: r.error }));
    });
  };

  const meeting = groups.meetings[0];
  const extra =
    item.type === "person" && meeting
      ? [{ key: "last", label: t("Last contact"), value: dayLabel(meeting.date, MOCK_TODAY), onClick: () => openNote(meeting.id) }]
      : [];
  const linked = [...new Map([...objects, ...groups.meetings.slice(0, 2)].map((o) => [o.id, o] as const)).values()].slice(0, 6);
  const updated = whenLine(item.date, item.time, MOCK_TODAY);

  return (
    <div className={"rz-akte" + (full ? " is-full" : "")} data-type={item.type}>
      <div className="rz-akte-main">
        <header className="rz-akte-head">
          <span className={"rz-akte-av" + (item.type === "person" ? "" : " is-sq")} aria-hidden>
            {item.type === "person" ? initialsOf(item.title) : <TypeIcon type={item.type} size={18} />}
          </span>
          <div className="rz-akte-name">
            <h1 className="rz-akte-title" data-testid="note-title">
              <span
                key={`${item.id}:${item.title}`}
                role="textbox"
                aria-label={t("Title")}
                contentEditable="plaintext-only"
                suppressContentEditableWarning
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    e.currentTarget.textContent = item.title;
                    e.currentTarget.blur();
                  }
                }}
                onBlur={(e) => {
                  const next = (e.currentTarget.textContent ?? "").replace(/\s+/g, " ").trim();
                  if (!next) e.currentTarget.textContent = item.title;
                  else if (next !== item.title) onTitle(next);
                }}
              >
                {item.title}
              </span>
            </h1>
            <div className="rz-akte-sub">{subtitleOf(item) || NOTE_TYPES[item.type]?.label}</div>
          </div>
        </header>

        <section className="rz-akte-state" aria-label={t("Where things stand")}>
          <div className="rz-akte-state-h">
            <Sparkles aria-hidden size={13} strokeWidth={1.75} />
            <span>{t("Where things stand")}</span>
            <span className="rz-grow" />
            {dossier.state && <span className="rz-akte-state-m">{t("maintained {when}", { when: updated })}</span>}
            <button type="button" className="rz-akte-state-btn" onClick={() => run("akte")} title={t("Update dossier")}>
              <NotebookPen aria-hidden size={13} strokeWidth={1.75} />
              <span>{dossier.state ? t("Update") : t("Update dossier")}</span>
            </button>
          </div>
          {dossier.state ? (
            <div className="rz-akte-state-t">
              <MarkdownStatic markdown={dossier.state} />
            </div>
          ) : (
            <p className="rz-akte-state-t is-empty">
              {t("No status yet. The agent reads the linked meetings and notes and writes where things stand and what is open. Your own notes are never overwritten.")}
            </p>
          )}
        </section>

        <Section title={t("Open points")} count={dossier.open.length}>
          {dossier.open.length ? (
            <ul className="rz-akte-open">
              {dossier.open.map((p) => {
                const isTask = tasks.has(norm(p));
                return (
                  <li key={p}>
                    <button type="button" role="checkbox" aria-checked={false} className="rz-chk" aria-label={t("Mark “{title}” done", { title: p })} onClick={() => tick(p)}>
                      <Check aria-hidden size={11} strokeWidth={3} />
                    </button>
                    <span className="rz-akte-open-t">{p}</span>
                    <span className="rz-akte-open-r">
                      {isTask ? (
                        <span className="rz-dotlabel">
                          <i className="is-ok" aria-hidden />
                          {t("in Tasks")}
                        </span>
                      ) : (
                        <>
                          <span className="rz-akte-hint">{t("Suggestion")}</span>
                          <button type="button" className="rz-btn rz-btn--soft" onClick={() => takeOver(p)}>
                            {t("Accept")}
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rz-akte-none">{t("Nothing open. The agent adds points from new meetings.")}</p>
          )}
        </Section>

        {timeline.length > 0 && (
          <Section title={t("History")}>
            <ol className="rz-tl">
              {timeline.map((e) => (
                <li key={e.id}>
                  <span className="rz-tl-d">{shortDate(e.date)}</span>
                  <span className="rz-tl-b" aria-hidden />
                  <button type="button" className="rz-tl-c" onClick={() => openNote(e.id)} title={e.path}>
                    <span className="rz-tl-t">{e.title}</span>
                    <span className="rz-tl-s">{[NOTE_TYPES[e.type]?.label, e.tldr].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ol>
          </Section>
        )}

        <OwnNotes item={item} md={md} onSave={(next) => setContent(item.id, next)} />
      </div>

      <aside className="rz-akte-aside">
        <div className="rz-akte-block">
          <div className="rz-lab">{t("Properties")}</div>
          <PropertyTable item={item} type={item.type as DomainObjectType} extra={extra} />
        </div>
        {linked.length > 0 && (
          <div className="rz-akte-block">
            <div className="rz-lab">
              {t("Linked")} <span className="rz-lab-c">{linked.length}</span>
            </div>
            {linked.map((o) => (
              <button key={o.id} type="button" className="rz-akte-link" onClick={() => openNote(o.id)} title={o.path}>
                <TypeIcon type={o.type} size={14} />
                <span>{o.title}</span>
              </button>
            ))}
          </div>
        )}
        <div className="rz-akte-block">
          <div className="rz-lab">{item.type === "person" ? t("Before the next conversation") : t("Before the next step")}</div>
          <p className="rz-akte-help">{t("The agent builds you a briefing from the dossier, meetings and open points.")}</p>
          <div className="rz-akte-acts">
            <button type="button" className="rz-btn rz-btn--acc" onClick={() => run("briefing")}>
              <Sparkles aria-hidden size={13} strokeWidth={1.75} />
              {t("Create briefing")}
            </button>
            <button type="button" className="rz-btn rz-btn--soft" onClick={() => run("entwurf")} title={t("Draft a mail")}>
              {item.type === "person" ? <MessageSquare aria-hidden size={13} strokeWidth={1.75} /> : <Mail aria-hidden size={13} strokeWidth={1.75} />}
              {t("Mail")}
            </button>
          </div>
        </div>
        <div className="rz-akte-path" title={item.path}>
          {item.path}
        </div>
      </aside>
    </div>
  );
});

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="rz-akte-sec">
      <h2 className="rz-akte-h2">
        {title}
        {count !== undefined && <span className="rz-lab-c">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

/** "Eigene Notizen": shown as text, edited in place; only this part of the note is written. */
function OwnNotes({ item, md, onSave }: { item: KnowledgeItem; md: string; onSave: (md: string) => void }) {
  const own = useMemo(() => ownNotesOf(md), [md]);
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    if (draft !== null && draft.trim() !== own.text.trim()) onSave(setOwnNotes(md, draft, getLocale()));
    setDraft(null);
  };
  return (
    <section className="rz-akte-sec">
      <h2 className="rz-akte-h2">
        {t("My notes")}
        <span className="rz-akte-h2-m">{t("never overwritten")}</span>
        <span className="rz-grow" />
        {draft === null && (
          <button type="button" className="rz-akte-edit" onClick={() => setDraft(own.text)}>
            {t("Edit")}
          </button>
        )}
      </h2>
      {draft !== null ? (
        <div className="rz-akte-own-ed">
          <textarea
            className="rz-akte-own-in"
            autoFocus
            value={draft}
            aria-label={t("My notes")}
            placeholder={t("What only you know: how {name} likes to work, what matters …", { name: item.title })}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDraft(null);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
            }}
          />
          <div className="rz-akte-acts">
            <button type="button" className="rz-btn rz-btn--acc" onClick={save}>
              {t("Save")}
            </button>
            <button type="button" className="rz-btn rz-btn--ghost" onClick={() => setDraft(null)}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      ) : own.text ? (
        <div className="rz-akte-own" onDoubleClick={() => setDraft(own.text)}>
          <MarkdownStatic markdown={own.text} />
        </div>
      ) : (
        <button type="button" className="rz-akte-none is-btn" onClick={() => setDraft("")}>
          {t("Add what only you know. The agent never writes here.")}
        </button>
      )}
    </section>
  );
}
