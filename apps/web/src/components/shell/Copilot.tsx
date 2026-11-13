"use client";

import { t, tn } from "@/i18n";
import { noteById } from "@/lib/workspace-data";
import { useCopilotChat } from "@/lib/shell/copilot-chat";
import { useShell } from "@/lib/shell/store";
import { AnswerActions, CopilotLivePanel } from "./CopilotLive";
import { useCopilotContext } from "./useAsk";
import { Ico } from "./icons";

/* Quick chips above the footbar and the Hybrid-RAG copilot panel (WebApp.dc.html). */

export function CopilotPanel() {
  const { live } = useCopilotChat();
  return live ? <CopilotLivePanel /> : <MockCopilotPanel />;
}

/** Prototype copilot with keyword answers over the mock notes (KORTEX_DATA_SOURCE=mock), same card as live. */
function MockCopilotPanel() {
  const { msgs, setCopilot, openNote } = useShell();
  const ctx = useCopilotContext();
  const lastAi = msgs.reduce((at, m, i) => (m.role === "ai" ? i : at), -1);
  const last = msgs[lastAi];
  const count = last && last.role === "ai" ? last.sources.length : 0;
  return (
    <section className="kx-orbit-answer tc-float kx-slide-up" aria-label={t("Hybrid RAG copilot")}>
      <div className="kx-orbit-answer-head">
        <span className="kx-orbit-micro kx-orbit-answer-title">
          <Ico name="orbit-sparkles" size={12} />
          {count ? tn(count, "Answer from {n} source", "Answer from {n} sources") : "Copilot"} · {ctx.label}
        </span>
        <span className="kx-orbit-grow" />
        <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={t("Close copilot")} onClick={() => setCopilot(false)}>
          <Ico name="x" size={14} />
        </button>
      </div>
      <div className="kx-orbit-answer-scroll" aria-live="polite">
        {msgs.map((m, i) => {
          if (m.role === "me")
            return (
              <div key={i} className="kx-orbit-question">
                {m.text}
              </div>
            );
          const prev = msgs.slice(0, i).reverse().find((x) => x.role === "me");
          const md = m.parts.map((p) => ("cite" in p ? `[${p.cite}]` : p.text)).join("");
          return (
            <div key={i} className="kx-orbit-answer-body">
              <p style={{ margin: 0 }}>
                {m.parts.map((p, j) =>
                  "cite" in p ? (
                    <button key={j} type="button" className="kx-cite" title={noteById(p.id)?.title} onClick={() => openNote(p.id)}>
                      {p.cite}
                    </button>
                  ) : (
                    <span key={j}>{p.text}</span>
                  ),
                )}
              </p>
              <AnswerActions
                last={i === lastAi}
                question={prev && prev.role === "me" ? prev.text : ""}
                answer={md}
                sources={m.sources.map((src) => ({ n: src.n, id: src.id, title: noteById(src.id)?.title ?? src.id, meta: noteById(src.id)?.path.split("/").slice(-1)[0] }))}
                onSource={openNote}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
