import { intlLocale, msg, t, tn } from "../../i18n";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Platform, Pressable, TextInput, View, type ViewStyle } from "react-native";
import { isoDay } from "../../data/daily";
import { appendPrompt, dailyNotes, heatCells, writingLevel } from "../../lib/journal";
import { tick } from "../../lib/haptics";
import { useApp } from "../../state/AppState";
import { useData } from "../../state/Data";
import { alpha } from "../../theme/color";
import { useTheme } from "../../theme/ThemeProvider";
import { FONT, RUHE_SPACE } from "../../theme/tokens";
import { useEntryActions } from "../../ui/entryActions";
import { shortDay, useWeekSignals } from "../../ui/JournalWeek";
import { T } from "../../ui/primitives";
import { ScreenScroll } from "../../ui/Screen";
import { EmptyState, GroupHead, RButton, RButtonRow, RRow, RSegment, RText, RuheLocBar } from "../../ui/ruhe";

/*
 * Tagebuch, Ruhe (mockup "Tagebuch · dunkel" in mobil2, android-richtlinien.md 2, 8 A, 12): the date as eyebrow over
 * "Wie war Dein Tag?", Tag | Woche full width under it, the energy of today as one row of tiles, the day's entry and
 * the writing prompts as quiet input cards (lum2, r16), the last seven days as small energy bars, then the writing
 * heat map and the earlier days as list rows. Woche: the week's numbers and its signals as rows, the review button.
 */

const PAD = RUHE_SPACE.page;
const SURF = RUHE_SPACE.surface;
const PAST_STEP = 14;
const PROMPTS = [msg("What am I grateful for?"), msg("What was hard today?"), msg("What do I take away?")];
const longDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(intlLocale(), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const narrowDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(intlLocale(), { weekday: "short", timeZone: "UTC" }).replace(/\.$/, "");
const NO_OUTLINE = Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null;

/** The quiet input card of the journal (`lum2`, r16, padding 14 / 16; light: lum1 with a ring). */
function useCard(): ViewStyle {
  const th = useTheme();
  const dark = th.name === "dark";
  return { marginHorizontal: SURF, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: dark ? th.lum2 : th.lum1, ...(dark ? null : ({ boxShadow: `inset 0 0 0 1px ${th.hairStrong}` } as ViewStyle)) };
}

/** The answer written after a prompt line ("Wofür bin ich dankbar? Sonne"), or "" when the prompt is not there yet. */
function answerOf(text: string, prompt: string): string | null {
  const line = text.split("\n").find((l) => l.startsWith(prompt));
  return line === undefined ? null : line.slice(prompt.length).trim();
}

export function JournalRuhe() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<"day" | "week">(params.tab === "week" ? "week" : "day");
  useEffect(() => {
    if (params.tab === "week" || params.tab === "day") setTab(params.tab);
  }, [params.tab]);
  return (
    <ScreenScroll flush padTop={0}>
      <RuheLocBar eyebrow={longDay(isoDay(new Date()))} title={tab === "day" ? t("How was your day?") : t("Your week")} />
      <RSegment
        label={t("Journal")}
        value={tab}
        onChange={setTab}
        items={[
          { key: "day", label: t("Day") },
          { key: "week", label: t("Week") },
        ]}
        style={{ marginTop: 2, marginHorizontal: SURF }}
      />
      {tab === "day" ? <Day /> : <Week />}
    </ScreenScroll>
  );
}

function Day() {
  const th = useTheme();
  const a = useApp();
  const d = useData();
  const act = useEntryActions();
  const card = useCard();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const today = isoDay(new Date());
  const notes = dailyNotes(d.entries);
  const past = notes.filter((e) => e.date < today);
  const todayNote = notes.find((e) => e.date === today);
  const state = a.journalState;
  const [limit, setLimit] = useState(PAST_STEP);
  const byDate = new Map(notes.map((e) => [e.date, e]));
  const heat = heatCells(today, (date) => (date === today ? writingLevel(!!todayNote || a.journalText.trim().length > 0, a.journalText) : byDate.has(date) ? writingLevel(true, byDate.get(date)!.tldr ?? "") : 0));
  const saving = state === "saving" ? t("Saving…") : state === "saved" ? t("Saved automatically") : state === "error" ? t("Saving failed") : "";
  const dark = th.name === "dark";
  const addPrompt = (p: string) => {
    if (state === "loading") return;
    if (answerOf(a.journalText, p) === null) a.setJournalText(appendPrompt(a.journalText, p));
    input.current?.focus();
  };

  return (
    <View>
      <RText step="label" weight={400} color={th.t3} style={{ paddingTop: 16, paddingBottom: 8, paddingHorizontal: PAD }}>
        {t("Energy")}
      </RText>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("Energy")} style={{ flexDirection: "row", gap: 4, marginHorizontal: SURF }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const on = a.energy === n;
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={t("Energy {n} of 10", { n })}
              onPress={() => {
                tick();
                a.setEnergy(n);
              }}
              style={({ pressed }) => ({ flex: 1, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: on ? th.accentFill : dark ? th.lum2 : th.lum3, transform: [{ scale: pressed ? 0.97 : 1 }] })}
            >
              <T size={15} lh={20} ls={0} weight={400} color={on ? th.onAccent : th.t3} style={{ fontVariant: ["tabular-nums"] }}>
                {String(n)}
              </T>
            </Pressable>
          );
        })}
      </View>

      <View style={[card, { marginTop: 18, gap: 6 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <RText step="label" weight={400} color={th.t3} style={{ flex: 1 }}>
            {t("What's on your mind today?")}
          </RText>
          {!!saving && (
            <RText step="meta" color={state === "error" ? th.crit : th.t4}>
              {saving}
            </RText>
          )}
        </View>
        <TextInput
          ref={input}
          accessibilityLabel={t("Today's entry")}
          placeholder={t("One line per thought. Tap or hold the mic to speak.")}
          placeholderTextColor={th.t4}
          selectionColor={th.accent}
          value={a.journalText}
          onChangeText={a.setJournalText}
          editable={state !== "loading"}
          multiline
          style={[{ minHeight: 76, padding: 0, fontFamily: FONT.sans400, fontSize: 16, lineHeight: 25, color: th.t1, textAlignVertical: "top" }, NO_OUTLINE]}
        />
      </View>

      {PROMPTS.map((p) => {
        const label = t(p);
        const ans = answerOf(a.journalText, label);
        return (
          <Pressable key={p} accessibilityRole="button" accessibilityLabel={label} disabled={state === "loading"} onPress={() => addPrompt(label)} style={({ pressed }) => [card, { marginTop: 10, gap: 6, opacity: pressed ? 0.85 : 1 }]}>
            <RText step="label" weight={400} color={th.t3}>
              {label}
            </RText>
            <T size={16} lh={24} ls={0} weight={400} numberOfLines={3} color={ans ? th.t1 : th.t4}>
              {ans || t("Tap to add")}
            </T>
          </Pressable>
        );
      })}

      <View accessibilityLabel={t("Energy of the last seven days")} style={{ flexDirection: "row", gap: 6, paddingTop: 14, paddingHorizontal: SURF }}>
        {a.energyHistory.map((x) => {
          const isToday = x.date === today;
          return (
            <View key={x.date} style={{ flex: 1, alignItems: "center", gap: 5 }}>
              <RText step="micro" color={isToday ? th.accentInk : th.t4}>
                {narrowDay(x.date)}
              </RText>
              <View style={{ alignSelf: "stretch", marginHorizontal: 6, height: 4, borderRadius: 2, backgroundColor: x.energy == null ? th.lum3 : x.energy >= 5 ? th.ok : th.warn, opacity: x.energy == null ? 1 : 0.55 + x.energy * 0.045 }} />
            </View>
          );
        })}
      </View>

      {todayNote && (
        <RButtonRow style={{ marginTop: 14 }}>
          <RButton variant="ghost" size="sm" icon="note" label={t("Open as note")} onPress={() => a.openEntry(todayNote.id)} />
        </RButtonRow>
      )}

      <GroupHead label={t("Last 12 weeks")} right={<RText step="rowSub" tnum color={th.t3}>{tn(a.streak, "{n} day streak", "{n} days streak")}</RText>} />
      <View accessibilityLabel={t("Writing activity of the last 12 weeks")} style={{ flexDirection: "row", gap: 3, paddingHorizontal: PAD }}>
        {Array.from({ length: 12 }, (_, w) => (
          <View key={w} style={{ flex: 1, gap: 3 }}>
            {heat.slice(w * 7, w * 7 + 7).map((c) => (
              <View key={c.date} style={{ aspectRatio: 1, borderRadius: 3, backgroundColor: c.isFuture ? "transparent" : c.level ? alpha(th.t2, [0, 0.28, 0.55, 0.85][c.level]!) : dark ? th.lum2 : th.lum3, borderWidth: c.isToday ? 1.5 : 0, borderColor: th.accent }} />
            ))}
          </View>
        ))}
      </View>

      <GroupHead label={t("Earlier entries")} count={past.length || undefined} />
      {!past.length && (
        <RText step="rowSub" color={th.t3} style={{ paddingHorizontal: PAD }}>
          {t("No earlier daily notes yet. Every day you capture here or in the check-in on Home appears in this list afterwards.")}
        </RText>
      )}
      {past.slice(0, limit).map((e, i) => (
        <RRow key={e.id} first={i === 0} icon="note" title={longDay(e.date)} sub={e.tldr?.trim() || t("Check-in only, no text")} onPress={() => a.openEntry(e.id)} onLongPress={() => act.openMenu(e)} />
      ))}
      {past.length > limit && (
        <RButtonRow style={{ marginTop: 8 }}>
          <RButton variant="ghost" size="sm" label={t("Show older entries ({n})", { n: past.length - limit })} onPress={() => setLimit((n) => n + PAST_STEP)} />
        </RButtonRow>
      )}
    </View>
  );
}

function Week() {
  const th = useTheme();
  const a = useApp();
  const w = useWeekSignals();
  const dark = th.name === "dark";
  const rows: { key: string; title: string; items: { id: string; title: string; meta: string; late?: boolean; run?: () => void }[]; empty: string }[] = [
    { key: "rising", title: t("Topics on the rise"), empty: t("No topic stood out this week."), items: w.rising.map((r) => ({ id: r.tag, title: r.tag, meta: r.before ? t("{now} entries, {before} the week before", { now: r.now, before: r.before }) : tn(r.now, "{n} entry, new", "{n} entries, new"), run: () => w.showTag(r.tag) })) },
    { key: "loops", title: t("Open loops"), empty: t("Nothing open that is due this week."), items: w.loops.map((l) => ({ id: l.id, title: l.title, meta: l.overdue ? t("overdue since {date}", { date: shortDay(l.due) }) : shortDay(l.due), late: l.overdue, run: l.sourceId ? () => a.openEntry(l.sourceId!) : undefined })) },
    { key: "links", title: t("New connections"), empty: t("No new links between entries this week."), items: w.links.map((c) => ({ id: `${c.fromId}|${c.toId}`, title: c.from, meta: `→ ${c.to}`, run: () => a.openEntry(c.fromId) })) },
    { key: "back", title: t("Comes back this week"), empty: t("No reminders this week."), items: w.back.map((e) => ({ id: e.id, title: e.title, meta: shortDay(e.remindAt!.slice(0, 10)), run: () => a.openEntry(e.id) })) },
  ];
  return (
    <View>
      <View style={{ flexDirection: "row", gap: 6, paddingTop: 16, paddingHorizontal: SURF }}>
        {w.days.map((day) => {
          const n = w.perDay.get(day) ?? 0;
          const isToday = day === w.today;
          return (
            <View key={day} accessibilityLabel={`${shortDay(day)}, ${tn(n, "{n} entry", "{n} entries")}`} style={{ flex: 1, alignItems: "center", gap: 5 }}>
              <RText step="micro" color={isToday ? th.accentInk : th.t4}>
                {narrowDay(day)}
              </RText>
              <View style={{ alignSelf: "stretch", marginHorizontal: 4, height: 4, borderRadius: 2, backgroundColor: day > w.today ? (dark ? th.lum2 : th.lum3) : n ? alpha(th.t2, Math.min(0.9, 0.3 + n * 0.15)) : dark ? th.lum3 : th.lum4 }} />
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", paddingTop: 18, paddingHorizontal: PAD }}>
        {w.stats.map((x) => (
          <View key={x.l} style={{ flex: 1, gap: 2 }}>
            <T size={22} lh={28} ls={-0.02} weight={600} style={{ fontVariant: ["tabular-nums"] }}>
              {x.v}
            </T>
            <RText step="micro" color={th.t3} numberOfLines={2}>
              {x.l}
            </RText>
          </View>
        ))}
      </View>
      {!w.signals && <EmptyState icon="sun" pic="idea" size="md" title={t("Nothing stood out so far.")} help={t("Topics, open loops and new links of the week show up here as soon as there are some.")} />}
      {!!w.signals &&
        rows
          .filter((g) => g.items.length)
          .map((g) => (
            <View key={g.key}>
              <GroupHead label={g.title} count={g.items.length} />
              {g.items.map((x, i) => (
                <RRow key={x.id} first={i === 0} titleWeight={400} title={x.title} meta={x.meta} chevron={!!x.run} onPress={x.run} subColor={x.late ? th.crit : undefined} />
              ))}
            </View>
          ))}
      <RButtonRow style={{ marginTop: 20 }}>
        <RButton variant="primary" grow icon="sparkles" label={t("Weekly review with the agent")} onPress={w.review} />
      </RButtonRow>
      <View style={{ height: 8 }} />
    </View>
  );
}
