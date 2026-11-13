import { intlLocale, t, tn } from "../i18n";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { runAgentOp } from "../state/agentJobs";
import { buildStack, nextDay, parseStackState, presortPrompt, stackCopy, type StackCard, type StackKind, type StackOutcome } from "../lib/stack";
import { remindOptions } from "../lib/remind";
import { buzz } from "../lib/haptics";
import { useData } from "../state/Data";
import { useApp } from "../state/AppState";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { Btn, Help, Micro, Photo, Section, T } from "./primitives";

/*
 * Tagesstapel (like the web Home): today's decisions as a deck. Swipe right or the main button = its action
 * ("Erledigt", "Öffnen", "Wusste ich"), swipe left = put aside ("Morgen", "Später", "Nicht heute").
 * Outcomes are kept per day on the device; every step can be undone from the toast.
 */

const STACK_KEY = "kortex.stack.v1";
const KIND_ICON: Record<StackKind, IconName> = { task: "check", remind: "bell", inbox: "inbox", filed: "folder", redis: "sparkles", flash: "book" };
const SWIPE = 96;

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function DailyStack() {
  const th = useTheme();
  const a = useApp();
  const d = useData();
  const today = localDay();
  const cards = useMemo(
    () => buildStack({ entries: d.entries, tasks: d.tasks, home: d.home, today, now: new Date(), locale: intlLocale(), titleOf: (id) => d.entryById(id)?.title }),
    [d.entries, d.tasks, d.home, d.entryById, today],
  );
  const [done, setDone] = useState<Record<string, StackOutcome>>({});
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    void AsyncStorage.getItem(STACK_KEY)
      .then((raw) => setDone(parseStackState(raw, today)))
      .catch(() => undefined);
  }, [today]);
  const save = (next: Record<string, StackOutcome>) => {
    setDone(next);
    void AsyncStorage.setItem(STACK_KEY, JSON.stringify({ day: today, done: next })).catch(() => undefined);
  };
  const open = cards.filter((c) => !done[c.id]);
  const cur = open[0];

  const router = useRouter();
  const [sorting, setSorting] = useState(false);
  const presort = async () => {
    if (sorting) return;
    setSorting(true);
    const r = await runAgentOp({ op: "start", prompt: presortPrompt(open), title: t("Presort the daily stack"), origin: "presort" });
    setSorting(false);
    a.say(r.error ? t("That did not work: {error}", { error: r.error }) : t("The agent is looking through your stack"), r.error ? undefined : { label: t("Show"), run: () => router.navigate("/agent") });
  };

  const x = useRef(new Animated.Value(0)).current;
  const act = useRef<(o: StackOutcome) => void>(() => undefined);

  act.current = (outcome) => {
    if (!cur) return;
    const c = stackCopy(cur.kind);
    const report = (p: Promise<string | null>) => void p.then((err) => err && a.say(t("Not saved: {error}", { error: err })));
    let undo = () => undefined as void;
    switch (cur.kind) {
      case "task": {
        const id = cur.refId!;
        const task = d.tasks.find((x) => x.id === id);
        if (outcome === "done") {
          report(d.toggleTask(id));
          undo = () => report(d.toggleTask(id));
        } else {
          const before = task?.due_date ?? today;
          report(d.patchTask(id, { due_date: nextDay(today) }));
          undo = () => report(d.patchTask(id, { due_date: before.slice(0, 10) }));
        }
        break;
      }
      case "remind": {
        const id = cur.refId!;
        const before = d.entryById(id)?.remindAt ?? null;
        const tomorrow = remindOptions().find((o) => o.key === "tomorrow");
        report(d.setReminder(id, outcome === "done" ? null : (tomorrow?.iso ?? null)));
        undo = () => report(d.setReminder(id, before));
        break;
      }
      case "flash":
        if (!flipped) {
          setFlipped(true);
          return;
        }
        break;
      case "filed":
        if (outcome === "aside" && cur.open) a.openEntry(cur.open);
        break;
      default:
        if (outcome === "done" && cur.open) a.openEntry(cur.open);
    }
    buzz();
    setFlipped(false);
    const id = cur.id;
    const before = done;
    save({ ...done, [id]: outcome });
    a.say(outcome === "done" ? c.done : c.aside, {
      label: t("Undo"),
      run: () => {
        undo();
        save(before);
      },
    });
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => x.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        const out = g.dx > SWIPE ? "done" : g.dx < -SWIPE ? "aside" : null;
        if (!out) return Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
        Animated.timing(x, { toValue: out === "done" ? 480 : -480, duration: 160, useNativeDriver: true }).start(() => {
          x.setValue(0);
          act.current(out);
        });
      },
      onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(),
    }),
  ).current;

  if (!cards.length) return null;
  const left = open.length;

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Section>{t("Daily stack")}</Section>
        </View>
        {/* Like the web: the agent looks through the open cards and proposes what it can take over. */}
        {open.length >= 2 && (
          <Btn variant="ghost" sm minHeight={32} icon="sparkles" onPress={() => void presort()}>
            {sorting ? t("Sorting …") : t("Presort")}
          </Btn>
        )}
        <View accessibilityLabel={tn(left, "{n} card left", "{n} cards left")} style={{ flexDirection: "row", gap: 4 }}>
          {cards.map((c) => (
            <View key={c.id} style={{ width: c.id === cur?.id ? 14 : 6, height: 6, borderRadius: 3, backgroundColor: done[c.id] ? th.textMuted : c.id === cur?.id ? th.accentAi : th.borderSubtle }} />
          ))}
        </View>
      </View>
      {cur ? (
        <View>
          <View>
          {/* The next card peeks out below the current one. */}
          {open[1] && <View style={{ position: "absolute", left: 10, right: 10, bottom: -6, height: 40, borderRadius: RADIUS.card, backgroundColor: th.bgSurfaceMuted }} />}
          <Animated.View
            {...pan.panHandlers}
            style={{ transform: [{ translateX: x }, { rotate: x.interpolate({ inputRange: [-300, 0, 300], outputRange: ["-6deg", "0deg", "6deg"] }) }] }}
          >
            <Card card={cur} flipped={flipped} onFlip={() => setFlipped(true)} onAct={(o) => act.current(o)} />
          </Animated.View>
          </View>
          <Help style={{ marginTop: 14, textAlign: "center" }}>{t("Swipe right for the action, left to put it aside")}</Help>
        </View>
      ) : (
        <View style={{ alignItems: "center", gap: 6, padding: 18, borderRadius: RADIUS.card, backgroundColor: th.bgSurfaceFlat }}>
          <Icon name="check" size={20} color={th.statusSynced} />
          <T size={15} lh={22} weight={500}>
            {t("Stack done for today")}
          </T>
          <Btn variant="ghost" sm onPress={() => save({})}>
            {t("Show again")}
          </Btn>
        </View>
      )}
    </View>
  );
}

function Card({ card, flipped, onFlip, onAct }: { card: StackCard; flipped: boolean; onFlip: () => void; onAct: (o: StackOutcome) => void }) {
  const th = useTheme();
  const a = useApp();
  const c = stackCopy(card.kind);
  const showAnswer = card.kind === "flash" && !flipped;
  return (
    <View style={[{ borderRadius: RADIUS.card, overflow: "hidden", backgroundColor: th.bgSurfaceFlat, boxShadow: th.shadowFloating } as ViewStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel={card.title} onPress={() => (card.kind === "flash" ? onFlip() : card.open && a.openEntry(card.open))}>
        {card.img ? (
          <View style={{ height: 150 }}>
            <Photo source={card.img} />
            <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]} locations={[0.35, 1]} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
            <View style={{ position: "absolute", left: 14, bottom: 10, flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name={KIND_ICON[card.kind]} size={14} color="#FFFFFF" />
              <T size={12} lh={16} ls={0} weight={500} color="#FFFFFF">
                {c.kind}
              </T>
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 14, paddingHorizontal: 14 }}>
            <View style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: th.accentAiSoft }}>
              <Icon name={KIND_ICON[card.kind]} size={15} color={th.tags.ai.fg} />
            </View>
            <Micro>{c.kind}</Micro>
          </View>
        )}
        <View style={{ gap: 6, paddingTop: 10, paddingHorizontal: 14 }}>
          <T type="h3" numberOfLines={3}>
            {card.title}
          </T>
          {card.kind === "flash" ? (
            flipped ? (
              <T size={14} lh={21} color={th.textSecondary}>
                {card.answer}
              </T>
            ) : (
              <Help>{t("Tap to see the answer")}</Help>
            )
          ) : (
            !!card.sub && <Help numberOfLines={3}>{card.sub}</Help>
          )}
          {card.chips.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {card.chips.map((x) => (
                <View key={x} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }}>
                  <T size={11.5} lh={16} ls={0} numberOfLines={1} color={th.textSecondary}>
                    {x}
                  </T>
                </View>
              ))}
            </View>
          )}
        </View>
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8, padding: 14 }}>
        {showAnswer ? (
          <Btn variant="primary" block minHeight={44} onPress={onFlip}>
            {t("Show answer")}
          </Btn>
        ) : (
          <>
            <Btn variant="ghost" minHeight={44} grow onPress={() => onAct("aside")}>
              {c.sec}
            </Btn>
            <Btn variant="primary" minHeight={44} grow icon="check" onPress={() => onAct("done")}>
              {c.pri}
            </Btn>
          </>
        )}
      </View>
    </View>
  );
}
