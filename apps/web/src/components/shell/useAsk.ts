"use client";

import { usePathname } from "next/navigation";
import { useCallback } from "react";
import { noteById } from "@/lib/workspace-data";
import { answerFor, chipAnswer, type ChipId } from "@/lib/shell/copilot";
import { useCopilotChat } from "@/lib/shell/copilot-chat";
import { routeInfo } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";

/** Copilot context: the open note, else the current view. */
export function useCopilotContext(): { label: string; noteId: string | null } {
  const pathname = usePathname();
  const { drawer } = useShell();
  const note = drawer.id ? noteById(drawer.id) : undefined;
  return { label: note?.title ?? routeInfo(pathname).title, noteId: note?.id ?? null };
}

/** Ask the copilot: streamed from /api/chat in live mode, the mock keyword answer otherwise. */
export function useAsk() {
  const { pushMsgs } = useShell();
  const { live, send } = useCopilotChat();
  return useCallback((q: string) => (live ? send(q) : pushMsgs(answerFor(q))), [live, send, pushMsgs]);
}

/** Quick chips (TL;DR, Tasks, Flashcards): /api/chat/action on the open note in live mode. */
export function useChip() {
  const { pushMsgs, showToast } = useShell();
  const { live, runChip } = useCopilotChat();
  const ctx = useCopilotContext();
  return (chip: ChipId) => {
    if (live) {
      runChip(chip);
      return;
    }
    const r = chipAnswer(chip, ctx.label, ctx.noteId);
    pushMsgs(r.msgs);
    if (r.toast) showToast(r.toast);
  };
}
