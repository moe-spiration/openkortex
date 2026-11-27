"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentActionResult, ProposalData, StepData } from "@/server/chat/agent";
import type { Citation } from "@/lib/api/client";
import { answerNote, citedNumbers, parseAnswer, type Inline } from "@/lib/shell/answer-format";
import { useCopilotChat, type CopilotMessage } from "@/lib/shell/copilot-chat";
import { scopeLabel } from "@/lib/shell/orbit";
import { useShell } from "@/lib/shell/store";
import { noteById } from "@/lib/workspace-data";
import { t, tn } from "@/i18n";
import { Ico } from "./icons";

/*
 * Live copilot answer card (Tactile Craft decision 9/8): floats above the Orbit-Bar (Level 2), streamed
 * /api/chat answers with [n] citations, sources as chips and under the latest answer
 * "Als Notiz speichern" (openNewNote with the formatted answer) and "Weiter fragen". The Suchbereich is
 * picked with the bar's chip (copilot-chat searchScope).
 */

/** Puts the Orbit-Bar into Fragen and focuses its field ("Weiter fragen"). */
export function useFollowUp() {
  const { setCmode, setPinned } = useShell();
  return () => {
    setCmode("ask");
    setPinned(true);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".kx-orbit-field")?.focus());
  };
}

/** Action row under an answer: sources as chips, then Als Notiz speichern and Weiter fragen. */
export function AnswerActions({
  question,
  answer,
  sources,
  onSource,
  last = true,
}: {
  /** Only the latest answer offers Als Notiz speichern / Weiter fragen. */
  last?: boolean;
  question: string;
  answer: string;
  sources: { n: number; title: string; id: string; meta?: string }[];
  onSource: (id: string) => void;
}) {
  const { openNewNote } = useShell();
  const follow = useFollowUp();
  return (
    <div className="kx-orbit-srcs">
      {sources.map((s) => (
        <button key={s.n} type="button" className="kx-orbit-srcchip" title={s.meta ? `${s.title} · ${s.meta}` : s.title} onClick={() => onSource(s.id)}>
          <span className="kx-orbit-srcn kx-num">{s.n}</span>
          <span className="kx-truncate">{s.title}</span>
        </button>
      ))}
      {last && <span className="kx-orbit-grow" />}
      {last && (
      <button type="button" className="kx-orbit-srcchip" onClick={() => openNewNote(answerNote(question, answer, sources))}>
        <Ico name="file-plus" size={12} />
        {t("Save as note")}
      </button>
      )}
      {last && (
      <button type="button" className="kx-orbit-srcchip" onClick={follow}>
        <Ico name="corner-down-right" size={12} />
        {t("Ask a follow-up")}
      </button>
      )}
    </div>
  );
}

export function useOpenItem() {
  const router = useRouter();
  const { openNote } = useShell();
  return (id: string) => (noteById(id) ? openNote(id) : router.push(`/notes/${id}`));
}

function InlineText({ c, cites, onCite }: { c: Inline[]; cites: Map<number, Citation>; onCite: (cit: Citation) => void }): ReactNode {
  return c.map((x, i) => {
    switch (x.t) {
      case "text":
        return <Fragment key={i}>{x.v}</Fragment>;
      case "b":
        return (
          <strong key={i}>
            <InlineText c={x.c} cites={cites} onCite={onCite} />
          </strong>
        );
      case "i":
        return (
          <em key={i}>
            <InlineText c={x.c} cites={cites} onCite={onCite} />
          </em>
        );
      case "code":
        return (
          <code key={i} className="kx-mono" style={{ fontSize: "calc(12px * var(--kx-fs, 1))", padding: "0 4px", borderRadius: "var(--radius-xs)", background: "var(--bg-surface-muted)" }}>
            {x.v}
          </code>
        );
      case "link":
        return (
          <a key={i} href={x.href} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent-ai)" }}>
            <InlineText c={x.c} cites={cites} onCite={onCite} />
          </a>
        );
      case "cite": {
        const cit = cites.get(x.n);
        if (!cit) return <Fragment key={i}>[{x.n}]</Fragment>;
        return (
          <button key={i} type="button" className="kx-cite" title={cit.title} aria-label={t("Source {n}: {title}", { n: x.n, title: cit.title })} onClick={() => onCite(cit)}>
            {x.n}
          </button>
        );
      }
    }
  });
}

/** The answer's Markdown as blocks with clickable [n] citations (no action row). */
export function AnswerBlocks({ text, citations }: { text: string; citations: Citation[] }) {
  const open = useOpenItem();
  const cites = useMemo(() => new Map(citations.map((c) => [c.n, c])), [citations]);
  const onCite = (c: Citation) => open(c.item_id);
  const blocks = useMemo(() => parseAnswer(text), [text]);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === "h")
          return (
            <strong key={i} style={{ fontSize: "calc(13px * var(--kx-fs, 1))", marginTop: i ? 4 : 0 }}>
              <InlineText c={b.c} cites={cites} onCite={onCite} />
            </strong>
          );
        if (b.t === "p")
          return (
            <p key={i} style={{ margin: 0 }}>
              <InlineText c={b.c} cites={cites} onCite={onCite} />
            </p>
          );
        if (b.t === "quote")
          return (
            <p key={i} style={{ margin: 0, paddingLeft: 10, boxShadow: "inset 2px 0 0 var(--border-subtle)", color: "var(--text-secondary)" }}>
              <InlineText c={b.c} cites={cites} onCite={onCite} />
            </p>
          );
        if (b.t === "pre")
          return (
            <pre key={i} className="kx-mono" style={{ margin: 0, padding: "8px 10px", borderRadius: "var(--radius-control)", background: "var(--bg-surface-muted)", fontSize: "calc(12px * var(--kx-fs, 1))", overflowX: "auto" }}>
              {b.v}
            </pre>
          );
        const List = b.t === "ol" ? "ol" : "ul";
        return (
          <List key={i} style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 2 }}>
            {b.items.map((it, j) => (
              <li key={j}>
                <InlineText c={it} cites={cites} onCite={onCite} />
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}

/** The sources an answer really cites, in citation order. */
export function usedCitations(text: string, citations: Citation[]): Citation[] {
  const used = new Set(citedNumbers(text));
  return citations.filter((c) => used.has(c.n));
}

function Answer({ text, citations, question, last }: { text: string; citations: Citation[]; question: string; last: boolean }) {
  const open = useOpenItem();
  const sources = usedCitations(text, citations);
  return (
    <div className="kx-orbit-answer-body">
      <AnswerBlocks text={text} citations={citations} />
      {(sources.length > 0 || last) && (
        <AnswerActions
          last={last}
          question={question}
          answer={text}
          sources={sources.map((s) => ({ n: s.n, title: s.title, id: s.item_id, meta: s.page_or_timestamp ?? s.folder_path ?? undefined }))}
          onSource={open}
        />
      )}
    </div>
  );
}

/** A finished answer outside the chat (a background job): the text with its numbered sources, no follow-up actions. */
export function StaticAnswer({ text, sources }: { text: string; sources: readonly { n: number; item_id: string; title: string; type: string }[] }) {
  const citations = useMemo<Citation[]>(() => sources.map((s) => ({ ...s, page_or_timestamp: null, folder_path: null, source_url: null, snippet: "" })), [sources]);
  return <Answer text={text} citations={citations} question="" last={false} />;
}

export function messageText(m: CopilotMessage): string {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** The sources of an answer: the agent adds to them while it works, so the latest part counts. */
export function messageCitations(m: CopilotMessage): Citation[] {
  let out: Citation[] = [];
  for (const p of m.parts) if (p.type === "data-citations") out = p.data.citations;
  return out;
}

export function messageSteps(m: CopilotMessage): StepData[] {
  return m.parts.flatMap((p) => (p.type === "data-step" ? [p.data] : []));
}
export function messageProposal(m: CopilotMessage): ProposalData | null {
  let out: ProposalData | null = null;
  for (const p of m.parts) if (p.type === "data-proposal") out = p.data;
  return out;
}
export function messageDone(m: CopilotMessage): AgentActionResult[] {
  let out: AgentActionResult[] = [];
  for (const p of m.parts) if (p.type === "data-done") out = p.data.results;
  return out;
}

const STEP_ICON = { search: "search", read: "file-text", write: "pencil" } as const;

/** What the agent did for this answer: one line, the single steps on demand. */
export function Steps({ steps, running }: { steps: StepData[]; running: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  const searches = steps.filter((s) => s.kind === "search").length;
  const reads = steps.filter((s) => s.kind === "read").length;
  const writes = steps.filter((s) => s.kind === "write").length;
  const summary = [
    searches ? tn(searches, "{n} search", "{n} searches") : null,
    reads ? tn(reads, "{n} entry read", "{n} entries read") : null,
    writes ? tn(writes, "{n} change", "{n} changes") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const latest = steps[steps.length - 1]!;
  return (
    <div className="kx-agent-steps">
      <button type="button" className="kx-agent-steps-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        {running ? <span className="kx-spinner" aria-hidden /> : <Ico name="orbit-sparkles" size={12} />}
        <span className="kx-truncate">{running ? latest.label : summary}</span>
        <Ico name="chev-d" size={12} />
      </button>
      {open && (
        <ol className="kx-agent-steps-list">
          {steps.map((s, i) => (
            <li key={i}>
              <Ico name={STEP_ICON[s.kind]} size={12} />
              <span className="kx-truncate">{s.label}</span>
              {s.count !== undefined && <span className="kx-num kx-help">{tn(s.count, "{n} hit", "{n} hits")}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ResultList({ results, onOpen }: { results: readonly Pick<AgentActionResult, "ok" | "label" | "item_id" | "error">[]; onOpen: (id: string) => void }) {
  return (
    <ul className="kx-agent-list">
      {results.map((r, i) => (
        <li key={i} data-ok={r.ok}>
          <Ico name={r.ok ? "check" : "x"} size={12} />
          {r.ok && r.item_id ? (
            <button type="button" className="kx-agent-link kx-truncate" onClick={() => onOpen(r.item_id!)}>
              {r.label}
            </button>
          ) : (
            <span className="kx-truncate">{r.error ? `${r.label}: ${r.error}` : r.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Changes the agent proposes (autonomy "Mit Rückfrage"): tick, run, or dismiss. Nothing is saved before. */
export function Proposal({ id, proposal }: { id: string; proposal: ProposalData }) {
  const chat = useCopilotChat();
  const open = useOpenItem();
  const outcome = chat.outcomes[id];
  const [off, setOff] = useState<ReadonlySet<number>>(new Set());
  const picked = proposal.actions.map((_, i) => i).filter((i) => !off.has(i));
  if (outcome?.state === "dismissed") return <p className="kx-agent-note">{t("Proposal dismissed. Nothing was changed.")}</p>;
  if (outcome?.results) {
    const undone = outcome.state === "undone";
    return (
      <div className="kx-agent-card">
        <div className="kx-orbit-micro">{undone ? t("Undone") : t("Done")}</div>
        <ResultList results={outcome.results} onOpen={open} />
        {!undone && outcome.results.some((r) => r.undo) && (
          <div className="kx-agent-actions">
            <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => chat.undoChanges(id, outcome.results!)}>
              {t("Undo")}
            </button>
          </div>
        )}
      </div>
    );
  }
  const running = outcome?.state === "running";
  return (
    <div className="kx-agent-card" data-kind="proposal">
      <div className="kx-orbit-micro">{tn(proposal.actions.length, "{n} change waits for your OK", "{n} changes wait for your OK")}</div>
      <ul className="kx-agent-list">
        {proposal.actions.map((a, i) => (
          <li key={i}>
            <label className="kx-agent-check">
              <input
                type="checkbox"
                checked={!off.has(i)}
                disabled={running}
                onChange={() => {
                  const next = new Set(off);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  setOff(next);
                }}
              />
              <span>{proposal.labels[i] ?? a.kind}</span>
            </label>
            {a.kind === "note_create" && a.markdown.trim() && (
              <details className="kx-agent-preview">
                <summary>{t("Preview")}</summary>
                <pre>{a.markdown.slice(0, 4000)}</pre>
              </details>
            )}
            {a.kind === "dossier_update" && (a.state?.trim() || a.open_points?.length) && (
              <details className="kx-agent-preview">
                <summary>{t("Preview")}</summary>
                <pre>{[a.state?.trim() ?? "", ...(a.open_points ?? []).map((p) => `- ${p}`)].filter(Boolean).join("\n").slice(0, 4000)}</pre>
              </details>
            )}
            {a.kind === "note_edit" && (a.append_markdown?.trim() || a.replacements?.length) && (
              <details className="kx-agent-preview">
                <summary>{t("Preview")}</summary>
                <pre>
                  {[...(a.replacements ?? []).map((r) => `− ${r.find}\n+ ${r.replace}`), a.append_markdown?.trim() ? `+ ${a.append_markdown.trim()}` : ""]
                    .filter(Boolean)
                    .join("\n\n")
                    .slice(0, 4000)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      <div className="kx-agent-actions">
        <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" disabled={running || !picked.length} onClick={() => chat.confirmProposal(id, proposal, picked)}>
          {running ? t("Running …") : tn(picked.length, "Run {n} change", "Run {n} changes")}
        </button>
        <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" disabled={running} onClick={() => chat.dismissProposal(id)}>
          {t("Dismiss")}
        </button>
      </div>
    </div>
  );
}

/** Changes the agent made on its own (autonomy "Selbstständig"), with undo. */
export function Done({ id, results }: { id: string; results: AgentActionResult[] }) {
  const chat = useCopilotChat();
  const open = useOpenItem();
  const undone = chat.outcomes[id]?.state === "undone";
  return (
    <div className="kx-agent-card">
      <div className="kx-orbit-micro">{undone ? t("Undone") : t("Done by the agent")}</div>
      <ResultList results={results} onOpen={open} />
      {!undone && results.some((r) => r.undo) && (
        <div className="kx-agent-actions">
          <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => chat.undoChanges(id, results)}>
            {t("Undo")}
          </button>
        </div>
      )}
    </div>
  );
}

export function Pending({ label }: { label: string }) {
  return (
    <div className="kxh-row kx-help" role="status" style={{ gap: 8, padding: "4px 2px", fontSize: "calc(12px * var(--kx-fs, 1))" }}>
      <span className="kx-spinner" aria-hidden />
      {label}
    </div>
  );
}

export function CopilotLivePanel() {
  const { setCopilot } = useShell();
  const chat = useCopilotChat();
  const { messages, status, pendingAction, error, scope, searchScope, folderPath } = chat;
  const end = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const last = messages[messages.length - 1];
  const waiting = status === "submitted" || (status === "streaming" && (!last || last.role !== "assistant" || !messageText(last)));
  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant" && messageText(m));

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, status, pendingAction, error]);

  const where =
    searchScope === "note" ? (scope.itemTitle ?? t("Note")) : searchScope === "space" ? (folderPath ?? t("Folder")) : scopeLabel(searchScope);
  const sourceCount = lastAnswer ? new Set(citedNumbers(messageText(lastAnswer))).size : 0;

  return (
    <section className="kx-orbit-answer tc-float kx-slide-up" aria-label={t("Hybrid RAG copilot")}>
      <div className="kx-orbit-answer-head">
        <span className="kx-orbit-micro kx-orbit-answer-title">
          <Ico name="orbit-sparkles" size={12} />
          {sourceCount ? tn(sourceCount, "Answer from {n} source", "Answer from {n} sources") : "Copilot"} · {where}
        </span>
        <span className="kx-orbit-grow" />
        {messages.length > 0 && (
          <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={t("New chat")} data-tip={t("New chat")} onClick={chat.reset}>
            <Ico name="plus" size={14} />
          </button>
        )}
        <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={t("Close copilot")} onClick={() => setCopilot(false)}>
          <Ico name="x" size={14} />
        </button>
      </div>
      <div className="kx-orbit-answer-scroll" aria-live="polite">
        {messages.length === 0 && !pendingAction && (
          <p className="kx-orbit-answer-empty">
            {searchScope === "all"
              ? t("Ask your second brain. Answers back every statement with sources [n] from your whole vault.")
              : t("Ask your second brain. Answers back every statement with sources [n] from {where}.", { where })}
          </p>
        )}
        {messages.map((m, i) => {
          const text = messageText(m);
          if (m.role === "user")
            return (
              <div key={m.id} className="kx-orbit-question">
                {text}
              </div>
            );
          const steps = messageSteps(m);
          const proposal = messageProposal(m);
          const done = messageDone(m);
          const streamingThis = busy && m === last;
          if (!text && !steps.length && !proposal && !done.length) return null;
          const prev = messages.slice(0, i).reverse().find((x) => x.role === "user");
          return (
            <Fragment key={m.id}>
              <Steps steps={steps} running={streamingThis && !text} />
              {text && <Answer text={text} citations={messageCitations(m)} question={prev ? messageText(prev) : ""} last={m === lastAnswer && !busy} />}
              {done.length > 0 && <Done id={m.id} results={done} />}
              {proposal && !streamingThis && <Proposal id={m.id} proposal={proposal} />}
            </Fragment>
          );
        })}
        {waiting && !(last?.role === "assistant" && messageSteps(last).length) && <Pending label={t("Searching your sources …")} />}
        {pendingAction && <Pending label={pendingAction + " …"} />}
        {error && !busy && (
          <div className="kx-orbit-answer-error" role="alert">
            <span>{error}</span>
            <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={chat.retry}>
              {t("Try again")}
            </button>
          </div>
        )}
        <div ref={end} />
      </div>
    </section>
  );
}
