import { intlLocale, t, tn } from "../i18n";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { addDays, comingBack, mondayOf, newConnections, openLoops, risingTags, signalNotes } from "../lib/weekSignals";
import { useData } from "../state/Data";
import { useApp } from "../state/AppState";
import { alpha } from "../theme/color";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { Btn, Help, Micro, panel, Section, T } from "./primitives";

/*
 * Journal week on the phone (like the web journal tab Woche): the seven days and what stands out in them, topics
 * on the rise, open loops, new connections and what comes back. "Weekly review" hands the review to the agent
 * (skill week) in the Ask tab, which proposes the note and tasks for confirmation.
 */

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(intlLocale(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(intlLocale(), { weekday: "narrow", timeZone: "UTC" });

function Group({ icon, title, empty, children }: { icon: IconName; title: string; empty: string | null; children: ReactNode }) {
  const th = useTheme();
  return (
    <View accessibilityLabel={title} style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={icon} size={14} color={th.textMuted} />
        <Micro>{title}</Micro>
      </View>
      {empty ? <Help>{empty}</Help> : children}
    </View>
  );
}

function Row({ label, meta, late, onPress }: { label: string; meta: string; late?: boolean; onPress?: () => void }) {
  const th = useTheme();
  return (
    <Pressable accessibilityRole="button" disabled={!onPress} onPress={onPress} style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceMuted }}>
      <T size={14} lh={19} numberOfLines={1} style={{ flex: 1 }}>
        {label}
      </T>
      <T num size={12} lh={16} ls={0} numberOfLines={1} color={late ? th.statusUrgentText : th.textMuted}>
        {meta}
      </T>
    </Pressable>
  );
}

/** The week's numbers and signals (shared by this panel and the Ruhe journal, screens/ruhe/JournalRuhe.tsx). */
export function useWeekSignals() {
  const a = useApp();
  const d = useData();
  const router = useRouter();
  const today = localDay();
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);
  const notes = useMemo(() => signalNotes(d.entries, d.tagsOf, today), [d.entries, d.tagsOf, today]);
  const rising = useMemo(() => risingTags(notes, monday), [notes, monday]);
  const loops = useMemo(
    () => openLoops(d.tasks.filter((x) => x.status !== "cancelled" && !!x.due_date).map((x) => ({ id: x.id, title: x.title, due: x.due_date!.slice(0, 10), done: x.status === "done", sourceId: x.source_item_id })), today, sunday),
    [d.tasks, today, sunday],
  );
  const links = useMemo(() => newConnections(notes, monday), [notes, monday]);
  const back = useMemo(() => comingBack(d.entries, monday), [d.entries, monday]);
  const perDay = useMemo(() => {
    const n = new Map<string, number>();
    for (const x of notes) n.set(x.date, (n.get(x.date) ?? 0) + 1);
    return n;
  }, [notes]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  // "Rückblick der Woche" numbers (like the web week tab): new entries, meetings, journal days, tasks done, mean energy.
  const weekNotes = notes.filter((n) => n.date >= monday && n.date <= sunday);
  const stats = [
    { v: String(weekNotes.filter((n) => !n.path?.includes("/Daily")).length), l: t("new entries") },
    { v: String(d.entries.filter((e) => e.kind === "meeting" && addDays(today, -e.day) >= monday).length), l: t("Meetings") },
    { v: String(a.checkinDays.filter((x) => x >= monday && x <= sunday).length), l: t("Journal days") },
    { v: String(d.tasks.filter((x) => x.status === "done" && !!x.completed_at && x.completed_at.slice(0, 10) >= monday).length), l: t("Tasks done") },
  ];
  const signals = rising.length + loops.length + links.length + back.length;
  const review = () => {
    router.navigate("/ask");
    a.ask(t("/week"));
  };
  const showTag = (tag: string) => {
    a.setScope("all");
    a.setQ(tag);
    router.navigate("/entries");
  };

  return { today, days, perDay, stats, signals, rising, loops, links, back, review, showTag };
}

export function JournalWeek({ embedded = false }: { embedded?: boolean } = {}) {
  const th = useTheme();
  const a = useApp();
  const [openState, setOpen] = useState(false);
  const open = embedded || openState;
  const { today, days, perDay, stats, signals, rising, loops, links, back, review, showTag } = useWeekSignals();

  return (
    <View style={panel(th, 12)}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} disabled={embedded} onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Section>{t("This week")}</Section>
          <Help>{signals ? tn(signals, "{n} signal: topics, open loops, connections", "{n} signals: topics, open loops, connections") : t("Nothing stood out so far.")}</Help>
        </View>
        {!embedded && (
          <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
            <Icon name="chev" size={14} color={th.textMuted} />
          </View>
        )}
      </Pressable>

      {/* Mo to Su: how much went into the vault each day; today is marked. */}
      <View style={{ flexDirection: "row", gap: 4 }}>
        {days.map((day) => {
          const n = perDay.get(day) ?? 0;
          const isToday = day === today;
          return (
            <View key={day} accessibilityLabel={`${shortDay(day)}, ${tn(n, "{n} entry", "{n} entries")}`} style={{ flex: 1, alignItems: "center", gap: 4 }}>
              <T size={11.5} lh={16} ls={0} weight={isToday ? 600 : 400} color={isToday ? th.tags.ai.fg : th.textMuted}>
                {weekday(day)}
              </T>
              <View style={{ width: "100%", height: 6, borderRadius: 3, backgroundColor: day > today ? th.borderSubtle : n ? alpha(th.accentAi, Math.min(1, 0.3 + n * 0.15)) : th.bgSurfaceMuted }} />
            </View>
          );
        })}
      </View>

      {embedded && (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {stats.map((x) => (
            <View key={x.l} style={{ flex: 1, gap: 2, paddingVertical: 10, paddingHorizontal: 8, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceMuted }}>
              <T num size={20} lh={24} weight={400}>
                {x.v}
              </T>
              <T size={11} lh={14} ls={0} numberOfLines={2} color={th.textMuted}>
                {x.l}
              </T>
            </View>
          ))}
        </View>
      )}

      {open && (
        <View style={{ gap: 14 }}>
          <Group icon="flame" title={t("Topics on the rise")} empty={rising.length ? null : t("No topic stood out this week.")}>
            {rising.map((r) => (
              <Row key={r.tag} label={r.tag} meta={r.before ? t("{now} entries, {before} the week before", { now: r.now, before: r.before }) : tn(r.now, "{n} entry, new", "{n} entries, new")} onPress={() => showTag(r.tag)} />
            ))}
          </Group>
          <Group icon="check" title={t("Open loops")} empty={loops.length ? null : t("Nothing open that is due this week.")}>
            {loops.map((l) => (
              <Row key={l.id} label={l.title} late={l.overdue} meta={l.overdue ? t("overdue since {date}", { date: shortDay(l.due) }) : shortDay(l.due)} onPress={l.sourceId ? () => a.openEntry(l.sourceId!) : undefined} />
            ))}
          </Group>
          <Group icon="link" title={t("New connections")} empty={links.length ? null : t("No new links between entries this week.")}>
            {links.map((c) => (
              <Row key={`${c.fromId}|${c.toId}`} label={c.from} meta={`→ ${c.to}`} onPress={() => a.openEntry(c.fromId)} />
            ))}
          </Group>
          <Group icon="bell" title={t("Comes back this week")} empty={back.length ? null : t("No reminders this week.")}>
            {back.map((e) => (
              <Row key={e.id} label={e.title} meta={shortDay(e.remindAt!.slice(0, 10))} onPress={() => a.openEntry(e.id)} />
            ))}
          </Group>
          <Btn variant="primary" block minHeight={44} icon="sparkles" onPress={review}>
            {t("Weekly review with the agent")}
          </Btn>
        </View>
      )}
    </View>
  );
}
