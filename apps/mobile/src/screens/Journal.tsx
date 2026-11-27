import { intlLocale, msg, t, tn } from "../i18n";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, TextInput, View } from "react-native";
import { isoDay } from "../data/daily";
import { appendPrompt, dailyNotes, heatCells, writingLevel } from "../lib/journal";
import { useApp } from "../state/AppState";
import { useData } from "../state/Data";
import { alpha } from "../theme/color";
import { useRuhe, useTheme } from "../theme/ThemeProvider";
import { FONT, RADIUS } from "../theme/tokens";
import { useEntryActions } from "../ui/entryActions";
import { Icon } from "../ui/Icon";
import { JournalWeek } from "../ui/JournalWeek";
import { Btn, Help, Micro, panel, rowSurface, Section, T } from "../ui/primitives";
import { ScreenScroll } from "../ui/Screen";
import { JournalRuhe } from "./ruhe/JournalRuhe";

/*
 * Tagebuch on the phone (like the web journal, tabs Tag | Woche): today's entry (the daily note's Mind Dump, one
 * thought per line, saved automatically), three writing prompts, the writing heat map of twelve weeks with the streak
 * and the earlier days (14 at a time, long-press for the entry menu). Energy and Top 3 stay in the check-in on Home.
 * Woche: the numbers of the week and its signals, plus the weekly review with the agent.
 */

const PAST_STEP = 14;
const PROMPTS = [msg("What am I grateful for?"), msg("What was hard today?"), msg("What do I take away?")];
const longDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(intlLocale(), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export function Journal() {
  return useRuhe() ? <JournalRuhe /> : <JournalVivid />;
}

function JournalVivid() {
  const th = useTheme();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<"day" | "week">(params.tab === "week" ? "week" : "day");
  useEffect(() => {
    if (params.tab === "week" || params.tab === "day") setTab(params.tab);
  }, [params.tab]);
  return (
    <ScreenScroll gap={16}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <T type="h3">{t("Journal")}</T>
        </View>
        <View accessibilityRole="tablist" style={{ flexDirection: "row", padding: 3, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }}>
          {(["day", "week"] as const).map((k) => (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => setTab(k)} style={{ minHeight: 34, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: tab === k ? th.bgSurfaceFlat : "transparent" }}>
              <T size={13} lh={18} ls={0} weight={tab === k ? 500 : 400} color={tab === k ? th.textPrimary : th.textSecondary}>
                {k === "day" ? t("Day") : t("Week")}
              </T>
            </Pressable>
          ))}
        </View>
      </View>
      {tab === "day" ? <Day /> : <JournalWeek embedded />}
    </ScreenScroll>
  );
}

function Day() {
  const th = useTheme();
  const a = useApp();
  const d = useData();
  const today = isoDay(new Date());
  const notes = dailyNotes(d.entries);
  const past = notes.filter((e) => e.date < today);
  const todayNote = notes.find((e) => e.date === today);
  const state = a.journalState;
  const router = useRouter();
  const act = useEntryActions();
  const [limit, setLimit] = useState(PAST_STEP);
  // Like the web journal: the writing heat map of the last twelve weeks (today counts what is typed right now).
  const byDate = new Map(notes.map((e) => [e.date, e]));
  const heat = heatCells(today, (date) => (date === today ? writingLevel(!!todayNote || a.journalText.trim().length > 0, a.journalText) : byDate.has(date) ? writingLevel(true, byDate.get(date)!.tldr ?? "") : 0));
  return (
    <View style={{ gap: 16 }}>
      <View style={panel(th, 10)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T size={13} lh={18} weight={500} style={{ flex: 1 }}>
            {t("Today · {date}", { date: longDay(today) })}
          </T>
          <Help>{state === "saving" ? t("Saving…") : state === "saved" ? t("Saved automatically") : state === "error" ? t("Saving failed") : ""}</Help>
        </View>
        <TextInput
          accessibilityLabel={t("Today's entry")}
          placeholder={t("What's on your mind today? One line per thought.")}
          placeholderTextColor={th.textMuted}
          value={a.journalText}
          onChangeText={a.setJournalText}
          editable={state !== "loading"}
          multiline
          style={[{ minHeight: 140, padding: 0, fontFamily: FONT.sans400, fontSize: 15, lineHeight: 22, color: th.textPrimary, textAlignVertical: "top" }, Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null]}
        />
        <View accessibilityLabel={t("Writing prompts")} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {PROMPTS.map((p) => (
            <Pressable key={p} accessibilityRole="button" disabled={state === "loading"} onPress={() => a.setJournalText(appendPrompt(a.journalText, t(p)))} style={{ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }}>
              <Icon name="plus" size={12} color={th.textSecondary} />
              <T size={12.5} lh={18} ls={0} color={th.textSecondary}>
                {t(p)}
              </T>
            </Pressable>
          ))}
        </View>
        {todayNote && (
          <Pressable accessibilityRole="button" onPress={() => a.openEntry(todayNote.id)} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 36 }}>
            <Icon name="note" size={13} color={th.tags.ai.fg} />
            <T size={12.5} lh={18} ls={0} color={th.tags.ai.fg}>
              {t("Open as note")}
            </T>
          </Pressable>
        )}
      </View>

      <View style={panel(th, 12)}>
        <Micro>{t("Last 12 weeks")}</Micro>
        <View accessibilityLabel={t("Writing activity of the last 12 weeks")} style={{ flexDirection: "row", gap: 3 }}>
          {Array.from({ length: 12 }, (_, w) => (
            <View key={w} style={{ flex: 1, gap: 3 }}>
              {heat.slice(w * 7, w * 7 + 7).map((c) => (
                <View key={c.date} style={{ aspectRatio: 1, borderRadius: 3, backgroundColor: c.isFuture ? "transparent" : c.level ? alpha(th.accentCheckin, [0, 0.3, 0.6, 1][c.level]!) : th.bgSurfaceMuted, borderWidth: c.isToday ? 1.5 : 0, borderColor: th.textSecondary }} />
              ))}
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="flame" size={14} color={th.accentCheckin} />
          <T num size={13} lh={18} ls={0} style={{ flex: 1 }}>
            {tn(a.streak, "{n} day streak", "{n} days streak")}
          </T>
          <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.navigate("/")} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <T size={12.5} lh={18} ls={0} color={th.tags.ai.fg}>
              {t("Check-in on Home too")}
            </T>
            <Icon name="chev" size={12} color={th.tags.ai.fg} />
          </Pressable>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Section>{t("Earlier entries")}</Section>
        {!past.length && <Help>{t("No earlier daily notes yet. Every day you capture here or in the check-in on Home appears in this list afterwards.")}</Help>}
        {past.slice(0, limit).map((e) => (
          <Pressable key={e.id} accessibilityRole="button" onPress={() => a.openEntry(e.id)} onLongPress={() => act.openMenu(e)} style={[{ minHeight: 56, gap: 2, justifyContent: "center", paddingVertical: 8, paddingHorizontal: 12 }, rowSurface(th)]}>
            <T size={14} lh={19} weight={500}>
              {longDay(e.date)}
            </T>
            <Help numberOfLines={2}>{e.tldr?.trim() || t("Check-in only, no text")}</Help>
          </Pressable>
        ))}
        {past.length > limit && (
          <Btn variant="ghost" sm onPress={() => setLimit((n) => n + PAST_STEP)}>
            {t("Show older entries ({n})", { n: past.length - limit })}
          </Btn>
        )}
      </View>
    </View>
  );
}
