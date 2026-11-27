"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Clock } from "lucide-react";
import { intlLocale, t, tn } from "@/i18n";
import { jobPercent, labelParts, proposalKind, proposalMeta, scheduleLabel, splitFinished, type JobStep, type JobView, type StandingOrderView } from "@/lib/agent-jobs";
import { useNotes } from "@/lib/notes/store";
import { useShell } from "@/lib/shell/store";
import { AGENT_SKILL_INFO, type AgentSkillInfo } from "@/lib/agent-skills";
import { ORBIT_COMMANDS } from "@/lib/shell/orbit";
import { ResultList, StaticAnswer, useOpenItem } from "@/components/shell/CopilotLive";
import { Pictogram } from "@/components/motion/Pictogram";
import { EmptyPic } from "@/components/motion/EmptyPic";
import { Ico, type IconId } from "@/components/shell/icons";
import { AutonomyMenu } from "@/components/shell/TargetMenu";
import { BarButton, KbdHints, LocationBar } from "@/components/shell/Bars";
import { MenuItem } from "@/components/ui/primitives";

/*
 * The agent's page in the Ruhe look (artifact "Kortex Ruhe-Iteration", screen 07): location bar "Agent › Aufträge",
 * on the left the job list grouped by state (waiting for you, running, done today, earlier, standing orders) with a
 * status ring, on the right the chosen job: status line, title, the full step log, the changes as a diff to confirm
 * (all or a selection) and the answer. Without a chosen job the right side offers the skills.
 * AgentView owns the state and hands it over; Classic keeps its own markup. Styles: packages/ui/src/styles/ruhe-agent.css.
 */

export interface AgentRuheModel {
  live: boolean;
  loaded: boolean;
  jobs: readonly JobView[];
  groups: { waiting: JobView[]; running: JobView[]; finished: JobView[] };
  orders: readonly StandingOrderView[];
  job: JobView | null;
  picked: string | null;
  busy: boolean;
  orderText: string | null;
  setPicked: (id: string | null) => void;
  setOrderText: (v: string | null) => void;
  pickSkill: (sk: AgentSkillInfo) => void;
  confirm: (job: JobView, picks: number[]) => void;
  dismiss: (job: JobView) => void;
  undo: (job: JobView) => void;
  saveOrder: (sentence: string) => void;
  toggleOrder: (o: StandingOrderView) => void;
  deleteOrder: (o: StandingOrderView) => void;
  /** Answer the agent or change the request of a job (composer under the job). */
  reply: (job: JobView, text: string) => void;
}

const isActive = (j: JobView) => j.status === "queued" || j.status === "running";

function clock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(intlLocale(), { day: "numeric", month: "short" });
}

function stateLabel(job: JobView): string {
  if (job.status === "queued") return t("Queued");
  if (job.status === "running") return t("Running …");
  if (job.status === "waiting") return t("Waits for your OK");
  if (job.status === "error") return t("Failed");
  if (job.status === "cancelled") return t("Dismissed");
  if (job.result?.undone) return t("Undone");
  return t("Done");
}

/** Second line of a row: what waits, what runs, what came out. */
function rowSub(job: JobView): string {
  const r = job.result;
  if (job.status === "waiting") {
    const n = r?.proposal?.labels.length ?? 0;
    return n ? tn(n, "Confirm {n} change", "Confirm {n} changes") : t("Waits for your OK");
  }
  if (isActive(job)) {
    if (r?.progress?.label) return r.progress.label;
    const last = r?.steps?.[r.steps.length - 1];
    return last ? plain(last.label) : stateLabel(job);
  }
  if (job.status === "error") return t("Failed");
  if (r?.undone) return t("Undone");
  // Finished jobs are one quiet line (mockup screen 07); the count of changes is in the detail.
  return "";
}

/** A label without its markup (for the one-line list). */
const plain = (label: string) => labelParts(label).map((p) => p.text).join("");

/** Label with **entities** in the text colour and [[links]] in the accent, a click opens the entry. */
export function RichLabel({ text }: { text: string }) {
  const { items } = useNotes();
  const { openNote } = useShell();
  return labelParts(text).map((p, i) => {
    if (p.kind === "strong") return <b key={i}>{p.text}</b>;
    if (p.kind === "text") return <Fragment key={i}>{p.text}</Fragment>;
    const target = Object.values(items).find((x) => x.title.toLowerCase() === p.text.toLowerCase());
    return target ? (
      <button key={i} type="button" className="rz-wl" onClick={() => openNote(target.id)}>
        {p.text}
      </button>
    ) : (
      <span key={i} className="rz-wl">
        {p.text}
      </span>
    );
  });
}

/** Status ring: open ring waits (accent), turning arc runs, check done, cross failed. */
export function StatusRing({ job }: { job: JobView }) {
  const kind = job.status === "waiting" ? "wait" : isActive(job) ? "run" : job.status === "error" ? "err" : job.status === "cancelled" ? "off" : "done";
  const pct = jobPercent(job);
  // Circumference of r = 6.25: the share of a running job with known progress, else the turning arc.
  const c = 2 * Math.PI * 6.25;
  return (
    <span className="rz-ring" data-k={kind} data-p={pct === null ? undefined : ""} aria-hidden>
      <svg viewBox="0 0 16 16" width="16" height="16">
        <circle cx="8" cy="8" r="6.25" className="rz-ring-track" />
        {kind === "run" && pct !== null && (
          <circle cx="8" cy="8" r="6.25" className="rz-ring-share" strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 8 8)" />
        )}
        {kind === "run" && pct === null && <circle cx="8" cy="8" r="6.25" className="rz-ring-arc" />}
        {kind === "done" && <path d="M5.2 8.2l1.9 1.9 3.7-3.9" className="rz-ring-mark" />}
        {kind === "err" && <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" className="rz-ring-mark" />}
      </svg>
    </span>
  );
}

function JobRow({ job, on, onPick }: { job: JobView; on: boolean; onPick: () => void }) {
  const pct = jobPercent(job);
  const right = isActive(job) ? (pct === null ? "" : `${pct} %`) : clock(job.status === "waiting" ? (job.finishedAt ?? job.createdAt) : (job.finishedAt ?? job.createdAt));
  const sub = rowSub(job);
  return (
    <button type="button" className={"rz-ag-row" + (on ? " is-on" : "") + (sub ? "" : " is-one")} onClick={onPick} aria-current={on || undefined} data-state={job.status}>
      <StatusRing job={job} />
      <span className="rz-ag-row-t">
        <span className="rz-ag-row-title">{job.title}</span>
        {sub && <span className="rz-ag-row-sub">{sub}</span>}
      </span>
      {right && <span className="rz-ag-row-time">{right}</span>}
    </button>
  );
}

function Group({ label, count, children }: { label: string; count?: ReactNode; children: ReactNode }) {
  return (
    <section className="rz-ag-group">
      <h2 className="rz-ag-group-h">
        {label}
        {count !== undefined && <span className="rz-ag-count">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

const STEP_ICON: Record<JobStep["kind"], IconId> = {
  search: "search",
  read: "file-text",
  write: "pencil",
};
const CHANGE_ICON: Record<string, IconId> = {
  note_create: "plus",
  task_create: "plus",
  note_edit: "pencil",
  dossier_update: "pencil",
};

/** The changes the agent proposes, as a diff: each line can be left out, then all are run or dismissed. */
function Changes({ job, busy, onConfirm, onDismiss }: { job: JobView; busy: boolean; onConfirm: (picks: number[]) => void; onDismiss: () => void }) {
  const [off, setOff] = useState<ReadonlySet<number>>(new Set());
  const labels = job.result?.proposal?.labels ?? [];
  const actions = job.result?.proposal?.actions ?? [];
  const picked = labels.map((_, i) => i).filter((i) => !off.has(i));
  const flip = (i: number) => {
    const next = new Set(off);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setOff(next);
  };
  return (
    <div className="rz-diff">
      <div className="rz-diff-h">
        <Ico name="eye" size={14} />
        <span>{t("Confirm before saving")}</span>
        <span className="rz-grow" />
        <button type="button" className="rz-btn" disabled={busy} onClick={onDismiss}>
          {t("Dismiss all")}
        </button>
        <button type="button" className="rz-btn rz-btn--acc" disabled={busy || !picked.length} onClick={() => onConfirm(picked)}>
          {busy ? t("Running …") : picked.length === labels.length ? t("Accept all") : t("Accept {n}", { n: picked.length })}
        </button>
      </div>
      <ul className="rz-diff-list">
        {labels.map((label, i) => {
          const kind = proposalKind(actions[i]);
          const skip = off.has(i);
          const meta = proposalMeta(actions[i]);
          const linkOnly = kind === "note_edit" && meta === t("Backlink");
          return (
            <li key={i} className={skip ? "is-off" : ""}>
              <label>
                <span className="rz-diff-ic" data-kind={kind ?? "other"}>
                  <Ico name={linkOnly ? "link" : (kind && CHANGE_ICON[kind]) || "link"} size={14} />
                </span>
                <span className="rz-diff-t">
                  <RichLabel text={label} />
                </span>
                <span className="rz-diff-meta">{skip ? t("left out") : meta}</span>
                <input type="checkbox" checked={!skip} disabled={busy} onChange={() => flip(i)} aria-label={plain(label)} title={skip ? t("Take it in again") : t("Leave out")} />
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function JobDetail({ m, job }: { m: AgentRuheModel; job: JobView }) {
  const open = useOpenItem();
  const r = job.result;
  const steps = r?.steps ?? [];
  const results = r?.done?.results ?? [];
  const labels = r?.proposal?.labels ?? [];
  const origin =
    job.origin === "standing" ? t("by a standing order") : job.origin === "task" ? t("from the board") : job.origin === "presort" ? t("by the presort") : "";
  return (
    <article className="rz-ag-job" key={job.id}>
      <div className="rz-ag-state" data-state={job.status}>
        <StatusRing job={job} />
        <span className="rz-ag-state-l">{stateLabel(job)}</span>
        <span className="rz-ag-state-m">
          · {t("started {time}", { time: clock(job.startedAt ?? job.createdAt) })}
          {origin ? ` ${origin}` : ""}
        </span>
      </div>
      <h1 className="rz-ag-title">{job.title}</h1>
      {/* Agent arbeitet: large while nothing is logged yet, small above the growing log. */}
      {isActive(job) && <Pictogram kind="agent" size={steps.length ? "sm" : "md"} className="kx-art-ruhe rz-ag-pic" />}
      {job.prompt.trim() !== job.title.trim() && <p className="rz-ag-prompt">{job.prompt}</p>}

      {(steps.length > 0 || isActive(job)) && (
        <ol className="rz-log" aria-label={t("What the agent did")}>
          {steps.map((s, i) => (
            <li key={i} style={{ "--i": i } as CSSProperties}>
              <Ico name={STEP_ICON[s.kind]} size={14} />
              <span className="rz-log-t">
                <RichLabel text={s.label} />
              </span>
              {s.at ? (
                <time className="rz-log-n" dateTime={s.at}>
                  {clock(s.at)}
                </time>
              ) : (
                s.count !== undefined && <span className="rz-log-n">{tn(s.count, "{n} hit", "{n} hits")}</span>
              )}
            </li>
          ))}
          {isActive(job) && (
            <li className="is-live">
              <span className="kx-spinner" aria-hidden />
              <span className="rz-log-t">{t("The agent is working. You can leave this page, the result waits here.")}</span>
            </li>
          )}
        </ol>
      )}

      {job.status === "error" && <p className="rz-ag-error">{t("This job failed: {error}", { error: job.error ?? t("unknown error") })}</p>}

      {job.status === "waiting" && labels.length > 0 && (
        <Changes key={job.id} job={job} busy={m.busy} onConfirm={(p) => m.confirm(job, p)} onDismiss={() => m.dismiss(job)} />
      )}

      {results.length > 0 && (
        <div className="rz-diff rz-diff--done">
          <div className="rz-diff-h">
            <Ico name="check" size={14} />
            <span>{r?.undone ? t("Undone") : t("Done by the agent")}</span>
            <span className="rz-grow" />
            {!r?.undone && results.some((x) => x.undo) && (
              <button type="button" className="rz-btn" disabled={m.busy} onClick={() => m.undo(job)}>
                {t("Undo")}
              </button>
            )}
          </div>
          <ResultList results={results} onOpen={open} />
        </div>
      )}

      {r?.answer_md?.trim() ? (
        <div className={"rz-ag-answer" + (job.status === "waiting" ? " is-ask" : "")}>
          <StaticAnswer text={r.answer_md} sources={r.sources ?? []} />
        </div>
      ) : null}
    </article>
  );
}

/** Context of a job for the composer chip: the entity the request names (first **bold** of the log), else none. */
function contextOf(job: JobView): string | null {
  for (const s of job.result?.steps ?? []) {
    const hit = labelParts(s.label).find((p) => p.kind === "strong" && !/\d/.test(p.text));
    if (hit) return hit.text;
  }
  return null;
}

/** "Antworten oder Auftrag ändern …": the answer to the agent's question or a changed request starts a follow-up job. */
function Composer({ m, job }: { m: AgentRuheModel; job: JobView }) {
  const [text, setText] = useState("");
  const ctx = contextOf(job);
  const cmd = ORBIT_COMMANDS.find((c) => c.id === AGENT_SKILL_INFO.find((x) => x.id === job.skill)?.command)?.cmd;
  const send = () => {
    if (!text.trim() || m.busy) return;
    m.reply(job, text);
    setText("");
  };
  return (
    <form
      className="rz-compose"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        className="rz-compose-in"
        rows={1}
        value={text}
        placeholder={t("Reply or change the request …")}
        aria-label={t("Reply or change the request …")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="rz-compose-bar">
        {ctx && (
          <span className="rz-cchip">
            <Ico name="paperclip" size={12} />
            {t("Context: {name}", { name: ctx })}
          </span>
        )}
        {cmd && <span className="rz-cchip">{cmd}</span>}
        <span className="rz-grow" />
        <button type="submit" className="rz-compose-send" disabled={!text.trim() || m.busy} aria-label={t("Send")}>
          <Ico name="send" size={14} />
        </button>
      </div>
    </form>
  );
}

function Start({ m }: { m: AgentRuheModel }) {
  return (
    <div className="rz-ag-start">
      <Pictogram kind="agent" idle className="kx-art-ruhe rz-ag-pic rz-ag-pic--idle" />
      <h1 className="rz-ag-title">{t("What should I take off your hands?")}</h1>
      <p className="rz-ag-prompt">
        {t("Write it into the Orbit-Bar below or pick a skill. The agent works in the background; finished results wait here and on Today.")}
      </p>
      <ul className="rz-skills">
        {AGENT_SKILL_INFO.map((sk) => (
          <li key={sk.id}>
            <button type="button" className="rz-skill" disabled={m.busy} onClick={() => m.pickSkill(sk)}>
              <Ico name={sk.icon} size={15} />
              <span className="rz-skill-t">
                <strong>{t(sk.label)}</strong>
                <span>{t(sk.help)}</span>
              </span>
              <kbd className="rz-kbd">{ORBIT_COMMANDS.find((c) => c.id === sk.command)?.cmd}</kbd>
            </button>
          </li>
        ))}
      </ul>
      {!m.live && <p className="rz-ag-note">{t("The agent needs an account (not available in mock mode)")}</p>}
    </div>
  );
}

function Orders({ m, formRef }: { m: AgentRuheModel; formRef: RefObject<HTMLInputElement | null> }) {
  const on = m.orders.filter((o) => o.enabled).length;
  return (
    <Group label={t("Standing orders")} count={m.orders.length ? t("{n} active", { n: on }) : undefined}>
      {m.orders.map((o) => (
        <div key={o.id} className={"rz-ag-row rz-ag-order" + (o.enabled ? "" : " is-off")}>
          <Clock aria-hidden size={15} strokeWidth={1.5} className="rz-ag-order-ic" />
          <span className="rz-ag-row-t">
            <span className="rz-ag-row-title">{scheduleLabel(o)}</span>
            <span className="rz-ag-row-sub">{o.prompt}</span>
          </span>
          <span className="rz-ag-order-acts">
            <button
              type="button"
              className="rz-icon"
              title={t("Delete")}
              aria-label={t("Delete standing order: {title}", { title: o.title })}
              onClick={() => m.deleteOrder(o)}
            >
              <Ico name="trash" size={13} />
            </button>
            <input type="checkbox" role="switch" className="kx-switch" checked={o.enabled} aria-label={o.title} onChange={() => m.toggleOrder(o)} />
          </span>
        </div>
      ))}
      {m.orderText !== null ? (
        <form
          className="rz-ag-order-new"
          onSubmit={(e) => {
            e.preventDefault();
            if (!m.busy) m.saveOrder((m.orderText ?? "").trim());
          }}
        >
          <input
            ref={formRef}
            className="rz-input"
            autoFocus
            value={m.orderText}
            placeholder={t("Every morning at 6 prepare the daily stack")}
            aria-label={t("New standing order")}
            onChange={(e) => m.setOrderText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && m.setOrderText(null)}
          />
          <button type="submit" className="rz-btn rz-btn--acc" disabled={m.busy || m.orderText.trim().length < 3}>
            {t("Create")}
          </button>
        </form>
      ) : (
        <button type="button" className="rz-ag-add" onClick={() => m.setOrderText("")}>
          <Ico name="plus" size={13} />
          {t("New standing order")}
        </button>
      )}
      {m.orders.length === 0 && m.orderText === null && (
        <p className="rz-ag-note">{t("None yet. Write “Every morning at 6 …” into the Orbit-Bar or use New. A standing order runs daily or weekly.")}</p>
      )}
    </Group>
  );
}

export function AgentRuhe({ m }: { m: AgentRuheModel }) {
  const ordersRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { today, earlier } = splitFinished(m.groups.finished, new Date());
  const list = [...m.groups.waiting, ...m.groups.running, ...today, ...earlier.slice(0, 12)];
  const latest = useRef({ list, m });
  latest.current = { list, m };

  // The page opens on what waits for you (mockup S.agent): once, the first waiting job is shown when none was asked for.
  const opened = useRef(false);
  const firstWaiting = m.groups.waiting[0]?.id;
  useEffect(() => {
    if (opened.current || !firstWaiting) return;
    opened.current = true;
    if (!latest.current.m.picked) latest.current.m.setPicked(firstWaiting);
  }, [firstWaiting]);

  // J / K walk the job list, Escape goes back to the skills.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { list, m } = latest.current;
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))) return;
      const k = e.key.toLowerCase();
      if (k === "escape" && m.picked) return void m.setPicked(null);
      if ((k !== "j" && k !== "k") || !list.length) return;
      const idx = list.findIndex((j) => j.id === m.picked);
      const to = k === "j" ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      m.setPicked(list[to]!.id);
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openOrders = () => {
    ordersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (m.orderText === null) m.setOrderText("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const rows = (l: JobView[]) => l.map((j) => <JobRow key={j.id} job={j} on={j.id === m.picked} onPick={() => m.setPicked(j.id)} />);

  return (
    <div className="rz-ag">
      <LocationBar
        icon="sparkles"
        crumbs={[{ label: "Agent", onClick: () => m.setPicked(null) }, { label: t("Jobs") }]}
        actions={
          <>
            <BarButton icon={<Clock aria-hidden size={14} strokeWidth={1.5} />} onClick={openOrders}>
              {t("Standing orders")}
            </BarButton>
            <span className="rz-ag-autonomy">
              <AutonomyMenu />
            </span>
          </>
        }
        more={
          <>
            <MenuItem onSelect={openOrders}>{t("New standing order")}</MenuItem>
            {m.picked && <MenuItem onSelect={() => m.setPicked(null)}>{t("All skills")}</MenuItem>}
          </>
        }
      />

      <div className="rz-ag-body">
        <nav className="rz-ag-list" aria-label={t("Jobs")}>
          {m.groups.waiting.length > 0 && (
            <Group label={t("Waiting for you")} count={m.groups.waiting.length}>
              {rows(m.groups.waiting)}
            </Group>
          )}
          {m.groups.running.length > 0 && (
            <Group label={t("Running")} count={m.groups.running.length}>
              {rows(m.groups.running)}
            </Group>
          )}
          {today.length > 0 && (
            <Group label={t("Done today")} count={today.length}>
              {rows(today)}
            </Group>
          )}
          {earlier.length > 0 && (
            <Group label={t("Earlier")} count={earlier.length}>
              {rows(earlier.slice(0, 12))}
            </Group>
          )}
          {m.loaded && m.jobs.length === 0 && <EmptyPic kind="agent" size="sm" idle>{t("No jobs yet. Pick a skill or hand a task to the agent on the board.")}</EmptyPic>}
          <div ref={ordersRef}>
            <Orders m={m} formRef={inputRef} />
          </div>
          <KbdHints
            className="rz-ag-keys"
            items={[
              { keys: ["J", "K"], label: t("next") },
              { keys: ["Esc"], label: t("All skills") },
            ]}
          />
        </nav>

        <main className="rz-ag-detail">
          {m.job ? <JobDetail key={m.job.id} m={m} job={m.job} /> : <Start m={m} />}
          {m.job && m.job.status !== "cancelled" && <Composer key={m.job.id} m={m} job={m.job} />}
        </main>
      </div>
    </div>
  );
}
