import { intlLocale, t, tn } from "../i18n";
import { useState, type ReactNode } from "react";
import { Platform, Pressable, TextInput, View } from "react-native";
import { groupJobs, isStale, looksLikeStandingOrder, type JobView, type StandingOrderView } from "../lib/agentJobs";
import type { Autonomy } from "../lib/agent";
import { runAgentOp, useAgentJobs } from "../state/agentJobs";
import { useApp } from "../state/AppState";
import { useData } from "../state/Data";
import { useTheme } from "../theme/ThemeProvider";
import { FONT, RADIUS } from "../theme/tokens";
import { Icon } from "../ui/Icon";
import { Btn, Help, Micro, Section, Spinner, T } from "../ui/primitives";
import { ScreenScroll } from "../ui/Screen";
import { AgentSwitch } from "../ui/AgentSwitch";

/*
 * The agent's page on the phone (like the web /agent page and the approved preview): give it a job that runs in the
 * background, see what waits for your OK, what runs and what is done today, and the standing orders ("Jeden Morgen
 * um 6 …"), which run by themselves. Same server functions as the web (GET/POST /api/mobile/agent).
 */

const AUTONOMY_LABEL: Record<Autonomy, () => string> = {
  read: () => t("Read only"),
  ask: () => t("Ask first"),
  self: () => t("On its own"),
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale(), { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "");

/** "Täglich um 06:00" / "Sonntags um 18:00". */
function scheduleLabel(o: Pick<StandingOrderView, "cadence" | "hour" | "weekday">): string {
  const hour = `${String(o.hour).padStart(2, "0")}:00`;
  if (o.cadence === "daily" || !o.weekday) return t("Daily at {hour}", { hour });
  const weekday = new Intl.DateTimeFormat(intlLocale(), { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, o.weekday)));
  return t("Every {weekday} at {hour}", { weekday, hour });
}

export function Agent() {
  const th = useTheme();
  const a = useApp();
  const d = useData();
  const live = d.auth === "live";
  const s = useAgentJobs(live);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const g = groupJobs(s.jobs);
  const today = now.toDateString();
  const doneToday = g.finished.filter((j) => new Date(j.finishedAt ?? j.createdAt).toDateString() === today);

  const report = (error: string | null, ok?: string) => (error ? a.say(t("That did not work: {error}", { error })) : ok && a.say(ok));

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

  return (
    <ScreenScroll gap={18}>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T type="h3">Agent</T>
          </View>
          <AgentSwitch cur="jobs" />
        </View>
        <Help>{t("The agent works in the background, also while Kortex is closed. Results wait here until you confirm them.")}</Help>
      </View>

      <View style={{ gap: 10, padding: 14, borderRadius: RADIUS.card, backgroundColor: th.bgSurfaceFlat }}>
        <Micro>{t("What should I take off your hands?")}</Micro>
        <TextInput
          accessibilityLabel={t("Job for the agent")}
          placeholder={t("Describe the job, or a standing order like “Every Sunday at 18 draft my weekly review”")}
          placeholderTextColor={th.textMuted}
          value={text}
          onChangeText={setText}
          multiline
          style={[{ minHeight: 72, padding: 0, fontFamily: FONT.sans400, fontSize: 14, lineHeight: 20, color: th.textPrimary, textAlignVertical: "top" }, Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null]}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Agent: {level}", { level: AUTONOMY_LABEL[a.autonomy]() })} onPress={pickAutonomy} style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: a.autonomy === "read" ? th.bgSurfaceMuted : th.accentAiSoft }}>
            <Icon name={a.autonomy === "read" ? "eye" : a.autonomy === "ask" ? "check" : "bolt"} size={14} color={a.autonomy === "read" ? th.textSecondary : th.tags.ai.fg} />
            <T size={12} lh={18} ls={0} color={a.autonomy === "read" ? th.textSecondary : th.tags.ai.fg}>
              {AUTONOMY_LABEL[a.autonomy]()}
            </T>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Btn variant="primary" sm minHeight={40} icon={looksLikeStandingOrder(text) ? "time" : "send"} onPress={() => void submit()}>
            {looksLikeStandingOrder(text) ? t("Standing order") : t("Start in the background")}
          </Btn>
        </View>
      </View>

      {!s.loaded && live ? (
        <Spinner />
      ) : (
        <>
          <Group title={t("Waiting for you")} count={g.waiting.length}>
            {g.waiting.map((j) => (
              <JobCard key={j.id} job={j} now={now} report={report} />
            ))}
          </Group>
          <Group title={t("Running")} count={g.running.length}>
            {g.running.map((j) => (
              <JobCard key={j.id} job={j} now={now} report={report} />
            ))}
          </Group>
          <Group title={t("Done today")} count={doneToday.length}>
            {doneToday.map((j) => (
              <JobCard key={j.id} job={j} now={now} report={report} />
            ))}
          </Group>
          {!g.waiting.length && !g.running.length && !doneToday.length && <Help>{t("No jobs yet. Start one above or hand a task to the agent from the task list.")}</Help>}
          <Orders orders={s.orders} report={report} />
        </>
      )}
    </ScreenScroll>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const th = useTheme();
  if (!count) return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Section>{title}</Section>
        <T num size={13} lh={18} ls={0} color={th.textMuted}>
          {String(count)}
        </T>
      </View>
      {children}
    </View>
  );
}

function JobCard({ job, now, report }: { job: JobView; now: Date; report: (error: string | null, ok?: string) => void }) {
  const th = useTheme();
  const a = useApp();
  const [open, setOpen] = useState(job.status === "waiting");
  const [busy, setBusy] = useState(false);
  const stale = isStale(job, now);
  const running = (job.status === "queued" || job.status === "running") && !stale;
  const r = job.result;
  const results = r?.done?.results ?? [];
  const canUndo = job.status === "done" && !r?.undone && results.some((x) => x.ok && x.undo !== undefined);
  const op = async (body: Parameters<typeof runAgentOp>[0], ok: string) => {
    setBusy(true);
    const res = await runAgentOp(body);
    setBusy(false);
    report(res.error, ok);
  };
  const status = running ? (job.status === "queued" ? t("Queued") : t("Running …")) : job.status === "waiting" ? t("Waits for your OK") : job.status === "error" || stale ? t("Failed") : r?.undone ? t("Undone") : t("Done");
  return (
    <View style={{ gap: 8, padding: 14, borderRadius: RADIUS.card, backgroundColor: job.status === "waiting" ? th.accentAiSoft : th.bgSurfaceFlat }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {running ? <Spinner /> : <Icon name={job.status === "error" || stale ? "x" : job.status === "waiting" ? "sparkles" : "check"} size={14} color={job.status === "error" || stale ? th.statusUrgentText : job.status === "waiting" ? th.tags.ai.fg : th.statusSynced} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          <T size={14} lh={20} weight={500} numberOfLines={open ? 3 : 1}>
            {job.title}
          </T>
          <Help numberOfLines={1}>{`${status} · ${when(job.finishedAt ?? job.startedAt ?? job.createdAt)}${job.origin === "standing" ? ` · ${t("Standing order")}` : ""}`}</Help>
        </View>
        <Icon name="chev" size={12} color={th.textMuted} rotate={open ? 90 : 0} />
      </Pressable>
      {open && (
        <View style={{ gap: 8 }}>
          {!!r?.answer_md && (
            <T size={13.5} lh={20} color={th.textSecondary} numberOfLines={12}>
              {r.answer_md}
            </T>
          )}
          {(job.status === "error" || stale) && <Help>{t("This job failed: {error}", { error: job.error ?? t("unknown error") })}</Help>}
          {job.status === "waiting" && !!r?.proposal?.labels.length && (
            <View style={{ gap: 4 }}>
              {r.proposal.labels.map((l, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ width: 5, height: 5, marginTop: 8, borderRadius: 3, backgroundColor: th.accentAi }} />
                  <T size={13.5} lh={20} style={{ flex: 1 }}>
                    {l}
                  </T>
                </View>
              ))}
            </View>
          )}
          {results.length > 0 && (
            <View style={{ gap: 4 }}>
              {results.map((x, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                  <Icon name={x.ok ? "check" : "x"} size={13} color={x.ok ? th.statusSynced : th.statusUrgentText} />
                  <T size={13} lh={19} style={{ flex: 1, textDecorationLine: r?.undone && x.ok ? "line-through" : "none" }} color={x.ok ? th.textPrimary : th.textSecondary} onPress={x.item_id ? () => a.openEntry(x.item_id!) : undefined}>
                    {x.error ? `${x.label}: ${x.error}` : x.label}
                  </T>
                </View>
              ))}
            </View>
          )}
          {!!r?.sources?.length && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {r.sources.slice(0, 6).map((src) => (
                <Pressable key={src.item_id} accessibilityRole="button" onPress={() => a.openEntry(src.item_id)} style={{ minHeight: 32, justifyContent: "center", paddingHorizontal: 10, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }}>
                  <T size={12} lh={16} ls={0} numberOfLines={1} color={th.textSecondary} style={{ maxWidth: 200 }}>
                    {src.title}
                  </T>
                </Pressable>
              ))}
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {busy && <Spinner />}
            {!busy && job.status === "waiting" && (
              <>
                <Btn variant="primary" sm icon="check" onPress={() => void op({ op: "confirm", id: job.id }, t("Done by the agent"))}>
                  {r?.proposal?.labels.length ? tn(r.proposal.labels.length, "Run {n} change", "Run {n} changes") : t("Done")}
                </Btn>
                <Btn variant="ghost" sm onPress={() => void op({ op: "dismiss", id: job.id }, t("Proposal discarded"))}>
                  {t("Dismiss")}
                </Btn>
              </>
            )}
            {!busy && canUndo && (
              <Btn variant="ghost" sm onPress={() => void op({ op: "undo", id: job.id }, t("Undone"))}>
                {t("Undo")}
              </Btn>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

function Orders({ orders, report }: { orders: StandingOrderView[]; report: (error: string | null, ok?: string) => void }) {
  const th = useTheme();
  const a = useApp();
  return (
    <View style={{ gap: 8 }}>
      <Section>{t("Standing orders")}</Section>
      {!orders.length && <Help>{t("None yet. A standing order runs by itself, daily or weekly. Type one above, e.g. “Every morning at 6 prepare the daily stack”.")}</Help>}
      {orders.map((o) => (
        <Pressable
          key={o.id}
          accessibilityRole="switch"
          accessibilityState={{ checked: o.enabled }}
          onPress={() => void runAgentOp({ op: "order_toggle", id: o.id, enabled: !o.enabled }).then((r) => report(r.error))}
          onLongPress={() =>
            a.openMenu({
              title: o.title,
              items: [{ label: t("Delete standing order: {title}", { title: o.title }), icon: "trash", run: () => void runAgentOp({ op: "order_remove", id: o.id }).then((r) => report(r.error, t("Deleted"))) }],
            })
          }
          style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceFlat, opacity: o.enabled ? 1 : 0.6 }}
        >
          <Icon name="time" size={15} color={o.enabled ? th.tags.ai.fg : th.textMuted} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T size={14} lh={20} numberOfLines={2}>
              {o.prompt}
            </T>
            <Help>{scheduleLabel(o)}</Help>
          </View>
          <View style={{ width: 40, height: 24, borderRadius: 12, padding: 2, backgroundColor: o.enabled ? th.accentAi : th.bgSurfaceMuted, alignItems: o.enabled ? "flex-end" : "flex-start" }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#FFFFFF" }} />
          </View>
        </Pressable>
      ))}
    </View>
  );
}
