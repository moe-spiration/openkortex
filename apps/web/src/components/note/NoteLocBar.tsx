"use client";

import { t } from "@/i18n";
import { Link2, Minimize2, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { BarButton, BarIconButton, LocationBar, type LocCrumb } from "@/components/shell/Bars";
import { isDomainObjectType } from "@/lib/objects/schema";
import { useCopilotChat } from "@/lib/shell/copilot-chat";
import { COMMAND_SKILL, ORBIT_COMMANDS } from "@/lib/shell/orbit";
import { useShell } from "@/lib/shell/store";
import { objectHref, spaceHref } from "@/lib/shell/routes";
import { OBJECT_HUBS, type KnowledgeItem } from "@/lib/workspace-data";
import { noteCrumbs } from "./crumbs";
import { TypeIcon } from "./icons";

/*
 * Location bar of an entry opened as a full tab (/notes/<id>) in the Ruhe look (mockup screens 03 and 06): the path
 * as a breadcrumb ("Bibliothek › Personen › Jonas Weber" for an object, the vault folders for a note), then the
 * quiet actions (Briefing for an Akte, favourite, copy link, AI, "Mehr") and back to the side view. It renders into
 * the shell's header host (components/shell/Bars.tsx). The drawer beside a list keeps its own head (SheetToolbar).
 */

export function noteLocCrumbs(item: KnowledgeItem): LocCrumb[] {
  if (isDomainObjectType(item.type)) {
    const hub = OBJECT_HUBS.find((h) => h.type === item.type);
    return [{ label: t("Library"), href: spaceHref("all") }, ...(hub ? [{ label: hub.label, href: objectHref(hub.type) }] : []), { label: item.title }];
  }
  const folders = noteCrumbs(item.path, OBJECT_HUBS).slice(0, -1);
  return [...folders.map((c) => ({ label: c.label, href: c.href ?? undefined })), { label: item.title }];
}

export function NoteLocBar({
  item,
  akte,
  aiOpen,
  star,
  menu,
  onCopyLink,
  onToggleAi,
  onSide,
  onClose,
}: {
  item: KnowledgeItem;
  akte: boolean;
  aiOpen: boolean;
  /** The favourite star (FavStar of NoteSheet). */
  star: ReactNode;
  /** "Mehr" (SheetMenu with its own trigger). */
  menu: ReactNode;
  onCopyLink: () => void;
  onToggleAi: () => void;
  onSide: () => void;
  onClose: () => void;
}) {
  const chat = useCopilotChat();
  const { showToast } = useShell();
  const onBriefing = () => {
    const cmd = ORBIT_COMMANDS.find((c) => c.id === "briefing")?.cmd;
    const skill = COMMAND_SKILL.briefing;
    if (!chat.live) return showToast(t("The agent needs an account (not available in mock mode)"));
    if (cmd && skill) chat.send(`${cmd} ${item.title}`, { skill });
  };
  return (
    <LocationBar
      className="rz-note-loc"
      icon={<TypeIcon type={item.type} size={14} />}
      crumbs={noteLocCrumbs(item)}
      actions={
        <>
          {akte && (
            <BarButton icon={<Sparkles aria-hidden size={14} strokeWidth={1.5} />} onClick={onBriefing}>
              {t("Briefing")}
            </BarButton>
          )}
          {star}
          <BarIconButton icon={<Link2 aria-hidden size={15} strokeWidth={1.5} />} label={t("Copy link")} title={t("Copy link")} onClick={onCopyLink} />
          {!akte && (
            <BarIconButton
              icon={<Sparkles aria-hidden size={15} strokeWidth={1.5} />}
              label={t("AI actions")}
              title={t("AI: TL;DR, tasks, flashcards")}
              aria-pressed={aiOpen}
              className={aiOpen ? "is-on" : undefined}
              onClick={onToggleAi}
            />
          )}
          {menu}
          <BarIconButton icon={<Minimize2 aria-hidden size={15} strokeWidth={1.5} />} label={t("Back to side view")} title={t("Back to side view")} onClick={onSide} />
        </>
      }
      onClose={onClose}
    />
  );
}
