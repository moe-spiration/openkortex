import { t, tn, tx } from "../i18n";
import { useRouter } from "expo-router";
import { runAgentOp } from "../state/agentJobs";
import { useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Share, TextInput, View, type ViewStyle } from "react-native";
import { dueLabel, type TaskRow } from "../data/live";
import { shareMessage, stageLabel, stageOf, STAGES, stageUpdate, taskMeta, TIMEFRAMES, timeframeLabel, toExportTask, type ShareFormat, type Stage } from "../data/tasks";
import { useApp } from "../state/AppState";
import { useData } from "../state/Data";
import { useTheme } from "../theme/ThemeProvider";
import { FONT, RADIUS } from "../theme/tokens";
import { Icon } from "./Icon";
import { Help, Micro, T } from "./primitives";
import { SwipeRow } from "./SwipeRow";

/*
 * Aufgaben (kortex.action_items): tap the circle or swipe right to complete, swipe left on a done
 * task to reopen, long-press for the menu, quick-add at the bottom. Optimistic; errors roll back.
 * Rich fields (project, timeframe, context) are edited inline ("Details" in the menu); the header
 * shares open tasks as Markdown or CSV text through the system share sheet and marks them "überführt".
 * Status board (like the web hub): chips filter by stage (Vorschläge, Übernommen, Beim Agenten, In Griply,
 * Erledigt); the long-press menu moves a task between stages. "In Griply" hands the task over for real (POST /api/mobile/griply), like the web board.
 */

const STAGE_ICON: Record<Stage, "sparkles" | "check" | "bolt" | "share" | "checkSquare"> = { suggested: "sparkles", accepted: "check", agent: "bolt", external: "share", done: "checkSquare" };

export function Tasks() {
  const th = useTheme();
  const a = useApp();
  const d = useData();
  const router = useRouter();
  const [text, setText] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage | "open">("open");
  const counts = STAGES.reduce((c, st) => ({ ...c, [st]: d.tasks.filter((x) => stageOf(x) === st).length }), {} as Record<Stage, number>);
  const shown = d.tasks.filter((x) => (stage === "open" ? x.status !== "done" : stageOf(x) === stage));
  const moveTo = (id: string, to: Stage) =>
    void d.setTaskStage(id, to).then(async (err) => {
      if (err || to !== "agent" || d.auth !== "live") return a.say(err ?? t("Moved to “{stage}”", { stage: stageLabel(to) }));
      // Like the web board: a task handed to the agent becomes a job that runs in the background.
      const task = d.tasks.find((x) => x.id === id);
      const source = task?.source_item_id ? d.entryById(task.source_item_id)?.title : undefined;
      const title = task?.title ?? "";
      const prompt = source ? t("Take care of this task: {title} (from “{source}”)", { title, source }) : t("Take care of this task: {title}", { title });
      const r = await runAgentOp({ op: "start", prompt, title, origin: "task", ...(/^[0-9a-f-]{36}$/i.test(id) ? { action_item_id: id } : {}) });
      a.say(r.error ? t("That did not work: {error}", { error: r.error }) : t("The agent took over the task"), r.error ? undefined : { label: t("Show"), run: () => router.navigate("/agent") });
    });
  const now = new Date();
  const projects = d.entries.filter((e) => e.type === "project" || e.type === "goal");
  const projectTitle = (id?: string | null) => (id ? projects.find((x) => x.id === id)?.title : undefined);
  const patch = (id: string, p: Parameters<typeof d.patchTask>[1]) => void d.patchTask(id, p).then((err) => err && a.say(err));

  /** Shares tasks as text, then marks them "handed over" (only when the share sheet reports a share). */
  const share = async (format: ShareFormat, list: TaskRow[]) => {
    if (!list.length) return a.say(t("No tasks to share"));
    const msg = shareMessage(
      format,
      list.map((x) => toExportTask(x, projectTitle(x.project_item_id))),
      now.toISOString().slice(0, 10),
    );
    try {
      const r = await Share.share({ title: msg.title, message: msg.message });
      if (r.action !== Share.sharedAction) return;
    } catch (e) {
      return a.say(e instanceof Error ? e.message : t("Sharing is not possible"));
    }
    const ids = list.map((x) => x.id);
    const err = await d.markTasksExported(ids, true);
    a.say(err ?? tn(ids.length, "Task marked as handed over", "{n} tasks marked as handed over"), err ? undefined : { label: t("Undo"), run: () => void d.markTasksExported(ids, false) });
  };
  const openTasks = () => d.tasks.filter((x) => x.status !== "done");
  const exportMenu = () =>
    a.openMenu({
      title: t("Share tasks"),
      items: [
        { label: t("Open ones as a Markdown checklist"), icon: "note", run: () => void share("markdown", openTasks()) },
        { label: t("Open ones as CSV"), icon: "list", run: () => void share("csv", openTasks()) },
      ],
    });
  const open = d.tasks.filter((x) => x.status !== "done").length;

  // One tap can reach both the checkbox and the row's lead zone (SwipeRow); toggle once per tap.
  const lastToggle = useRef<{ id: string; at: number } | null>(null);
  const toggle = (id: string) => {
    const now = Date.now();
    if (lastToggle.current?.id === id && now - lastToggle.current.at < 450) return;
    lastToggle.current = { id, at: now };
    void d.toggleTask(id).then((err) => err && a.say(err));
  };
  const add = () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    void d.addTask(v).then((err) => a.say(err ?? t("Task created")));
  };

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Micro style={{ flex: 1 }}>{t("Tasks")}</Micro>
        <Help>{t("{n} open", { n: open })}</Help>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Share tasks")} hitSlop={10} onPress={exportMenu} style={{ marginLeft: 12 }}>
          <Icon name="share" size={16} color={th.textMuted} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
        {(["open", ...STAGES] as const).map((k) => {
          const on = stage === k;
          const n = k === "open" ? open : counts[k];
          if (k !== "open" && k !== "done" && !n && !on) return null;
          return (
            <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setStage(k)} style={{ minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, borderRadius: RADIUS.pill, backgroundColor: on ? th.bgSurfaceMuted : "transparent", borderWidth: 1, borderColor: on ? "transparent" : th.borderSubtle }}>
              {k !== "open" && <Icon name={STAGE_ICON[k]} size={12} color={on ? th.textPrimary : th.textMuted} />}
              <T size={12.5} lh={18} ls={0} weight={on ? 500 : 400} color={on ? th.textPrimary : th.textSecondary}>
                {k === "open" ? t("All open") : stageLabel(k)}
              </T>
              <T num size={11.5} lh={16} ls={0} color={th.textMuted}>
                {n}
              </T>
            </Pressable>
          );
        })}
      </ScrollView>
      <View>
        {shown.slice(0, 20).map((task) => {
          const done = task.status === "done";
          const due = dueLabel(task.due_date, now);
          const source = task.source_item_id ? d.entryById(task.source_item_id) : undefined;
          const doneAction = { label: done ? t("Reopen") : t("Done"), icon: "check" as const, color: th.statusSynced, run: () => toggle(task.id) };
          return (
            <View key={task.id}>
            <SwipeRow
              onPress={() => (source ? a.openEntry(source.id) : toggle(task.id))}
              onLeadPress={() => toggle(task.id)}
              leadWidth={36}
              onLongPress={() =>
                a.openMenu({
                  title: task.title,
                  items: [
                    { label: done ? t("Reopen") : t("Done"), icon: "check", run: () => toggle(task.id) },
                    ...(["suggested", "accepted", "agent"] as const)
                      .filter((to) => to !== stageOf(task) && !!stageUpdate(task, to))
                      .map((to) => ({ label: t("Move to “{stage}”", { stage: stageLabel(to) }), icon: STAGE_ICON[to], run: () => moveTo(task.id, to) })),
                    { label: t("Edit details"), icon: "note", run: () => setEditId(task.id) },
                    { label: t("Share as Markdown"), icon: "share", run: () => void share("markdown", [task]) },
                    ...(task.exported_at ? [{ label: t("Undo handed over"), icon: "check" as const, run: () => void d.markTasksExported([task.id], false) }] : []),
                    ...(source ? [{ label: t("Source: {title}", { title: source.title }), icon: "note", run: () => a.openEntry(source.id) }] : []),
                  ],
                })
              }
              left={done ? undefined : doneAction}
              right={done ? doneAction : undefined}
            >
              <View style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, boxShadow: `inset 0 -1px 0 0 ${th.borderSubtle}` } as ViewStyle}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done }}
                  accessibilityLabel={task.title}
                  hitSlop={10}
                  onPress={() => toggle(task.id)}
                  style={{ width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: done ? 0 : 1.5, borderColor: th.textMuted, backgroundColor: done ? th.statusSynced : "transparent" }}
                >
                  {done && <Icon name="check" size={12} color="#FFFFFF" />}
                </Pressable>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T size={14} lh={20} numberOfLines={2} color={done ? th.textMuted : th.textPrimary} style={done ? { textDecorationLine: "line-through" } : undefined}>
                    {task.title}
                  </T>
                  {!!source && <Help numberOfLines={1}>{source.title}</Help>}
                  {!!taskMeta(task, projectTitle(task.project_item_id)) && <Help numberOfLines={1}>{taskMeta(task, projectTitle(task.project_item_id))}</Help>}
                  {!!task.context && <Help numberOfLines={2}>{task.context}</Help>}
                </View>
                {due && (
                  <T size={12} lh={16} ls={0} color={due === t("overdue") && !done ? th.statusUrgentText : th.textMuted}>
                    {due}
                  </T>
                )}
              </View>
            </SwipeRow>
            {editId === task.id && (
              <View style={{ gap: 8, paddingVertical: 8 }}>
                <Help>{t("Timeframe")}</Help>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {[null, ...TIMEFRAMES].map((k) => {
                    const on = (task.timeframe ?? null) === k;
                    return (
                      <Pressable
                        key={k ?? "none"}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        onPress={() => patch(task.id, { timeframe: k })}
                        style={{ paddingHorizontal: 10, height: 30, justifyContent: "center", borderRadius: RADIUS.control, borderWidth: 1, borderColor: on ? th.textPrimary : th.borderSubtle }}
                      >
                        <T size={12} lh={16} color={on ? th.textPrimary : th.textMuted}>
                          {k ? timeframeLabel(k) : tx("timeframe", "Open")}
                        </T>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Choose project")}
                  onPress={() =>
                    a.openMenu({
                      title: t("Project"),
                      items: [
                        { label: t("No project"), icon: "x", run: () => patch(task.id, { project_item_id: null }) },
                        ...projects.slice(0, 30).map((pr) => ({ label: pr.title, icon: "folder" as const, run: () => patch(task.id, { project_item_id: pr.id }) })),
                      ],
                    })
                  }
                  style={{ height: 36, justifyContent: "center", paddingHorizontal: 10, borderRadius: RADIUS.control, borderWidth: 1, borderColor: th.borderSubtle }}
                >
                  <T size={13} lh={18} color={th.textPrimary}>
                    {t("Project: {title}", { title: projectTitle(task.project_item_id) ?? t("none") })}
                  </T>
                </Pressable>
                <TextInput
                  accessibilityLabel={t("Context")}
                  placeholder={t("Context: why / where from")}
                  placeholderTextColor={th.textMuted}
                  defaultValue={task.context ?? ""}
                  maxLength={500}
                  onEndEditing={(e) => {
                    if (e.nativeEvent.text.trim() !== (task.context ?? "")) patch(task.id, { context: e.nativeEvent.text });
                  }}
                  style={[{ height: 40, paddingHorizontal: 10, borderRadius: RADIUS.control, borderWidth: 1, borderColor: th.borderSubtle, fontFamily: FONT.sans400, fontSize: 14, color: th.textPrimary }, Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null]}
                />
              </View>
            )}
            </View>
          );
        })}
        {!shown.length && <Help>{stage === "open" || stage === "accepted" ? t("No open tasks.") : t("Nothing in “{stage}”.", { stage: stageLabel(stage) })}</Help>}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 44, paddingHorizontal: 10, borderRadius: RADIUS.control, borderWidth: 1, borderColor: th.borderSubtle }}>
        <Icon name="plus" size={16} color={th.textMuted} />
        <TextInput
          accessibilityLabel={t("New task")}
          placeholder={t("New task")}
          placeholderTextColor={th.textMuted}
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          returnKeyType="done"
          style={[{ flex: 1, height: 44, padding: 0, fontFamily: FONT.sans400, fontSize: 14, color: th.textPrimary }, Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null]}
        />
      </View>
    </View>
  );
}
