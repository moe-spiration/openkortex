"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { intlLocale, t, tn } from "@/i18n";
import { groupJobs, parseStandingOrder, scheduleLabel, type JobView, type StandingOrderView } from "@/lib/agent-jobs";
import { AGENT_SKILL_INFO, type AgentSkillInfo } from "@/lib/agent-skills";
import { AGENT_JOB_EVENT, AGENT_ORDER_EVENT, patchAgentJob, putAgentJob, useAgentJobs } from "@/lib/shell/agent-jobs-store";
import { useCopilotChat } from "@/lib/shell/copilot-chat";
import { ORBIT_COMMANDS } from "@/lib/shell/orbit";
import { useShell } from "@/lib/shell/store";
import { isLiveData } from "@/lib/workspace-data";
import { addStandingOrder, confirmAgentJob, dismissAgentJob, getAgentOverview, removeStandingOrder, startAgentJob, toggleStandingOrder, undoAgentJob } from "@/server/agent/actions";
import { ResultList, StaticAnswer, Steps, useOpenItem } from "@/components/shell/CopilotLive";
import { Ico } from "@/components/shell/icons";
import { Pictogram } from "@/components/motion/Pictogram";
import { EmptyPic } from "@/components/motion/EmptyPic";
import { AUTONOMY_LEVELS } from "@/components/shell/TargetMenu";
import { useLook } from "@/components/theme/look";
import { mockStandingOrders } from "@/lib/mock/agent";
import { AgentRuhe } from "./AgentRuhe";

/*
 * The agent's page (/agent): start a job that runs in the background, see what waits for a confirmation, what
 * runs and what is done, and keep standing orders ("Every morning at 6 …"). The work itself runs on the server
 * (server/agent); this page polls while a job is active.
 */

const skillOf = (id: string | null) => AGENT_SKILL_INFO.find((x) => x.id === id);

/** Clock time of a finished job today, else its short date. */
function doneAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(intlLocale(), { day: "numeric", month: "short" });
}

function statusLine(job: JobView): string {
  if (job.status === "queued") return t("Queued");
  if (job.status === "running") return t("Running …");
  if (job.status === "waiting") return t("Waits for your OK");
  if (job.status === "error") return t("Failed");
  if (job.result?.undone) return t("Undone");
  return t("Done");
}

function JobRow({ job, on, onPick }: { job: JobView; on: boolean; onPick: () => void }) {
  const active = job.status === "queued" || job.status === "running";
  const sk = skillOf(job.skill);
  return (
    <button type="button" className={"ag-row" + (on ? " is-on" : "")} onClick={onPick} aria-current={on || undefined}>
      <span className="ag-glyph" style={{ "--gc": sk?.tint ?? "#A5B4FC" } as CSSProperties} aria-hidden>
        {active ? <span className="kx-spinner" /> : <Ico name={job.status === "error" ? "x" : (sk?.icon ?? "sparkles")} size={14} />}
      </span>
      <span className="ag-row-t">
        <span className="kx-truncate">{job.title}</span>
        <span className="kx-meta kx-truncate">{job.origin === "standing" ? t("Standing order") + " · " + statusLine(job) : statusLine(job)}</span>
      </span>
      {job.status === "waiting" ? <span className="ag-wait">{t("waits for you")}</span> : !active && <span className="kx-meta kx-num">{doneAt(job.finishedAt)}</span>}
    </button>
  );
}

/** One job in full: the request, what the agent did, the answer and the changes to confirm or take back. */
function JobDetail({ job, busy, onConfirm, onDismiss, onUndo, onBack }: { job: JobView; busy: boolean; onConfirm: (picks: number[]) => void; onDismiss: () => void; onUndo: () => void; onBack: () => void }) {
  const open = useOpenItem();
  const [off, setOff] = useState<ReadonlySet<number>>(new Set());
  const r = job.result;
  const active = job.status === "queued" || job.status === "running";
  const labels = r?.proposal?.labels ?? [];
  const picked = labels.map((_, i) => i).filter((i) => !off.has(i));
  const results = r?.done?.results ?? [];
  return (
    <div className="ag-job">
      <div>
        <button type="button" className="kx-agent-link" onClick={onBack}>
          {t("All skills")}
        </button>
      </div>
      <p className="ag-bubble">{job.prompt}</p>
      {active && <Pictogram kind="agent" className="kx-art-ruhe" />}
      {active && (
        <p className="kx-agent-note ag-working">
          <span className="kx-spinner kx-art-classic" aria-hidden />
          {t("The agent is working. You can leave this page, the result waits here.")}
        </p>
      )}
      {job.status === "error" && <p className="ag-error">{t("This job failed: {error}", { error: job.error ?? t("unknown error") })}</p>}
      {r?.steps?.length ? <Steps steps={r.steps} running={false} /> : null}
      {r?.answer_md?.trim() ? <StaticAnswer text={r.answer_md} sources={r.sources ?? []} /> : null}
      {job.status === "waiting" && labels.length > 0 && (
        <div className="kx-agent-card" data-kind="proposal">
          <div className="kx-orbit-micro">{tn(labels.length, "{n} change waits for your OK", "{n} changes wait for your OK")}</div>
          <ul className="kx-agent-list">
            {labels.map((label, i) => (
              <li key={i}>
                <label className="kx-agent-check">
                  <input
                    type="checkbox"
                    checked={!off.has(i)}
                    disabled={busy}
                    onChange={() => {
                      const next = new Set(off);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      setOff(next);
                    }}
                  />
                  <span>{label}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="kx-agent-actions">
            <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" disabled={busy || !picked.length} onClick={() => onConfirm(picked)}>
              {busy ? t("Running …") : tn(picked.length, "Run {n} change", "Run {n} changes")}
            </button>
            <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" disabled={busy} onClick={onDismiss}>
              {t("Dismiss")}
            </button>
          </div>
        </div>
      )}
      {results.length > 0 && (
        <div className="kx-agent-card">
          <div className="kx-orbit-micro">{r?.undone ? t("Undone") : t("Done by the agent")}</div>
          <ResultList results={results} onOpen={open} />
          {!r?.undone && results.some((x) => x.undo) && (
            <div className="kx-agent-actions">
              <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" disabled={busy} onClick={onUndo}>
                {t("Undo")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentView() {
  const look = useLook();
  const live = isLiveData();
  const chat = useCopilotChat();
  const { showToast, setPrompt, setCmode, setPinned } = useShell();
  const { jobs, loaded } = useAgentJobs();
  const [orders, setOrders] = useState<StandingOrderView[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [orderText, setOrderText] = useState<string | null>(null);

  const fail = useCallback((error: string) => showToast(t("That did not work: {error}", { error })), [showToast]);

  const loadOrders = useCallback(() => {
    if (!live) return setOrders((old) => (old.length ? old : mockStandingOrders()));
    void getAgentOverview().then((r) => (r.ok ? setOrders(r.data.orders) : fail(r.error)));
  }, [live, fail]);

  // "/agent?job=<id>" (Home chip, toast) opens that job; the Orbit-Bar announces jobs and standing orders it started.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("job");
    if (id) setPicked(id);
    loadOrders();
    const onJob = (e: Event) => setPicked((e as CustomEvent<string>).detail);
    window.addEventListener(AGENT_JOB_EVENT, onJob);
    window.addEventListener(AGENT_ORDER_EVENT, loadOrders);
    return () => {
      window.removeEventListener(AGENT_JOB_EVENT, onJob);
      window.removeEventListener(AGENT_ORDER_EVENT, loadOrders);
    };
  }, [loadOrders]);

  const start = async (prompt: string, sk: AgentSkillInfo) => {
    if (!live) return showToast(t("The agent needs an account (not available in mock mode)"));
    setBusy(true);
    const r = await startAgentJob({ prompt, autonomy: chat.autonomy, skill: sk.id });
    setBusy(false);
    if (!r.ok) return fail(r.error);
    putAgentJob(r.data);
    setPicked(r.data.id);
  };

  /** A skill without a subject starts at once; the others put their command into the Orbit-Bar. */
  const pickSkill = (sk: AgentSkillInfo) => {
    if (sk.prompt) return void start(t(sk.prompt), sk);
    const cmd = ORBIT_COMMANDS.find((c) => c.id === sk.command)?.cmd ?? "";
    setPicked(null);
    setCmode("ask");
    setPinned(true);
    setPrompt(cmd + " ");
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".kx-orbit-field")?.focus());
  };

  const act = async (run: () => Promise<{ ok: true; data: JobView | null } | { ok: false; error: string }>, id: string, patch?: Partial<JobView>) => {
    setBusy(true);
    const r = await run();
    setBusy(false);
    if (!r.ok) return fail(r.error);
    if (r.data) putAgentJob(r.data);
    else if (patch) patchAgentJob(id, patch);
  };

  const saveOrder = async (sentence: string) => {
    if (!live) return showToast(t("The agent needs an account (not available in mock mode)"));
    if (!parseStandingOrder(sentence)) return showToast(t("Say when and what, e.g. “Every morning at 6 prepare the daily stack”"));
    setBusy(true);
    const r = await addStandingOrder(sentence);
    setBusy(false);
    if (!r.ok) return fail(r.error);
    setOrders((old) => [...old, r.data]);
    setOrderText(null);
    showToast(t("Standing order created"));
  };

  const toggleOrder = (o: StandingOrderView) => {
    setOrders((old) => old.map((x) => (x.id === o.id ? { ...x, enabled: !o.enabled } : x)));
    void toggleStandingOrder(o.id, !o.enabled).then((r) => {
      if (r.ok) return;
      setOrders((old) => old.map((x) => (x.id === o.id ? { ...x, enabled: o.enabled } : x)));
      fail(r.error);
    });
  };
  const deleteOrder = (o: StandingOrderView) => {
    setOrders((old) => old.filter((x) => x.id !== o.id));
    void removeStandingOrder(o.id).then((r) => {
      if (r.ok) return;
      setOrders((old) => [...old, o]);
      fail(r.error);
    });
  };

  /** Mock mode: the fixtures change in memory, so the page can be tried without an account. */
  const mockConfirm = (j: JobView, picks: number[]) => {
    const labels = j.result?.proposal?.labels ?? [];
    patchAgentJob(j.id, {
      status: "done",
      finishedAt: new Date().toISOString(),
      result: { ...j.result, proposal: undefined, done: { results: picks.map((i) => ({ ok: true, label: labels[i] ?? "", undo: true })) } },
    });
    showToast(tn(picks.length, "{n} change made", "{n} changes made"));
  };

  /** The composer under a job: the answer or a changed request starts a follow-up job with the same skill. */
  const reply = async (j: JobView, text: string) => {
    const said = text.trim();
    if (!said) return;
    if (!live) return showToast(t("The agent needs an account (not available in mock mode)"));
    setBusy(true);
    const r = await startAgentJob({ prompt: `${j.prompt}\n\n${said}`, title: j.title, autonomy: chat.autonomy, ...(j.skill ? { skill: j.skill as NonNullable<Parameters<typeof startAgentJob>[0]["skill"]> } : {}) });
    setBusy(false);
    if (!r.ok) return fail(r.error);
    putAgentJob(r.data);
    setPicked(r.data.id);
  };

  const groups = groupJobs(jobs);
  const job = jobs.find((j) => j.id === picked) ?? null;
  const group = (label: string, list: JobView[]) =>
    list.length > 0 && (
      <>
        <div className="ag-group">{label}</div>
        {list.map((j) => (
          <JobRow key={j.id} job={j} on={j.id === picked} onPick={() => setPicked(j.id)} />
        ))}
      </>
    );

  // Ruhe look: list left, job right (AgentRuhe); the state and actions stay here.
  if (look === "ruhe")
    return (
      <AgentRuhe
        m={{
          live,
          loaded,
          jobs,
          groups,
          orders,
          job,
          picked,
          busy,
          orderText,
          setPicked,
          setOrderText,
          pickSkill,
          confirm: (j, picks) => (live ? void act(() => confirmAgentJob(j.id, picks), j.id) : mockConfirm(j, picks)),
          dismiss: (j) =>
            live ? void act(() => dismissAgentJob(j.id), j.id, { status: "cancelled" }).then(() => setPicked(null)) : (patchAgentJob(j.id, { status: "cancelled" }), setPicked(null)),
          undo: (j) => (live ? void act(() => undoAgentJob(j.id), j.id) : patchAgentJob(j.id, { result: { ...j.result, undone: true } })),
          reply: (j, text) => void reply(j, text),
          saveOrder: (s) => void saveOrder(s),
          toggleOrder,
          deleteOrder,
        }}
      />
    );

  return (
    <div className="ag-page">
      <div className="ag-main">
        {job ? (
          <JobDetail
            key={job.id}
            job={job}
            busy={busy}
            onBack={() => setPicked(null)}
            onConfirm={(picks) => void act(() => confirmAgentJob(job.id, picks), job.id)}
            onDismiss={() => void act(() => dismissAgentJob(job.id), job.id, { status: "cancelled" }).then(() => setPicked(null))}
            onUndo={() => void act(() => undoAgentJob(job.id), job.id)}
          />
        ) : (
          <>
            <div className="ag-hero">
              <div className="kx-eyebrow">Agent</div>
              <h1 className="kx-h-page">{t("What should I take off your hands?")}</h1>
              <p className="kx-help">{t("Write it into the Orbit-Bar below or pick a skill. The agent works in the background; finished results wait here and on Today.")}</p>
            </div>
            <div className="ag-skills">
              {AGENT_SKILL_INFO.map((sk) => (
                <button key={sk.id} type="button" className="ag-skill" style={{ "--gc": sk.tint } as CSSProperties} disabled={busy} onClick={() => pickSkill(sk)}>
                  <span className="ag-glyph ag-glyph--lg" aria-hidden>
                    <Ico name={sk.icon} size={18} />
                  </span>
                  <strong>{t(sk.label)}</strong>
                  <span>{t(sk.help)}</span>
                  <span className="ag-cmd">{ORBIT_COMMANDS.find((c) => c.id === sk.command)?.cmd}</span>
                </button>
              ))}
            </div>
            <section className="ag-panel">
              <h2 className="ag-panel-t">{t("How much may the agent do?")}</h2>
              <div className="ag-levels" role="radiogroup" aria-label={t("The agent may")}>
                {AUTONOMY_LEVELS.map((l) => (
                  <button key={l.id} type="button" role="radio" aria-checked={chat.autonomy === l.id} className={chat.autonomy === l.id ? "is-on" : ""} onClick={() => chat.setAutonomy(l.id)}>
                    <Ico name={l.icon} size={16} />
                    <strong>{l.label()}</strong>
                    <span>{l.help()}</span>
                  </button>
                ))}
              </div>
            </section>
            {!live && <p className="kx-agent-note">{t("The agent needs an account (not available in mock mode)")}</p>}
          </>
        )}
      </div>

      <aside className="ag-rail">
        <section className="ag-panel">
          <div className="ag-panel-h">
            <h2 className="ag-panel-t">{t("Jobs")}</h2>
            <span className="ag-grow" />
            {groups.running.length > 0 && <span className="kx-meta kx-num">{t("{n} running", { n: groups.running.length })}</span>}
          </div>
          {group(t("Waiting for you"), groups.waiting)}
          {group(t("Running"), groups.running)}
          {group(t("Done"), groups.finished.slice(0, 12))}
          {loaded && jobs.length === 0 && (
            <EmptyPic kind="agent" size="sm" idle classic={<p className="kx-agent-note">{t("No jobs yet. Pick a skill or hand a task to the agent on the board.")}</p>}>
              {t("No jobs yet. Pick a skill or hand a task to the agent on the board.")}
            </EmptyPic>
          )}
        </section>

        <section className="ag-panel">
          <div className="ag-panel-h">
            <h2 className="ag-panel-t">{t("Standing orders")}</h2>
            <span className="ag-grow" />
            <button type="button" className="ag-new" onClick={() => setOrderText(orderText === null ? "" : null)}>
              {orderText === null && <Ico name="plus" size={14} />}
              {orderText === null ? t("New") : t("Cancel")}
            </button>
          </div>
          {orderText !== null && (
            <form
              className="ag-order-new"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy) void saveOrder(orderText.trim());
              }}
            >
              <input className="ag-input" autoFocus value={orderText} placeholder={t("Every morning at 6 prepare the daily stack")} aria-label={t("New standing order")} onChange={(e) => setOrderText(e.target.value)} />
              <button type="submit" className="kx-btn kx-btn--primary kx-btn--sm" disabled={busy || orderText.trim().length < 3}>
                {t("Create")}
              </button>
            </form>
          )}
          {orders.map((o) => (
            <div key={o.id} className={"ag-order" + (o.enabled ? "" : " is-off")}>
              <span className="ag-glyph" style={{ "--gc": "#C4B5FD" } as CSSProperties} aria-hidden>
                <Ico name={o.cadence === "daily" ? "sun" : "calendar"} size={14} />
              </span>
              <span className="ag-row-t">
                <span className="kx-truncate">{scheduleLabel(o)}</span>
                <span className="kx-meta ag-order-p">{o.prompt}</span>
              </span>
              <button type="button" className="ag-icon" title={t("Delete")} aria-label={t("Delete standing order: {title}", { title: o.title })} onClick={() => deleteOrder(o)}>
                <Ico name="trash" size={14} />
              </button>
              <input type="checkbox" role="switch" className="kx-switch" checked={o.enabled} aria-label={o.title} onChange={() => toggleOrder(o)} />
            </div>
          ))}
          {orders.length === 0 && orderText === null && <p className="kx-agent-note">{t("None yet. Write “Every morning at 6 …” into the Orbit-Bar or use New. A standing order runs daily or weekly.")}</p>}
        </section>
      </aside>
    </div>
  );
}
