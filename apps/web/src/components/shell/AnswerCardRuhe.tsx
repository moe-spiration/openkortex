"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Copy, Maximize2, Minimize2, Sparkles, SquarePen, X } from "lucide-react";
import { typeIcon } from "@kortex/db";
import type { Citation } from "@/lib/api/client";
import { answerNote, citedNumbers } from "@/lib/shell/answer-format";
import { useCopilotChat, type CopilotMessage } from "@/lib/shell/copilot-chat";
import { registryIcon } from "@/lib/shell/registry-icons";
import { scopeLabel } from "@/lib/shell/orbit";
import { useShell } from "@/lib/shell/store";
import { noteById } from "@/lib/workspace-data";
import { t, tn } from "@/i18n";
import {
  AnswerBlocks,
  Done,
  Pending,
  Proposal,
  Steps,
  messageCitations,
  messageDone,
  messageProposal,
  messageSteps,
  messageText,
  useOpenItem,
  usedCitations,
} from "./CopilotLive";

/*
 * Fragen answer card, Ruhe look (gap web-a §7, mock `fragen`): one compact glass card as wide as the Orbit-Bar.
 * Head "Antwort aus N Quellen" with copy and enlarge; the latest answer only (lead sentence, points), the sources as
 * chips with their type icon (three, then "+N"), "Als Notiz speichern" on the right. A follow-up is simply the next
 * question in the bar, which stays in Fragen. Enlarge shows the whole conversation. Live (/api/chat, agent steps,
 * proposals) and mock answers render through the same card.
 */

interface Turn {
  id: string;
  question: string;
  text: string;
  citations: Citation[];
  /** Live only: steps, proposal and done blocks of the agent. */
  extra?: ReactNode;
  streaming?: boolean;
}

const VISIBLE_SOURCES = 3;

function SourceChips({ sources, onOpen }: { sources: Citation[]; onOpen: (id: string) => void }) {
  const shown = sources.slice(0, VISIBLE_SOURCES);
  const rest = sources.length - shown.length;
  return (
    <>
      {shown.map((s) => {
        const Icon = registryIcon(typeIcon(s.type));
        return (
          <button key={s.n} type="button" className="rz-ans-src" title={`[${s.n}] ${s.title}`} onClick={() => onOpen(s.item_id)}>
            <Icon aria-hidden className="kx-ico" style={{ width: 11, height: 11 }} />
            <span className="kx-truncate">{s.title}</span>
          </button>
        );
      })}
      {rest > 0 && (
        <span className="rz-ans-src rz-ans-more" title={sources.slice(VISIBLE_SOURCES).map((s) => s.title).join(", ")}>
          +{rest}
        </span>
      )}
    </>
  );
}

function RuheCard({ turns, head, empty, tail }: { turns: Turn[]; head: string; empty: string; tail?: ReactNode }) {
  const { setCopilot, openNewNote, showToast } = useShell();
  const open = useOpenItem();
  const [wide, setWide] = useState(false);
  const last = turns[turns.length - 1];
  const shown = wide ? turns : last ? [last] : [];
  const sources = last ? usedCitations(last.text, last.citations) : [];
  const copy = () => {
    if (!last?.text) return;
    void navigator.clipboard?.writeText(last.text).then(
      () => showToast(t("Answer copied")),
      () => showToast(t("Clipboard not writable")),
    );
  };
  return (
    <section className={"kx-orbit-answer rz-ans" + (wide ? " is-wide" : "")} aria-label={t("Hybrid RAG copilot")}>
      <div className="rz-ans-head">
        <Sparkles aria-hidden className="rz-ans-spark" />
        <span className="kx-truncate">{head}</span>
        <span className="rz-ans-sp" />
        <button type="button" className="rz-ans-ib" aria-label={t("Copy answer")} title={t("Copy answer")} disabled={!last?.text} onClick={copy}>
          <Copy aria-hidden />
        </button>
        <button
          type="button"
          className="rz-ans-ib"
          aria-label={wide ? t("Show the latest answer only") : t("Show the whole conversation")}
          title={wide ? t("Show the latest answer only") : t("Show the whole conversation")}
          aria-pressed={wide}
          onClick={() => setWide(!wide)}
        >
          {wide ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </button>
        <button type="button" className="rz-ans-ib" aria-label={t("Close copilot")} title={t("Close copilot")} onClick={() => setCopilot(false)}>
          <X aria-hidden />
        </button>
      </div>
      <div className="rz-ans-body kx-scroll" aria-live="polite">
        {!turns.length && !tail && <p className="rz-ans-empty">{empty}</p>}
        {shown.map((turn) => (
          <Fragment key={turn.id}>
            {(wide || !turn.text) && turn.question && <p className="rz-ans-q">{turn.question}</p>}
            {turn.extra}
            {turn.text && (
              <div className="rz-ans-text">
                <AnswerBlocks text={turn.text} citations={turn.citations} />
              </div>
            )}
          </Fragment>
        ))}
        {tail}
      </div>
      {last?.text && !last.streaming && (
        <div className="rz-ans-foot">
          <SourceChips sources={sources} onOpen={open} />
          <span className="rz-ans-sp" />
          <button
            type="button"
            className="rz-ans-save"
            onClick={() => openNewNote(answerNote(last.question, last.text, sources.map((s) => ({ n: s.n, title: s.title }))))}
          >
            <SquarePen aria-hidden />
            {t("Save as note")}
          </button>
        </div>
      )}
    </section>
  );
}

const headFor = (turns: Turn[]): string => {
  const last = turns[turns.length - 1];
  const n = last ? new Set(citedNumbers(last.text)).size : 0;
  return n ? tn(n, "Answer from {n} source", "Answer from {n} sources") : t("Answer");
};

/** Live copilot (/api/chat) in the Ruhe card. */
export function RuheLiveAnswer() {
  const chat = useCopilotChat();
  const { messages, status, pendingAction, error, scope, searchScope, folderPath } = chat;
  const busy = status === "submitted" || status === "streaming";
  const lastMsg = messages[messages.length - 1];
  const waiting = status === "submitted" || (status === "streaming" && (!lastMsg || lastMsg.role !== "assistant" || !messageText(lastMsg)));
  const where = searchScope === "note" ? (scope.itemTitle ?? t("Note")) : searchScope === "space" ? (folderPath ?? t("Folder")) : scopeLabel(searchScope);

  const turns = useMemo(() => {
    const out: Turn[] = [];
    let question = "";
    messages.forEach((m: CopilotMessage) => {
      const text = messageText(m);
      if (m.role === "user") {
        question = text;
        return;
      }
      const steps = messageSteps(m);
      const proposal = messageProposal(m);
      const done = messageDone(m);
      const streamingThis = busy && m === lastMsg;
      if (!text && !steps.length && !proposal && !done.length) return;
      out.push({
        id: m.id,
        question,
        text,
        citations: messageCitations(m),
        streaming: streamingThis,
        extra: (
          <>
            <Steps steps={steps} running={streamingThis && !text} />
            {done.length > 0 && <Done id={m.id} results={done} />}
            {proposal && !streamingThis && <Proposal id={m.id} proposal={proposal} />}
          </>
        ),
      });
    });
    return out;
  }, [messages, busy, lastMsg]);

  const tail = (
    <>
      {waiting && !(lastMsg?.role === "assistant" && messageSteps(lastMsg).length) && <Pending label={t("Searching your sources …")} />}
      {pendingAction && <Pending label={pendingAction + " …"} />}
      {error && !busy && (
        <div className="kx-orbit-answer-error" role="alert">
          <span>{error}</span>
          <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={chat.retry}>
            {t("Try again")}
          </button>
        </div>
      )}
    </>
  );
  const hasTail = waiting || !!pendingAction || (!!error && !busy);
  return (
    <RuheCard
      turns={turns}
      head={headFor(turns)}
      tail={hasTail ? tail : undefined}
      empty={
        searchScope === "all"
          ? t("Ask your second brain. Answers back every statement with sources [n] from your whole vault.")
          : t("Ask your second brain. Answers back every statement with sources [n] from {where}.", { where })
      }
    />
  );
}

/** Mock mode (keyword answers over the mock notes) in the same card. */
export function RuheMockAnswer() {
  const { msgs } = useShell();
  const turns = useMemo(() => {
    const out: Turn[] = [];
    let question = "";
    msgs.forEach((m, i) => {
      if (m.role === "me") {
        question = m.text;
        return;
      }
      const text = m.parts.map((p) => ("cite" in p ? `[${p.cite}]` : p.text)).join("");
      const citations: Citation[] = m.sources.map((s) => {
        const n = noteById(s.id);
        return {
          n: s.n,
          item_id: s.id,
          title: n?.title ?? s.id,
          type: n?.dbType ?? n?.type ?? "note",
          page_or_timestamp: null,
          folder_path: n ? n.path.split("/").slice(0, -1).join("/") : null,
          source_url: null,
          snippet: "",
        };
      });
      out.push({ id: String(i), question, text, citations });
    });
    return out;
  }, [msgs]);
  return <RuheCard turns={turns} head={headFor(turns)} empty={t("Ask your second brain. Answers back every statement with sources [n] from your whole vault.")} />;
}
