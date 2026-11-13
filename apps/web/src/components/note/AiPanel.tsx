"use client";

import { msg, t, tx } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ico } from "@/components/shell/icons";
import { chatAction } from "@/lib/api/client";
import { aiActionRequest, aiActionsFor, isTextAction, mockAiResult, type AiActionId, type AiAnswerActionId, type AiTextActionId } from "@/lib/shell/ai-actions";
import { useNotes } from "@/lib/notes/store";
import { optionLabel } from "@/lib/typed/fields";
import { useShell } from "@/lib/shell/store";
import { isLiveData, type KnowledgeItem } from "@/lib/workspace-data";
import { MarkdownStatic } from "./MarkdownStatic";

/*
 * The Peek's AI pieces (UI spec 2026-10-25 W7): the header's single "KI" entry with its action menu,
 * the summary block above the text, and the preview of a text action before it replaces the note.
 */

/** Accent-faint surface (ref kx.css --kx-accent-faint): the summary and the proposal sit on it, no border. */
const FAINT = "color-mix(in srgb, var(--accent-ai) 10%, transparent)";

/**
 * KI button in the drawer header and its menu (the same actions as the editor's selection toolbar). Tactile Craft:
 * a sparkles icon button with a tooltip (dummy "KI-Aktionen  Ctrl J"); `labelled` keeps the older "KI" text button.
 */
export function AiMenuButton({
  onPick,
  busy,
  labelled = false,
  pill = false,
  dbType,
}: {
  onPick: (id: AiActionId) => void;
  busy: boolean;
  labelled?: boolean;
  /** Feinschliff Live: a small "Mehr" pill inside the KI-Zusammenfassung box. */
  pill?: boolean;
  /** Registry type of the note: types with a status enum get "Status aktualisieren". */
  dbType?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return (
    <div ref={wrap} style={{ position: "relative", display: "inline-flex" }}>
      {pill ? (
        <button
          type="button"
          className={"fs-pill" + (open || busy ? " is-on" : "")}
          aria-label={t("More AI actions")}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-busy={busy}
          title={t("Rewrite, shorten, continue, summarize, ask a question")}
          onClick={() => setOpen((v) => !v)}
        >
          {t("More")}
        </button>
      ) : (
        <button
          type="button"
          className={labelled ? "kx-btn kx-btn--ai kx-btn--sm" : "tc-ibtn" + (open || busy ? " is-on" : "")}
          aria-label={t("AI actions")}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-busy={busy}
          {...(labelled ? { title: t("AI actions for this note") } : { "data-tip": t("AI actions") })}
          onClick={() => setOpen((v) => !v)}
        >
          <Ico name="sparkles" size="sm" />
          {labelled && <span>{tx("short", "AI")}</span>}
        </button>
      )}
      {open && (
        <div className="kx-menu kx-in" role="menu" aria-label={t("AI actions")} style={{ position: "absolute", right: 0, top: 34, zIndex: 30, width: 248 }}>
          {aiActionsFor(dbType).map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              className="kx-menu-item kxb"
              style={{ width: "100%" }}
              title={a.hint}
              disabled={busy && a.id !== "ask"}
              onClick={() => {
                setOpen(false);
                onPick(a.id);
              }}
            >
              <Ico name={a.icon} size="sm" />
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * KI-Zusammenfassung (Feinschliff Live): a flat box on the accent tint with an accent hairline. Head: label and the
 * actions "Tasks extrahieren" and "Karteikarten" (the copilot's chip actions on this note) plus "Mehr" (the text
 * actions); then the TL;DR (or "Zusammenfassen" when there is none) and the numbered Key Takeaways, which fold.
 */
export function NoteSummary({
  text,
  pending,
  takeaways = [],
  busy = false,
  dbType,
  onAi,
  onChip,
}: {
  text: string;
  pending?: boolean;
  takeaways?: string[];
  busy?: boolean;
  dbType?: string;
  onAi: (id: AiActionId) => void;
  onChip: (chip: "tasks" | "cards") => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label={t("AI summary")} data-summary className="fs-ai">
      <div className="fs-ai-h">
        <Ico name="sparkles" size="sm" />
        <span>{t("AI summary")}</span>
        <span className="fs-ai-acts">
          <button type="button" className="fs-pill" onClick={() => onChip("tasks")}>
            {t("Extract tasks")}
          </button>
          <button type="button" className="fs-pill" onClick={() => onChip("cards")}>
            {t("Flashcards")}
          </button>
          <AiMenuButton pill onPick={onAi} busy={busy} dbType={dbType} />
        </span>
      </div>
      {pending ? (
        <p aria-busy>{t("Kortex is summarizing the note…")}</p>
      ) : text ? (
        <p>{text}</p>
      ) : (
        <p className="fs-ai-empty">
          {t("No summary yet.")}
          <button type="button" className="fs-pill" onClick={() => onAi("summarize")} disabled={busy}>
            {t("Summarize")}
          </button>
        </p>
      )}
      {takeaways.length > 0 && (
        <button type="button" className="kx-ai-sum-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t("Hide key takeaways") : t("Key takeaways")}
        </button>
      )}
      {open && takeaways.length > 0 && (
        <ol aria-label={t("Key takeaways")}>
          {takeaways.map((t, i) => (
            <li key={i}>
              <span className="kx-ai-sum-n">{i + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export interface AiProposal {
  id: AiTextActionId;
  md: string;
}

const LABEL: Record<AiTextActionId, string> = { rewrite: msg("Rewritten"), shorten: msg("Shortened"), continue: msg("Continued") };

/** Preview of a text action; "Übernehmen" replaces the note's Markdown, "Verwerfen" drops it. */
export function AiProposalCard({ proposal, pending, onApply, onDiscard }: { proposal: AiProposal | null; pending: AiTextActionId | null; onApply: () => void; onDiscard: () => void }) {
  if (!proposal && !pending) return null;
  return (
    <section aria-label={t("AI suggestion")} aria-busy={!!pending} style={{ marginTop: 18, padding: "14px 16px", borderRadius: "var(--radius-xl, 12px)", background: FAINT, display: "grid", gap: 10 }}>
      <div className="kx-eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--tag-ai-fg)" }}>
        <Ico name="sparkles" size="sm" />
        {pending ? t("AI is working…") : t("AI suggestion · {action}", { action: t(LABEL[proposal!.id]) })}
      </div>
      {proposal && (
        <>
          <div className="kx-scroll" style={{ maxHeight: 320, color: "var(--text-secondary)" }}>
            <MarkdownStatic markdown={proposal.md} />
          </div>
          <div className="kxh-row" style={{ gap: 8 }}>
            <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" onClick={onApply}>
              <Ico name="check" size="sm" />
              {t("Apply")}
            </button>
            <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={onDiscard}>
              {t("Discard")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Runs an AI action on the open note: live through /api/chat/action, mock with a deterministic
 * stand-in. Text actions end as a proposal, "Zusammenfassen" replaces the summary shown above the text,
 * "Frage dazu stellen" opens the copilot on the note.
 */
export function useNoteAi(item: KnowledgeItem | undefined) {
  const { askAbout, showToast } = useShell();
  const { applyMetadata } = useNotes();
  const [pending, setPending] = useState<Exclude<AiActionId, "ask"> | null>(null);
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  // A different note: drop the old results.
  useEffect(() => {
    setProposal(null);
    setSummary(null);
    setPending(null);
  }, [item?.id]);

  const run = useCallback(
    async (id: AiActionId) => {
      if (!item) return;
      if (id === "ask") {
        askAbout(item.title);
        return;
      }
      if (id === "status") {
        if (!isLiveData()) {
          showToast(t("AI status needs an account (not available in mock mode)"));
          return;
        }
        setPending(id);
        try {
          const res = await chatAction(aiActionRequest("status", { itemId: item.id })!);
          if (!("metadata" in res) || res.action !== "status") throw new Error(t("Unexpected response"));
          applyMetadata(item.id, res.metadata);
          const s = typeof res.metadata.status === "string" ? optionLabel(res.metadata.status) : null;
          showToast(s ? t("Status: {status}", { status: s }) : t("Rating and feedback saved"));
        } catch (err) {
          showToast(err instanceof Error && err.message ? err.message : t("Could not set the status"));
        } finally {
          setPending(null);
        }
        return;
      }
      setPending(id);
      if (isTextAction(id)) setProposal(null);
      try {
        const md = await fetchAiAnswer(id, { itemId: item.id, contentMd: item.contentMd, save: id === "summarize", mockSummary: item.tldr });
        if (id === "summarize") {
          setSummary(md);
          showToast(t("Summary updated"));
        } else if (isTextAction(id)) {
          // "continue" answers with the new paragraphs only: the proposal is the whole note plus them.
          setProposal({ id, md: id === "continue" ? `${item.contentMd.trimEnd()}\n\n${md.trim()}` : md });
        }
      } catch {
        showToast(t("AI action failed. Please try again later."));
      } finally {
        setPending(null);
      }
    },
    [applyMetadata, askAbout, item, showToast],
  );

  return { run, pending, proposal, summary, clearProposal: () => setProposal(null) };
}

/**
 * The model's Markdown answer for an action: live from POST /api/chat/action, in mock mode the
 * deterministic stand-in after a short delay. Used by the header menu and the editor's toolbar (NoteBody).
 * Throws on errors.
 */
export async function fetchAiAnswer(
  id: AiAnswerActionId,
  target: { itemId?: string; contentMd: string; save?: boolean; mockSummary?: string; instruction?: string },
): Promise<string> {
  if (!isLiveData()) {
    await new Promise((r) => setTimeout(r, 500));
    return mockAiResult(id, target.contentMd, target.mockSummary, target.instruction);
  }
  const req = aiActionRequest(id, {
    itemId: target.itemId,
    contentMd: target.contentMd || undefined,
    instruction: target.instruction,
  });
  const res = await chatAction({ ...req!, ...(target.save ? { save: true } : {}) });
  if (!("content_md" in res)) throw new Error(t("Unexpected response"));
  return res.content_md;
}
