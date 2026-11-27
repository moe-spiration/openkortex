import { t } from "../i18n";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import type { Entry } from "../data/mock";
import { remindOptions } from "../lib/remind";
import { reminderGroups, remindLine, watchLine } from "../lib/reminders";
import { useApp } from "../state/AppState";
import { useData } from "../state/Data";
import { useRuhe, useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { Btn, Help, Micro, Pill, T } from "./primitives";
import { SwipeSheet } from "./SwipeSheet";
import { EmptyState, GroupHead, RIconButton, RRow, RSheet, RText } from "./ruhe";

/*
 * Erinnerungen (Home bell): the web page /erinnerungen as a bottom sheet, no tab of its own. Fällig and
 * Demnächst with Später / Erledigt, Beobachtet (delta radar) with the last change, Gesehen and Beobachten aus.
 * A title opens the entry. Everything goes through Data (optimistic, rolled back when the server refuses).
 */

// Open state lives here, not in AppState: the Home bell opens it, the tabs layout renders it above the tab bar.
let open = false;
const subs = new Set<() => void>();
const emit = (v: boolean) => {
  open = v;
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

export const openReminders = () => emit(true);

/** Mounted once in the tabs layout, next to the action menu. */
export function RemindersLayer() {
  const shown = useSyncExternalStore(subscribe, () => open, () => false);
  return shown ? <RemindersSheet onClose={() => emit(false)} /> : null;
}

function RemindersSheet({ onClose }: { onClose: () => void }) {
  const th = useTheme();
  const ruhe = useRuhe();
  const a = useApp();
  const d = useData();
  const now = new Date();
  const groups = useMemo(() => reminderGroups<Entry>(d.entries, new Date()), [d.entries]);
  const tomorrow = remindOptions(now).find((o) => o.key === "tomorrow");
  const run = (p: Promise<string | null>) => void p.then((err) => err && a.say(err));
  const openEntry = (id: string) => {
    onClose();
    a.openEntry(id);
  };
  const empty = !groups.due.length && !groups.upcoming.length && !groups.watched.length;

  const row = (e: Entry, icon: IconName, line: string, actions: ReactNode, extra?: ReactNode) => (
    <View key={e.id} style={{ gap: 4, paddingVertical: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Open: {title}", { title: e.title })} onPress={() => openEntry(e.id)} style={{ flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Icon name={icon} size={16} color={th.textSecondary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T type="body" numberOfLines={1}>
              {e.title}
            </T>
            <Help numberOfLines={1}>{line}</Help>
          </View>
        </Pressable>
        {actions}
      </View>
      {extra}
    </View>
  );

  const section = (label: string, n: number, children: ReactNode) =>
    n > 0 && (
      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Micro style={{ flex: 1 }}>{label}</Micro>
          <T num size={12.5} lh={18} ls={0} color={th.textMuted}>
            {String(n)}
          </T>
        </View>
        {children}
      </View>
    );

  const reminderRow = (e: Entry, due: boolean) =>
    row(
      e,
      "flag",
      remindLine(e.remindAt!, now),
      <>
        {due && !!tomorrow && (
          <Btn sm minHeight={36} variant="ghost" onPress={() => run(d.setReminder(e.id, tomorrow.iso))}>
            {t("Tomorrow")}
          </Btn>
        )}
        <Btn sm minHeight={36} icon="check" accessibilityLabel={t("Done: {title}", { title: e.title })} onPress={() => run(d.setReminder(e.id, null))}>
          {due ? t("Done") : t("Remove")}
        </Btn>
      </>,
    );

  if (ruhe) {
    // Ruhe: glass sheet with group heads and quiet rows; the actions are icon buttons at the row's end, so the title keeps its room.
    const rRow = (e: Entry, icon: IconName, line: string, actions: ReactNode, extra?: ReactNode) => (
      <View key={e.id}>
        <RRow tall icon={icon} title={e.title} sub={line} onPress={() => openEntry(e.id)} accessibilityLabel={t("Open: {title}", { title: e.title })} trailing={<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>{actions}</View>} />
        {extra}
      </View>
    );
    const rReminder = (e: Entry, due: boolean) =>
      rRow(
        e,
        "flag",
        remindLine(e.remindAt!, now),
        <>
          {due && !!tomorrow && <RIconButton icon="sun" size={36} label={t("Tomorrow")} onPress={() => run(d.setReminder(e.id, tomorrow.iso))} />}
          <RIconButton icon={due ? "check" : "x"} size={36} label={due ? t("Done: {title}", { title: e.title }) : t("Remove")} onPress={() => run(d.setReminder(e.id, null))} />
        </>,
      );
    return (
      <RSheet z={30} scroll maxHeight="82%" onClose={onClose} label={t("Reminders")} contentStyle={{ paddingHorizontal: 0 }}>
        <View style={{ paddingHorizontal: 20, gap: 4 }}>
          <RText step="titleCard" accessibilityRole="header">
            {t("Reminders")}
          </RText>
          <RText step="rowSub" color={th.t3}>
            {t("Due entries, upcoming reminders and pages Kortex watches for you.")}
          </RText>
        </View>
        {empty && <EmptyState icon="bell" pic="stack" size="md" title={t("Nothing to remind")} help={t("Nothing to remind you of. Set a reminder in an entry or turn on “Watch” for a page on the web.")} />}
        {groups.due.length > 0 && <GroupHead label={t("Due")} count={groups.due.length} />}
        {groups.due.map((e) => rReminder(e, true))}
        {groups.upcoming.length > 0 && <GroupHead label={t("Upcoming")} count={groups.upcoming.length} />}
        {groups.upcoming.slice(0, 20).map((e) => rReminder(e, false))}
        {groups.watched.length > 0 && <GroupHead label={t("Watched pages")} count={groups.watched.length} />}
        {groups.watched.map(({ entry: e, watch: w, unseen }) =>
          rRow(
            e,
            "eye",
            watchLine(w),
            <>
              {unseen && <RIconButton icon="check" size={36} label={t("Seen: {title}", { title: e.title })} onPress={() => run(d.patchWatch(e.id, { seen: true }))} />}
              <RIconButton icon="eyeOff" size={36} label={t("Stop watching: {title}", { title: e.title })} onPress={() => run(d.patchWatch(e.id, { enabled: false }))} />
            </>,
            unseen && w.last_diff ? (
              <View style={{ flexDirection: "row", gap: 8, paddingLeft: 50, paddingRight: 20, paddingBottom: 8 }}>
                <RText step="kind" color={th.accentInk}>
                  {t("New")}
                </RText>
                <RText step="rowSub" color={th.t3} numberOfLines={3} style={{ flex: 1 }}>
                  {w.last_diff.summary}
                </RText>
              </View>
            ) : undefined,
          ),
        )}
      </RSheet>
    );
  }

  return (
    <>
      <Pressable accessibilityLabel={t("Close")} onPress={onClose} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 30, backgroundColor: th.bgScrim }} />
      <SwipeSheet
        onClose={onClose}
        grabHeight={40}
        contentContainerStyle={{ padding: 18, paddingBottom: 32, gap: 16 }}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "82%", zIndex: 31, borderTopLeftRadius: RADIUS.card, borderTopRightRadius: RADIUS.card, backgroundColor: th.bgMainWindow, boxShadow: th.shadowFloating } as ViewStyle}
      >
        <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: th.borderSubtle }} />
        <View style={{ gap: 2 }}>
          <T type="h3">{t("Reminders")}</T>
          <Help>{t("Due entries, upcoming reminders and pages Kortex watches for you.")}</Help>
        </View>

        {empty && <Help>{t("Nothing to remind you of. Set a reminder in an entry or turn on “Watch” for a page on the web.")}</Help>}

        {section(t("Due"), groups.due.length, groups.due.map((e) => reminderRow(e, true)))}
        {section(t("Upcoming"), groups.upcoming.length, groups.upcoming.slice(0, 20).map((e) => reminderRow(e, false)))}
        {section(
          t("Watched pages"),
          groups.watched.length,
          groups.watched.map(({ entry: e, watch: w, unseen }) =>
            row(
              e,
              "eye",
              watchLine(w),
              <>
                {unseen && (
                  <Btn sm minHeight={36} icon="check" accessibilityLabel={t("Seen: {title}", { title: e.title })} onPress={() => run(d.patchWatch(e.id, { seen: true }))}>
                    {t("Seen")}
                  </Btn>
                )}
                <Btn sm minHeight={36} variant="ghost" iconOnly icon="eyeOff" accessibilityLabel={t("Stop watching: {title}", { title: e.title })} onPress={() => run(d.patchWatch(e.id, { enabled: false }))} />
              </>,
              unseen && w.last_diff ? (
                <View style={{ flexDirection: "row", gap: 8, paddingLeft: 26 }}>
                  <Pill sm tone="ai" nodot>
                    {t("New")}
                  </Pill>
                  <Help style={{ flex: 1 }} numberOfLines={3}>
                    {w.last_diff.summary}
                  </Help>
                </View>
              ) : undefined,
            ),
          ),
        )}
      </SwipeSheet>
    </>
  );
}
