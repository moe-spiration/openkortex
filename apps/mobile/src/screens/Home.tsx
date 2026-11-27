import { intlLocale, t, tn } from "../i18n";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { dueLabel, dueReminders } from "../data/live";
import type { Entry } from "../data/mock";
import { initialOf } from "../lib/greeting";
import { remindOptions } from "../lib/remind";
import { attentionCount, reminderGroups } from "../lib/reminders";
import { openReminders } from "../ui/RemindersSheet";
import { useData } from "../state/Data";
import { greetingFor } from "../lib/greeting";
import { useApp } from "../state/AppState";
import { alpha } from "../theme/color";
import { PackHero } from "../theme/PackImages";
import { useRuhe, useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon } from "../ui/Icon";
import { Btn, Check, Eyebrow, Help, Label, Micro, Photo, Section, T } from "../ui/primitives";

import { ScreenScroll } from "../ui/Screen";
import { Flashcards } from "../ui/Flashcards";
import { DailyStack } from "../ui/DailyStack";
import { AgentNight, AgentRowsRuhe, YourAgent } from "../ui/AgentHome";
import { EmptyState, GroupHead, RAvatar, RRow, RTaskCheck, RuheLocBar, useTickLater } from "../ui/ruhe";
import { entryIcon } from "../ui/RuheLibrary";
import type { IconName } from "../ui/Icon";

const entryIconOf = (e: Entry | undefined): IconName => (e ? entryIcon(e) : "fileText");
import { EnergyToday } from "../ui/EnergyToday";
import { useEntryActions } from "../ui/entryActions";
import { LifeMini } from "../ui/LifeMini";

/* Home (Mobile.dc.html "Tab: Home"): greeting, daily check-in, rediscover, jump back in, for today. */

export function Home() {
  return useRuhe() ? <HomeRuhe /> : <HomeVivid />;
}

/**
 * Heute in Ruhe (mockup `mobil` / heute-soll): the Ortsleiste (date, "Heute", reminders and the avatar for
 * settings), the day's card from the daily stack, then quiet rows: what is due (inbox first), the agent, where you
 * left off, and the pages of the Heute family. No hero image, no stat tiles, no boxes in boxes.
 */
function HomeRuhe() {
  const th = useTheme();
  const a = useApp();
  const d = useData();
  const act = useEntryActions();
  const router = useRouter();
  const [deckOpen, setDeckOpen] = useState(false);
  const { ticked, tickLater } = useTickLater();
  const reminders = useMemo(() => reminderGroups(d.entries, new Date()), [d.entries]);
  const attention = attentionCount(reminders);
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const tasks = d.tasks.filter((x) => x.status !== "done" && x.status !== "cancelled" && x.due_date && x.due_date.slice(0, 10) <= todayIso).slice(0, 5);
  const due = dueReminders(d.entries, now).slice(0, 4);
  const cardCount = a.cardsDone ? 0 : d.home?.flashcards ? d.home.flashcards.cards.length : d.home ? 0 : 3;
  const today = now.toLocaleDateString(intlLocale(), { weekday: "long", day: "numeric", month: "long" });
  const run = (p: Promise<string | null>) => void p.then((err) => err && a.say(err));
  const tomorrow = remindOptions().find((o) => o.key === "tomorrow");
  const dueRows = (a.inboxCount > 0 ? 1 : 0) + tasks.length + due.length;
  const meeting = d.home?.meeting;
  return (
    <>
      <ScreenScroll flush>
        <RuheLocBar
          eyebrow={today}
          title={t("Today")}
          actions={[{ icon: "bell", label: attention ? t("Reminders, {n} new", { n: attention }) : t("Reminders"), on: attention > 0, onPress: openReminders }]}
          trailing={<RAvatar initials={initialOf(d.name)} label={t("Profile and settings")} onPress={() => router.navigate("/settings")} />}
        />
        <DailyStack />

        {dueRows === 0 && (
          <View>
            <GroupHead label={t("Due today")} />
            <EmptyState icon="checkCircle" pic="stack" size="sm" title={t("Nothing is due today.")} />
          </View>
        )}
        {dueRows > 0 && (
          <View>
            <GroupHead label={t("Due today")} count={tasks.length + due.length || undefined} />
            {a.inboxCount > 0 && <RRow first icon="inbox" title={t("Inbox")} sub={tn(a.inboxCount, "{n} entry waits", "{n} entries wait")} count={a.inboxCount} chevron onPress={() => router.navigate("/inbox")} />}
            {tasks.map((task, i) => {
              const label = dueLabel(task.due_date, now);
              const late = task.due_date!.slice(0, 10) < todayIso;
              return (
                <RRow
                  key={task.id}
                  first={i === 0 && a.inboxCount === 0}
                  lead={<RTaskCheck done={ticked(task.id)} label={task.title} onPress={() => tickLater(task.id, () => run(d.toggleTask(task.id)))} />}
                  title={task.title}
                  titleWeight={400}
                  sub={label ?? undefined}
                  subColor={late ? th.crit : undefined}
                  onPress={() => (task.source_item_id ? a.openEntry(task.source_item_id) : router.navigate("/tasks"))}
                />
              );
            })}
            {due.map((e, i) => (
              <RRow
                key={e.id}
                first={i === 0 && a.inboxCount === 0 && tasks.length === 0}
                lead={<RTaskCheck done={ticked(e.id)} label={t("Done")} onPress={() => tickLater(e.id, () => run(d.setReminder(e.id, null)))} />}
                title={e.title}
                titleWeight={400}
                sub={t("Reminder")}
                onPress={() => a.openEntry(e.id)}
                onLongPress={tomorrow ? () => run(d.setReminder(e.id, tomorrow.iso)) : undefined}
              />
            ))}
          </View>
        )}

        <AgentRowsRuhe />

        {meeting && (
          <View>
            <GroupHead label={t("For today")} />
            <RRow first tall icon="mic" title={meeting.title} sub={meeting.coaching || meeting.people.slice(0, 3).join(", ") || undefined} onPress={() => a.openEntry(meeting.id)} />
          </View>
        )}

        {d.jump.length > 0 && (
          <View>
            <GroupHead label={t("Pick up where you left off")} />
            {d.jump.slice(0, 3).map((j, i) => (
              <RRow key={j.id} first={i === 0} icon={entryIconOf(d.entryById(j.id))} title={j.title} sub={j.meta} meta={j.pct > 0 && j.pct < 100 ? `${Math.round(j.pct)} %` : undefined} onPress={() => a.openEntry(j.id)} />
            ))}
          </View>
        )}

        <View>
          <GroupHead label={t("More")} />
          <RRow first icon="sun" title={t("Journal")} sub={a.streak > 0 ? tn(a.streak, "{n} day", "{n} days") : undefined} chevron onPress={() => router.navigate("/journal")} />
          <RRow icon="checkSquare" title={t("Tasks")} count={d.tasks.filter((x) => x.status !== "done" && x.status !== "cancelled").length || undefined} chevron onPress={() => router.navigate("/tasks")} />
          <RRow
            icon="book"
            title={t("Cards")}
            count={cardCount || undefined}
            chevron
            onPress={() => (d.home?.flashcards ? setDeckOpen(true) : a.reviewCards())}
            onLongPress={d.home?.flashcards ? () => a.openMenu(act.deckMenu(d.home!.flashcards!, () => setDeckOpen(true))) : undefined}
          />
          <RRow icon="life" title={t("Life")} chevron onPress={() => router.navigate("/life")} />
        </View>
      </ScreenScroll>
      {deckOpen && d.home?.flashcards && (
        <Flashcards
          deck={d.home.flashcards.deck}
          cards={d.home.flashcards.cards}
          onClose={() => setDeckOpen(false)}
          onDone={(k) => {
            a.reviewCards();
            a.say(t("Knew {known} of {total}", { known: k, total: d.home!.flashcards!.cards.length }));
          }}
        />
      )}
    </>
  );
}

function HomeVivid() {
  const th = useTheme();
  const ruhe = useRuhe();
  const a = useApp();
  const d = useData();
  const act = useEntryActions();
  const router = useRouter();
  const [deckOpen, setDeckOpen] = useState(false);
  const reminders = useMemo(() => reminderGroups(d.entries, new Date()), [d.entries]);
  const attention = attentionCount(reminders);
  const todayIso = new Date().toISOString().slice(0, 10);
  const dueCount = d.tasks.filter((x) => x.status !== "done" && x.due_date && x.due_date.slice(0, 10) <= todayIso).length;
  const cardCount = a.cardsDone ? 0 : d.home?.flashcards ? d.home.flashcards.cards.length : d.home ? 0 : 3;
  const today = new Date().toLocaleDateString(intlLocale(), { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      {/* Theme pack background with the accent tint; the greeting sits in the lower, scrimmed part (spec 5.2, 6). */}
      <PackHero topic="home" tint height={270} />
      <ScreenScroll gap={22} padTop={70}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Eyebrow color={th.textSecondary}>{today}</Eyebrow>
            {/* Ruhe: one heading system, the page name in large tight type instead of the light greeting. */}
            {ruhe ? (
              <T size={30} lh={36} ls={-0.03} weight={600}>
                {t("Today")}
              </T>
            ) : (
              <T type="greeting">{greetingFor(d.name)}</T>
            )}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 32, paddingHorizontal: 10, borderRadius: RADIUS.pill, backgroundColor: alpha(th.bgSurfaceFlat, 0.72) }}>
            <Icon name="flame" size={14} color={th.accentCheckin} />
            <T num size={12} lh={18} ls={0} color={th.textSecondary}>{tn(a.streak, "{n} day", "{n} days")}</T>
          </View>
          {/* Erinnerungen & beobachtete Seiten: a quiet bell next to the streak, no tab of its own; the number is what is due now. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={attention ? t("Reminders, {n} new", { n: attention }) : t("Reminders")}
            onPress={openReminders}
            hitSlop={6}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 32, minWidth: 32, paddingHorizontal: attention ? 10 : 9, borderRadius: RADIUS.pill, justifyContent: "center", backgroundColor: alpha(th.bgSurfaceFlat, 0.72) }}
          >
            <Icon name="bell" size={14} color={attention ? th.tags.ai.fg : th.textSecondary} />
            {attention > 0 && <T num size={12} lh={18} ls={0} color={th.tags.ai.fg}>{String(attention)}</T>}
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", alignItems: "stretch", borderRadius: RADIUS.card, backgroundColor: alpha(th.bgSurfaceFlat, 0.72), paddingHorizontal: 4 }}>
          {[
            { key: "inbox", label: t("Inbox"), n: a.inboxCount, accent: true, run: () => router.navigate("/inbox") },
            { key: "tasks", label: t("Tasks"), n: dueCount, accent: false, run: () => router.navigate("/tasks") },
            { key: "cards", label: t("Cards"), n: cardCount, accent: false, run: () => (d.home?.flashcards ? setDeckOpen(true) : a.reviewCards()), hold: d.home?.flashcards ? () => a.openMenu(act.deckMenu(d.home!.flashcards!, () => setDeckOpen(true))) : undefined },
          ].map((x, i) => (
            <View key={x.key} style={{ flex: 1, flexDirection: "row" }}>
              {i > 0 && <View style={{ width: 1, marginVertical: 12, backgroundColor: th.borderSubtle }} />}
              <Pressable accessibilityRole="button" accessibilityLabel={`${x.label}, ${x.n}`} onPress={x.run} onLongPress={"hold" in x ? x.hold : undefined} style={{ flex: 1, minHeight: 72, alignItems: "center", justifyContent: "center", gap: 2 }}>
                <Micro>{x.label}</Micro>
                <T num size={24} lh={28} ls={-0.015} weight={400} color={x.accent && x.n > 0 ? th.tags.ai.fg : th.textPrimary}>
                  {String(x.n)}
                </T>
              </Pressable>
            </View>
          ))}
        </View>

        {d.home ? <DailyStack /> : <DueReminders />}
        <AgentNight />

        <EnergyToday link={{ label: t("Continue in the journal"), run: () => router.navigate("/journal") }} />

        <YourAgent />

        <View style={{ gap: 10 }}>
          <Section>{t("Pick up where you left off")}</Section>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 4, gap: 12 }}>
            {d.jump.map((j) => (
              <Pressable key={j.id} onPress={() => a.openEntry(j.id)} style={{ width: 132, gap: 6 }}>
                <View style={{ width: 132, height: 132, borderRadius: RADIUS.card, overflow: "hidden", backgroundColor: th.bgSurfaceMuted }}>
                  <Photo source={j.img} />
                  <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: "rgba(0,0,0,0.4)" }}>
                    <View style={{ width: `${j.pct}%`, height: "100%", backgroundColor: th.accentAi }} />
                  </View>
                </View>
                <T size={14} lh={20} weight={500} numberOfLines={1}>
                  {j.title}
                </T>
                <Help numberOfLines={1} style={{ marginTop: -6 }}>
                  {j.meta}
                </Help>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <LifeMini />

        {d.home && <LiveToday />}
      </ScreenScroll>
      {deckOpen && d.home?.flashcards && (
        <Flashcards
          deck={d.home.flashcards.deck}
          cards={d.home.flashcards.cards}
          onClose={() => setDeckOpen(false)}
          onDone={(k) => {
            a.reviewCards();
            a.say(t("Knew {known} of {total}", { known: k, total: d.home!.flashcards!.cards.length }));
          }}
        />
      )}
    </>
  );
}

/** "Für heute" with live data: today's meeting (tasks, reminders, rediscover and cards live in the daily stack). */
function LiveToday() {
  const th = useTheme();
  const a = useApp();
  const d = useData();
  const h = d.home!;
  // "Fits today" is a card of the daily stack; this section keeps today's meeting.
  if (!h.meeting) return null;
  return (
    <View style={{ gap: 12 }}>
      <Section>{t("For today")}</Section>
      {h.meeting && (
        <Pressable onPress={() => a.openEntry(h.meeting!.id)} style={[{ gap: 6, padding: 14, borderRadius: RADIUS.card, backgroundColor: th.bgSurfaceFlat }]}>
          <Eyebrow>{h.meeting.people.length ? `Meeting · ${h.meeting.people.slice(0, 3).join(", ")}` : "Meeting"}</Eyebrow>
          <T type="h3" numberOfLines={2}>
            {h.meeting.title}
          </T>
          {!!h.meeting.coaching && <Help numberOfLines={3}>{h.meeting.coaching}</Help>}
        </Pressable>
      )}
    </View>
  );
}

/** "Heute fällig" (S11, like the web Home): entries whose reminder has come. A row opens the entry (with the Erinnerung sheet), "Später" snoozes to tomorrow 08:00, "Erledigt" clears it. Hidden when nothing is due. */
function DueReminders() {
  const th = useTheme();
  const a = useApp();
  const d = useData();
  const due = dueReminders(d.entries, new Date());
  const today = new Date().toISOString().slice(0, 10);
  const tasks = d.tasks.filter((x) => x.status !== "done" && x.due_date && x.due_date.slice(0, 10) <= today).slice(0, 4);
  if (!due.length && !tasks.length) return null;
  const tomorrow = remindOptions().find((o) => o.key === "tomorrow");
  const run = (p: Promise<string | null>) => void p.then((err) => err && a.say(err));
  return (
    <View style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: RADIUS.card, backgroundColor: th.bgSurfaceFlat }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Label>{t("Due today")}</Label>
        </View>
        <T num size={12.5} lh={18} ls={0} color={th.textMuted}>{t("{n} open", { n: due.length + tasks.length })}</T>
      </View>
      {due.slice(0, 6).map((e) => (
        <View key={e.id} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Open: {title}", { title: e.title })} onPress={() => a.openEntry(e.id)} style={{ flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Icon name="flag" size={14} color={th.textSecondary} />
            <T type="body" style={{ flex: 1 }} numberOfLines={2}>
              {e.title}
            </T>
          </Pressable>
          {!!tomorrow && (
            <Btn sm minHeight={36} variant="ghost" onPress={() => run(d.setReminder(e.id, tomorrow.iso))}>
              {t("Later")}
            </Btn>
          )}
          <Btn sm minHeight={36} icon="check" onPress={() => run(d.setReminder(e.id, null))}>
            {t("Done")}
          </Btn>
        </View>
      ))}
      {tasks.map((task) => (
        <View key={task.id} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Check on={false} onPress={() => run(d.toggleTask(task.id))} label={task.title} />
          <T type="body" style={{ flex: 1 }} numberOfLines={2}>
            {task.title}
          </T>
        </View>
      ))}
    </View>
  );
}
