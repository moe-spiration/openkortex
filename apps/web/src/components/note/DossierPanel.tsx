"use client";

import { intlLocale, t, tn } from "@/i18n";
import { Mail, NotebookPen, Sparkles } from "lucide-react";
import { memo, useMemo } from "react";
import { dossierTimeline, parseDossier } from "@/lib/dossier";
import type { BacklinkGroups } from "@/lib/notes/backlinks";
import { useCopilotChat } from "@/lib/shell/copilot-chat";
import { COMMAND_SKILL, ORBIT_COMMANDS, type CommandId } from "@/lib/shell/orbit";
import { useShell } from "@/lib/shell/store";
import { TypeIcon } from "./icons";

const shortDay = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString(intlLocale(), { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Living dossier (Lebende Akte) on the entry of a person, company or project: what the agent can do with it
 * (bring it up to date, briefing, mail draft) and its history from the linked meetings and mentions. The
 * dossier itself is the note's Markdown: the agent writes the sections "Stand der Dinge" and "Offene Punkte"
 * (lib/dossier.ts), the user's own notes are never overwritten.
 */
export const DossierPanel = memo(function DossierPanel({ title, md, groups }: { title: string; md: string; groups: BacklinkGroups }) {
  const chat = useCopilotChat();
  const { openNote, showToast } = useShell();
  const dossier = useMemo(() => parseDossier(md), [md]);
  const timeline = useMemo(() => dossierTimeline(groups.meetings, groups.mentions), [groups]);
  const total = groups.meetings.length + groups.mentions.length;
  const last = groups.meetings[0]?.date;

  const run = (id: CommandId) => {
    const skill = COMMAND_SKILL[id];
    const cmd = ORBIT_COMMANDS.find((c) => c.id === id)?.cmd;
    if (!skill || !cmd) return;
    if (!chat.live) {
      showToast(t("The agent needs an account (not available in mock mode)"));
      return;
    }
    chat.send(`${cmd} ${title}`, { skill });
  };

  const meta = [
    groups.meetings.length ? tn(groups.meetings.length, "{n} meeting", "{n} meetings") : null,
    last ? t("last contact {date}", { date: shortDay(last) }) : null,
    dossier.open.length ? tn(dossier.open.length, "{n} open point", "{n} open points") : null,
  ].filter(Boolean);

  return (
    <section className="fs-dos" aria-label={t("Dossier")}>
      <div className="fs-dos-h">
        <Sparkles aria-hidden className="kx-ico kx-ico--sm" />
        <span className="fs-lbl">{t("Dossier")}</span>
        {meta.length > 0 && <span className="fs-dos-meta kx-num">{meta.join(" · ")}</span>}
      </div>
      <p className="fs-dos-p">
        {dossier.has.state
          ? t("The agent keeps “Where things stand” and “Open points” up to date. Your own notes are never overwritten.")
          : t("No status yet. The agent reads the linked meetings and notes and writes where things stand and what is open. Your own notes are never overwritten.")}
      </p>
      <div className="fs-dos-acts">
        <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" onClick={() => run("akte")}>
          <NotebookPen aria-hidden className="kx-ico kx-ico--sm" />
          {t("Update dossier")}
        </button>
        <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => run("briefing")}>
          <Sparkles aria-hidden className="kx-ico kx-ico--sm" />
          {t("Create briefing")}
        </button>
        <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => run("entwurf")}>
          <Mail aria-hidden className="kx-ico kx-ico--sm" />
          {t("Draft a mail")}
        </button>
      </div>
      {timeline.length > 0 && (
        <div className="fs-dos-tl" role="group" aria-label={t("History")}>
          <div className="fs-lbl">
            {t("History")}
            {total > timeline.length && <span className="kx-num"> · {t("{shown} of {total}", { shown: timeline.length, total })}</span>}
          </div>
          <ol>
            {timeline.map((e) => (
              <li key={e.id}>
                <button type="button" className="fs-dos-e" onClick={() => openNote(e.id)} title={e.path}>
                  <span className="fs-dos-d kx-num">{shortDay(e.date)}</span>
                  <TypeIcon type={e.type} size={14} />
                  <span className="fs-dos-t">{e.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
});
