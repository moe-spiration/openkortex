import { feature, t, tx } from "../../i18n";
import { Platform, TextInput, View } from "react-native";
import { dueLabel } from "../../data/live";
import { stageLabel, STAGES, taskMeta, TIMEFRAMES, timeframeLabel } from "../../data/tasks";
import { useTheme } from "../../theme/ThemeProvider";
import { FONT, RUHE_SPACE } from "../../theme/tokens";
import { Icon } from "../../ui/Icon";
import { ScreenScroll } from "../../ui/Screen";
import { SwipeRow } from "../../ui/SwipeRow";
import { useTasksModel } from "../../ui/Tasks";
import { EmptyState, GroupHead, RChipRow, RGroup, RGroupRow, RText, RTaskCheck, RuheLocBar, useTickLater } from "../../ui/ruhe";

/*
 * Aufgaben, Ruhe (android-richtlinien.md 7 "Aufgabenzeile", 8 A): title with the share action, the stages as chips
 * (one active, inverted), a quiet add row, then the tasks as rows: check circle 20, title 15, sub 12.5 t3 (source,
 * project/timeframe), due right in t4 or crit when overdue; done = filled accent circle and the title in t3. Swipe,
 * long-press menu and the inline details stay as in the vivid list (same model, ui/Tasks useTasksModel).
 */

const PAD = RUHE_SPACE.page;
const SURF = RUHE_SPACE.surface;
const NO_OUTLINE = Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null;

export function TasksRuhe() {
  const th = useTheme();
  const m = useTasksModel();
  const { a, d, now, text, setText, editId, stage, setStage, counts, shown, open, projects, projectTitle, patch, exportMenu, toggle, add } = m;
  const { ticked, tickLater } = useTickLater();
  const chips = (["open", ...STAGES] as const)
    .filter((k) => k === "open" || k === "done" || counts[k] > 0 || stage === k)
    .map((k) => ({ key: k, label: k === "open" ? t("All open") : stageLabel(k), count: k === "open" ? open : counts[k], on: stage === k, onPress: () => setStage(k) }));

  return (
    <ScreenScroll flush padTop={0}>
      <RuheLocBar title={t("Tasks")} actions={[{ icon: "share", label: t("Share tasks"), onPress: exportMenu }]} />
      <RChipRow items={chips} style={{ marginTop: 2 }} />

      <View style={{ height: RUHE_SPACE.row, flexDirection: "row", alignItems: "center", gap: RUHE_SPACE.iconGap, paddingHorizontal: PAD, marginTop: 10 }}>
        <Icon name="plus" size={18} color={th.t3} />
        <TextInput
          accessibilityLabel={t("New task")}
          placeholder={t("New task")}
          placeholderTextColor={th.t4}
          selectionColor={th.accent}
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          returnKeyType="done"
          style={[{ flex: 1, height: RUHE_SPACE.row, padding: 0, fontFamily: FONT.sans400, fontSize: 15, color: th.t1 }, NO_OUTLINE]}
        />
      </View>

      {shown.slice(0, 40).map((task) => {
        const done = task.status === "done" || ticked(task.id);
        // Checking off: the row keeps its place while the check draws, then the list updates.
        const flip = () => (task.status === "done" ? toggle(task.id) : tickLater(task.id, () => toggle(task.id)));
        const due = dueLabel(task.due_date, now);
        const late = due === t("overdue") && !done;
        const source = task.source_item_id ? d.entryById(task.source_item_id) : undefined;
        const meta = taskMeta(task, projectTitle(task.project_item_id));
        const sub = [source?.title, meta].filter(Boolean).join(" · ");
        const doneAction = { label: done ? t("Reopen") : t("Done"), icon: "check" as const, color: th.ok, run: flip };
        return (
          <View key={task.id}>
            <SwipeRow onPress={() => (source ? a.openEntry(source.id) : flip())} onLeadPress={flip} leadWidth={PAD + 20 + 6} onLongPress={() => m.menu(task)} left={done ? undefined : doneAction} right={done ? doneAction : undefined}>
              <View style={{ minHeight: RUHE_SPACE.row, flexDirection: "row", gap: RUHE_SPACE.iconGap, paddingLeft: PAD }}>
                <View style={{ paddingTop: 16 }}>
                  <RTaskCheck done={done} label={task.title} onPress={flip} />
                </View>
                <View style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 12, paddingVertical: 14, paddingRight: PAD, borderTopWidth: 1, borderTopColor: th.hair }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <RText step="rowTitle" weight={400} color={done ? th.t3 : th.t1} numberOfLines={2}>
                      {task.title}
                    </RText>
                    {!!sub && (
                      <RText step="rowSub" color={th.t3} numberOfLines={1} style={{ marginTop: 2 }}>
                        {sub}
                      </RText>
                    )}
                    {!!task.context && (
                      <RText step="rowSub" color={th.t4} numberOfLines={2} style={{ marginTop: 2 }}>
                        {task.context}
                      </RText>
                    )}
                  </View>
                  {!!due && (
                    <RText step="meta" tnum color={late ? th.crit : th.t4} style={{ paddingTop: 2 }}>
                      {due}
                    </RText>
                  )}
                </View>
              </View>
            </SwipeRow>
            {editId === task.id && (
              <View style={{ paddingBottom: 12 }}>
                <GroupHead label={t("Timeframe")} style={{ marginTop: 4 }} />
                <RChipRow items={[null, ...TIMEFRAMES].map((k) => ({ key: k ?? "none", label: k ? timeframeLabel(k) : tx("timeframe", "Open"), on: (task.timeframe ?? null) === k, onPress: () => patch(task.id, { timeframe: k }) }))} />
                <RGroup style={{ marginTop: 12 }}>
                  <RGroupRow
                    first
                    icon="folder"
                    label={t("Project")}
                    value={projectTitle(task.project_item_id) ?? t("none")}
                    onPress={() =>
                      a.openMenu({
                        title: t("Project"),
                        items: [
                          { label: t("No project"), icon: "x", run: () => patch(task.id, { project_item_id: null }) },
                          ...projects.slice(0, 30).map((pr) => ({ label: pr.title, icon: "folder" as const, run: () => patch(task.id, { project_item_id: pr.id }) })),
                        ],
                      })
                    }
                  />
                  <View style={{ minHeight: RUHE_SPACE.menuRow, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: th.hair }}>
                    <Icon name="note" size={18} color={th.t2} />
                    <TextInput
                      accessibilityLabel={t("Context")}
                      placeholder={t("Context: why / where from")}
                      placeholderTextColor={th.t4}
                      selectionColor={th.accent}
                      defaultValue={task.context ?? ""}
                      maxLength={500}
                      onEndEditing={(e) => {
                        if (e.nativeEvent.text.trim() !== (task.context ?? "")) patch(task.id, { context: e.nativeEvent.text });
                      }}
                      style={[{ flex: 1, height: RUHE_SPACE.menuRow, padding: 0, fontFamily: FONT.sans400, fontSize: 15, color: th.t1 }, NO_OUTLINE]}
                    />
                  </View>
                </RGroup>
              </View>
            )}
          </View>
        );
      })}
      {!shown.length && (
        <EmptyState
          icon="checkCircle"
          pic={stage === "open" || stage === "accepted" ? "stack" : "search"}
          title={stage === "open" || stage === "accepted" ? t("No open tasks.") : t("Nothing in “{stage}”.", { stage: stageLabel(stage) })}
          help={t("New tasks come from your notes and meetings, or from what you capture.")}
        />
      )}
      <RText step="rowSub" color={th.t4} style={{ paddingHorizontal: PAD, paddingTop: 18, paddingBottom: 8 }}>
        {feature("griply") ? t("Goals and habits stay in Griply. Here: what came out of your entries and meetings.") : t("What came out of your entries and meetings.")}
      </RText>
      <View style={{ height: SURF }} />
    </ScreenScroll>
  );
}
