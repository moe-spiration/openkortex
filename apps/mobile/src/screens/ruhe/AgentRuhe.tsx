import { t, tn } from "../../i18n";
import { useMemo, useState } from "react";
import { Platform, Pressable, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { demoJobs, demoOrders } from "../../data/demoAgent";
import { groupJobs, isStale, looksLikeStandingOrder, type JobView, type StandingOrderView } from "../../lib/agentJobs";
import { tick } from "../../lib/haptics";
import { runAgentOp, useAgentJobs } from "../../state/agentJobs";
import { useApp } from "../../state/AppState";
import { useData } from "../../state/Data";
import { useTheme } from "../../theme/ThemeProvider";
import { FONT } from "../../theme/tokens";
import { Icon, type IconName } from "../../ui/Icon";
import { Spinner, T } from "../../ui/primitives";
import { ScreenScroll } from "../../ui/Screen";
import { AUTONOMY_LABEL, scheduleLabel, when } from "../agentShared";
import { useGesturePlay } from "../../ui/ruhe/gestures";
import { DetailHeader, EmptyState, Pictogram, GroupHead, KindLine, RButton, RButtonRow, RCheck, RGroup, RGroupRow, RRow, RSegment, RToggle, RuheLocBar, StatusRing } from "../../ui/ruhe";
import { RUHE_SPACE } from "../../theme/tokens";

const PAD = { text: RUHE_SPACE.page, surface: RUHE_SPACE.surface };
const NO_OUTLINE = Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null;
const TNUM = { fontVariant: ["tabular-nums" as const] };

/*
 * Agent, Ruhe (mockup "Agent · hell" in mobil2, android-richtlinien.md 8 A / 8 B / 12): the page lists the jobs as calm
 * rows with a status ring (waiting, running, done today) and the standing orders with a toggle; a job opens as its own
 * detail page with a back link, the status line, the title, the step log, the changes to confirm as a contoured
 * group with square checks, and one primary button. Jobs / Ask is a full-width segment under the title (the title
 * never breaks next to it). Without an account the page shows demo jobs, so the flow can be tried.
 */

type JobState = "waiting" | "running" | "done" | "error";
const STEP_ICON: Record<string, IconName> = { search: "search", read: "book", write: "note" };

function stateOf(job: JobView, now: Date): JobState {
  if ((job.status === "queued" || job.status === "running") && !isStale(job, now)) return "running";
  if (job.status === "waiting") return "waiting";
  if (job.status === "error" || isStale(job, now)) return "error";
  return "done";
}

function statusText(job: JobView, state: JobState): string {
  if (state === "running") return job.status === "queued" ? t("Queued") : t("Running …");
  if (state === "waiting") return t("Waits for your OK");
  if (state === "error") return t("Failed");
  return job.result?.undone ? t("Undone") : t("Done");
}

/** Agent segment of the agent tab: Jobs | Ask, full width under the title (guidelines 12, two-way switch). */
export function AgentSeg({ cur }: { cur: "jobs" | "ask" }) {
  const router = useRouter();
  return (
    <RSegment
      style={{ marginTop: 2, marginHorizontal: PAD.surface }}
      label={t("Agent")}
      value={cur}
      onChange={(k) => k !== cur && router.replace((k === "ask" ? "/ask" : "/agent") as never)}
      items={[
        { key: "jobs", label: t("Jobs"), icon: "list" },
        { key: "ask", label: t("Ask"), icon: "msg" },
      ]}
    />
  );
}

export function AgentRuhe() {
  const th = useTheme();
  const [sendPlay, fireSend] = useGesturePlay();
  const a = useApp();
  const d = useData();
  const live = d.auth === "live";
  const s = useAgentJobs(live);
  // Without an account: demo jobs, kept locally so confirming and dismissing can be tried.
  const [demo, setDemo] = useState(() => ({ jobs: demoJobs(), orders: demoOrders() }));
  const jobs = live ? s.jobs : demo.jobs;
  const orders = live ? s.orders : demo.orders;
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const g = groupJobs(jobs);
  const today = now.toDateString();
  const doneToday = g.finished.filter((j) => new Date(j.finishedAt ?? j.createdAt).toDateString() === today);
  const open = openId ? jobs.find((j) => j.id === openId) : undefined;


  const report = (error: string | null, ok?: string) => (error ? a.say(t("That did not work: {error}", { error })) : ok && a.say(ok));
  /** One job operation; in demo mode it changes the local demo list the way the server would. */
  const op = async (body: Parameters<typeof runAgentOp>[0], ok: string) => {
    if (!live) {
      setDemo((x) => ({
        ...x,
        jobs: x.jobs.map((j) => (body.op !== "order_add" && body.op !== "order_toggle" && body.op !== "order_remove" && "id" in body && j.id === body.id ? { ...j, status: body.op === "dismiss" ? "cancelled" : "done", result: { ...j.result, proposal: undefined, done: body.op === "confirm" ? { results: (j.result?.proposal?.labels ?? []).map((label) => ({ ok: true, label })) } : undefined } } : j)),
      }));
      report(null, ok);
      return;
    }
    const r = await runAgentOp(body);
    report(r.error, ok);
  };

  const submit = async () => {
    const v = text.trim();
    if (v.length < 3 || busy) return;
    if (!live) return a.say(t("The agent needs an account (not available in mock mode)"));
    setBusy(true);
    const order = looksLikeStandingOrder(v);
    const r = await runAgentOp(order ? { op: "order_add", text: v } : { op: "start", prompt: v, autonomy: a.autonomy });
    setBusy(false);
    if (!r.error) setText("");
    report(r.error, order ? t("Standing order created") : t("The agent is working. You can leave this page, the result waits here."));
  };
  const pickAutonomy = () =>
    a.openMenu({
      title: t("What may the agent do?"),
      items: [
        { label: `${AUTONOMY_LABEL.read()} · ${t("Searches and answers, changes nothing")}`, icon: "eye", run: () => a.setAutonomy("read") },
        { label: `${AUTONOMY_LABEL.ask()} · ${t("Proposes changes, you confirm them")}`, icon: "check", run: () => a.setAutonomy("ask") },
        { label: `${AUTONOMY_LABEL.self()} · ${t("Makes changes at once, you can undo them")}`, icon: "bolt", run: () => a.setAutonomy("self") },
      ],
    });
  const toggleOrder = (o: StandingOrderView) => {
    if (!live) return setDemo((x) => ({ ...x, orders: x.orders.map((y) => (y.id === o.id ? { ...y, enabled: !y.enabled } : y)) }));
    void runAgentOp({ op: "order_toggle", id: o.id, enabled: !o.enabled }).then((r) => report(r.error));
  };
  const removeOrder = (o: StandingOrderView) =>
    a.openMenu({
      title: o.title,
      items: [
        {
          label: t("Delete standing order: {title}", { title: o.title }),
          icon: "trash",
          danger: true,
          run: () => (live ? void runAgentOp({ op: "order_remove", id: o.id }).then((r) => report(r.error, t("Deleted"))) : setDemo((x) => ({ ...x, orders: x.orders.filter((y) => y.id !== o.id) }))),
        },
      ],
    });

  if (open) return <JobPage job={open} now={now} onBack={() => setOpenId(null)} op={op} />;

  const order = looksLikeStandingOrder(text);
  const jobRows = (list: JobView[]) =>
    list.map((j, i) => {
      const st = stateOf(j, now);
      const steps = j.result?.steps?.length ?? 0;
      const sub = st === "waiting" && j.result?.proposal?.labels.length ? tn(j.result.proposal.labels.length, "Confirm {n} change", "Confirm {n} changes") : `${statusText(j, st)}${j.origin === "standing" ? ` · ${t("Standing order")}` : ""}${st === "running" && steps ? ` · ${tn(steps, "{n} step", "{n} steps")}` : ""}`;
      return (
        <RRow
          key={j.id}
          first={i === 0}
          titleWeight={400}
          lead={<StatusRing state={st} />}
          title={j.title}
          titleColor={st === "done" ? th.t2 : th.t1}
          sub={sub}
          subColor={st === "waiting" ? th.accentInk : st === "error" ? th.crit : th.t3}
          meta={when(j.finishedAt ?? j.startedAt ?? j.createdAt)}
          chevron
          onPress={() => setOpenId(j.id)}
        />
      );
    });

  return (
    <ScreenScroll flush padTop={0}>
      <RuheLocBar title={t("Agent")} actions={[{ icon: "more", label: t("More"), onPress: pickAutonomy }]} />
      <AgentSeg cur="jobs" />

      <View style={{ marginHorizontal: PAD.surface, marginTop: 12, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 12, gap: 10, borderRadius: 16, backgroundColor: th.name === "dark" ? th.lum2 : th.lum1, boxShadow: th.name === "dark" ? undefined : `0 0 0 1px ${th.hairStrong}` }}>
        <TextInput
          accessibilityLabel={t("Job for the agent")}
          placeholder={t("What should I take off your hands?")}
          placeholderTextColor={th.t4}
          selectionColor={th.accent}
          value={text}
          onChangeText={setText}
          multiline
          style={[{ minHeight: 48, padding: 0, fontFamily: FONT.sans400, fontSize: 16, lineHeight: 24, color: th.t1, textAlignVertical: "top" }, NO_OUTLINE]}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Agent: {level}", { level: AUTONOMY_LABEL[a.autonomy]() })} onPress={pickAutonomy} hitSlop={{ top: 8, bottom: 8 }} style={{ height: 28, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, borderRadius: 8, backgroundColor: th.name === "dark" ? th.lum3 : th.lum2 }}>
            <Icon name={a.autonomy === "read" ? "eye" : a.autonomy === "ask" ? "check" : "bolt"} size={12} color={th.t2} />
            <T size={12.5} lh={16} ls={0} weight={400} color={th.t2}>
              {AUTONOMY_LABEL[a.autonomy]()}
            </T>
          </Pressable>
          {order && (
            <T size={12.5} lh={16} ls={0} weight={400} color={th.t3} numberOfLines={1} style={{ flexShrink: 1 }}>
              {t("Standing order")}
            </T>
          )}
          <View style={{ flex: 1 }} />
          <Pressable accessibilityRole="button" accessibilityLabel={order ? t("Standing order") : t("Start in the background")} disabled={busy} onPress={() => (fireSend(), void submit())} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: text.trim().length >= 3 ? th.accentFill : th.name === "dark" ? th.lum3 : th.lum2, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
            {busy ? <Spinner color={th.onAccent} /> : <Icon name={order ? "time" : "send"} size={17} play={sendPlay} color={text.trim().length >= 3 ? th.onAccent : th.t3} />}
          </Pressable>
        </View>
      </View>

      {!s.loaded && live ? (
        <View style={{ paddingVertical: 28, alignItems: "center" }}>
          <Spinner />
        </View>
      ) : (
        <>
          {g.waiting.length > 0 && <GroupHead label={t("Waiting for you")} count={g.waiting.length} />}
          {jobRows(g.waiting)}
          {g.running.length > 0 && <GroupHead label={t("Running")} count={g.running.length} />}
          {jobRows(g.running)}
          {doneToday.length > 0 && <GroupHead label={t("Done today")} count={doneToday.length} />}
          {jobRows(doneToday)}
          {!g.waiting.length && !g.running.length && !doneToday.length && <EmptyState icon="sparkles" pic="agent" idle size="md" title={t("No jobs yet")} help={t("Start one above or hand a task to the agent from the task list.")} />}

          <GroupHead label={t("Standing orders")} count={orders.length ? tn(orders.filter((o) => o.enabled).length, "{n} active", "{n} active") : undefined} />
          {!orders.length && (
            <T size={12.5} lh={18} ls={0} weight={400} color={th.t3} style={{ paddingHorizontal: PAD.text }}>
              {t("None yet. A standing order runs by itself, daily or weekly. Type one above, e.g. “Every morning at 6 prepare the daily stack”.")}
            </T>
          )}
          {orders.map((o, i) => (
            <RRow key={o.id} first={i === 0} titleWeight={400} icon="time" title={o.prompt} titleColor={o.enabled ? th.t1 : th.t3} sub={scheduleLabel(o)} trailing={<RToggle on={o.enabled} label={o.prompt} onPress={() => toggleOrder(o)} />} onPress={() => toggleOrder(o)} onLongPress={() => removeOrder(o)} />
          ))}
        </>
      )}
    </ScreenScroll>
  );
}

/**
 * One job as a detail page (guidelines 8 B, mockup mobil2 "Agent · hell"): back link, status line with the ring, title
 * 24/700, the step log, the answer, the changes to confirm in a contoured group, then Apply (primary) and Dismiss.
 */
function JobPage({ job, now, onBack, op }: { job: JobView; now: Date; onBack: () => void; op: (body: Parameters<typeof runAgentOp>[0], ok: string) => Promise<void> }) {
  const th = useTheme();
  const a = useApp();
  const st = stateOf(job, now);
  const r = job.result;
  const labels = useMemo(() => r?.proposal?.labels ?? [], [r]);
  const [skip, setSkip] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const picks = labels.map((_, i) => i).filter((i) => !skip.includes(i));
  const results = r?.done?.results ?? [];
  const canUndo = job.status === "done" && !r?.undone && results.some((x) => x.ok && x.undo !== undefined);
  const run = async (body: Parameters<typeof runAgentOp>[0], ok: string) => {
    setBusy(true);
    await op(body, ok);
    setBusy(false);
  };
  const started = when(job.startedAt ?? job.createdAt);
  return (
    <ScreenScroll flush padTop={0}>
      <DetailHeader backLabel={t("Agent")} onBack={onBack} status={<KindLine ring={st === "running" ? "running" : st} text={`${statusText(job, st)} · ${started}`} color={st === "waiting" ? th.accentInk : st === "error" ? th.crit : th.t3} />} title={job.title} subtitle={job.origin === "standing" ? t("Standing order") : undefined} />
      {/* Agent arbeitet: the pictogram, large while nothing is logged yet, small above the growing log. */}
      {st === "running" && <Pictogram kind="agent" size={r?.steps?.length ? "sm" : "md"} style={{ marginTop: 8, marginBottom: 8 }} />}
      {!!r?.steps?.length &&
        r.steps.map((s, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 7, paddingHorizontal: PAD.text }}>
            <View style={{ paddingTop: 2 }}>
              <Icon name={STEP_ICON[s.kind] ?? "note"} size={15} color={th.t3} />
            </View>
            <T size={14} lh={20} ls={0} weight={400} color={th.t2} style={{ flex: 1 }} numberOfLines={2}>
              {s.label}
              {s.count ? (
                <T size={14} lh={20} ls={0} weight={500} color={th.t1} style={TNUM}>
                  {`  ${s.count}`}
                </T>
              ) : null}
            </T>
          </View>
        ))}
      {st === "running" && !r?.steps?.length && (
        <T size={14} lh={20} ls={0} weight={400} color={th.t3} align="center" style={{ paddingHorizontal: PAD.text }}>
          {t("Running …")}
        </T>
      )}

      {!!r?.answer_md && (
        <T size={15} lh={22} ls={0} weight={400} color={th.t1} style={{ paddingHorizontal: PAD.text, paddingTop: 12 }}>
          {r.answer_md}
        </T>
      )}
      {st === "error" && (
        <T size={12.5} lh={18} ls={0} weight={400} color={th.crit} style={{ paddingHorizontal: PAD.text, paddingTop: 12 }}>
          {t("This job failed: {error}", { error: job.error ?? t("unknown error") })}
        </T>
      )}

      {job.status === "waiting" && labels.length > 0 && (
        <>
          <GroupHead label={t("Confirm")} count={picks.length} />
          <RGroup>
            {labels.map((l, i) => {
              const on = !skip.includes(i);
              const flip = () => setSkip((sk) => (on ? [...sk, i] : sk.filter((x) => x !== i)));
              const add = /^(task|aufgabe)\b/i.test(l);
              const edit = /^(dossier|akte|edit|ergänz)/i.test(l);
              return <RGroupRow key={i} first={i === 0} icon={add ? "plus" : edit ? "pencil" : "link"} iconColor={add ? th.ok : th.t3} label={l} trailing={<RCheck on={on} label={l} onPress={flip} />} onPress={() => (tick(), flip())} />;
            })}
          </RGroup>
        </>
      )}

      {results.length > 0 && (
        <>
          <GroupHead label={t("Done")} count={results.filter((x) => x.ok).length} />
          {results.map((x, i) => (
            <RRow key={i} first={i === 0} titleWeight={400} icon={x.ok ? "check" : "x"} iconColor={x.ok ? th.ok : th.crit} title={x.error ? `${x.label}: ${x.error}` : x.label} titleColor={r?.undone ? th.t3 : th.t1} onPress={x.item_id ? () => a.openEntry(x.item_id!) : undefined} />
          ))}
        </>
      )}

      {!!r?.sources?.length && (
        <>
          <GroupHead label={t("Sources")} count={r.sources.length} />
          {r.sources.slice(0, 8).map((src, i) => (
            <RRow key={src.item_id} first={i === 0} titleWeight={400} icon="fileText" title={src.title} chevron onPress={() => a.openEntry(src.item_id)} />
          ))}
        </>
      )}

      {busy ? (
        <View style={{ padding: PAD.surface }}>
          <Spinner />
        </View>
      ) : job.status === "waiting" ? (
        <RButtonRow style={{ marginTop: 16 }}>
          <RButton variant="primary" grow label={labels.length ? t("Apply") : t("Done")} onPress={() => (labels.length > 0 && !picks.length ? a.say(t("Pick at least one change")) : void run({ op: "confirm", id: job.id, ...(skip.length ? { picks } : null) }, t("Done by the agent")))} />
          <RButton label={t("Dismiss")} onPress={() => void run({ op: "dismiss", id: job.id }, t("Proposal discarded"))} />
        </RButtonRow>
      ) : canUndo ? (
        <RButtonRow style={{ marginTop: 12 }}>
          <RButton variant="ghost" size="sm" label={t("Undo")} onPress={() => void run({ op: "undo", id: job.id }, t("Undone"))} />
        </RButtonRow>
      ) : null}
    </ScreenScroll>
  );
}
