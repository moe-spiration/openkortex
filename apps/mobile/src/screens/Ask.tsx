import { t } from "../i18n";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Platform, Pressable, ScrollView, TextInput, View, type ViewStyle } from "react-native";
import { ASK_SUGGESTIONS, MODELS } from "../data/mock";
import { useData } from "../state/Data";
import { useApp } from "../state/AppState";
import { useTheme } from "../theme/ThemeProvider";
import { FONT, RADIUS } from "../theme/tokens";
import { useChrome } from "../ui/Chrome";
import { Icon } from "../ui/Icon";
import { Btn, glass, Micro, Spinner, T, Wave } from "../ui/primitives";
import { AgentSwitch } from "../ui/AgentSwitch";
import { AgentSeg } from "./ruhe/AgentRuhe";
import { RuheLocBar } from "../ui/ruhe";
import { useHeaderH } from "../ui/Shell";
import { LevelWave } from "../capture/LevelWave";
import { AgentChanges, AgentSteps } from "../ui/AgentCards";
import type { Autonomy } from "../lib/agent";
import { useKeyboardInset } from "../ui/useKeyboard";
import { useRouter } from "expo-router";
import { looksLikeStandingOrder } from "../lib/agentJobs";
import { runAgentOp } from "../state/agentJobs";

/*
 * Ask AI (Mobile.dc.html "Tab: Ask AI"): chat with sources, model pill, voice input. Live it is the agent of the web
 * Orbit-Bar (docs/agent-copilot.md): it searches and reads in steps and, by the autonomy pill, proposes or makes changes.
 */

const AUTONOMY_LABEL: Record<Autonomy, () => string> = {
  read: () => t("Read only"),
  ask: () => t("Ask first"),
  self: () => t("On its own"),
};

/** Agent skills as slash commands (the German words, like the web Orbit-Bar in German). */
const SKILL_CMDS: { cmd: () => string; label: () => string }[] = [
  { cmd: () => t("/briefing "), label: () => t("Briefing for a person, company or project") },
  { cmd: () => t("/research "), label: () => t("Research a topic across your vault") },
  { cmd: () => t("/dossier "), label: () => t("Bring a dossier up to date") },
  { cmd: () => t("/draft "), label: () => t("Draft a mail or text in your tone") },
  { cmd: () => t("/week"), label: () => t("Weekly review with open loops") },
  { cmd: () => t("/tidy"), label: () => t("Sort the inbox and find duplicates") },
];

/** Quick actions of the live chat; the last one refers to the newest entry. */
const LIVE_SUGGESTIONS = (latest?: string) => [
  t("What did I save this week?"),
  t("Which open points do I have?"),
  ...(latest ? [t("Flashcards on “{title}”", { title: latest.slice(0, 40) })] : []),
  t("What should I review?"),
];

export function Ask() {
  const th = useTheme();
  const ruhe = th.look === "ruhe";
  const { top } = useChrome();
  const kb = useKeyboardInset();
  const a = useApp();
  const { entryById, auth, entries } = useData();
  const live = auth === "live";
  const d = useData();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const headerH = useHeaderH();
  // Scope of the next question: the whole vault or one entry (the chip next to the input).
  const [scopeId, setScopeId] = useState<string | null>(null);
  // Source peek: the entry behind a tapped source chip, shown in a bottom sheet without leaving the chat.
  const [peekId, setPeekId] = useState<string | null>(null);
  const scopeEntry = scopeId ? entryById(scopeId) : undefined;
  const router = useRouter();
  const send = (text: string) => {
    // Like the web Orbit-Bar: "Jeden Morgen um 6 …" becomes a standing order instead of a chat question.
    if (live && looksLikeStandingOrder(text) && text.trim().split(/\s+/).length >= 3) {
      a.setAskText("");
      void runAgentOp({ op: "order_add", text: text.trim() }).then((r) =>
        a.say(r.error ? t("That did not work: {error}", { error: r.error }) : t("Standing order created"), r.error ? undefined : { label: t("Show"), run: () => router.navigate("/agent") }),
      );
      return;
    }
    a.ask(text, scopeEntry?.id);
  };
  /**
   * The send arrow. While recording it ends the recording and sends what was said (with what was
   * typed before); during the transcription it waits for the text. Nothing is dropped silently.
   */
  const submit = async () => {
    if (!a.askRec && !a.askTranscribing) return send(a.askText);
    const text = await a.finishAskRec();
    if (text) send(text);
  };
  const pickScope = () =>
    a.openMenu({
      title: t("Scope of the question"),
      items: [
        { label: t("Whole vault"), icon: "grid", run: () => setScopeId(null) },
        ...entries.slice(0, 5).map((e) => ({ label: e.title, icon: "note" as const, run: () => setScopeId(e.id) })),
      ],
    });
  /** One tap: the answer becomes a note (with its sources), fire and forget. */
  const saveAnswer = (text: string, titles: string[]) => {
    const title = text.replace(/\s+/g, " ").slice(0, 60).trim() || t("Answer from Kortex");
    const md = `${text}${titles.length ? `\n\n${t("Sources: {list}", { list: titles.map((x) => `[[${x}]]`).join(", ") })}` : ""}`;
    void d.writeNote(null, title, md).then((r) => a.say("error" in r ? r.error : t("Saved as a note")));
  };
  const peek = peekId ? entryById(peekId) : undefined;
  const pickAutonomy = () =>
    a.openMenu({
      title: t("What may the agent do?"),
      items: [
        { label: `${AUTONOMY_LABEL.read()} · ${t("Searches and answers, changes nothing")}`, icon: "eye", run: () => a.setAutonomy("read") },
        { label: `${AUTONOMY_LABEL.ask()} · ${t("Proposes changes, you confirm them")}`, icon: "check", run: () => a.setAutonomy("ask") },
        { label: `${AUTONOMY_LABEL.self()} · ${t("Makes changes at once, you can undo them")}`, icon: "bolt", run: () => a.setAutonomy("self") },
      ],
    });
  const pickSkill = () =>
    a.openMenu({
      title: t("Agent skills"),
      items: SKILL_CMDS.map((s) => ({ label: `${s.cmd().trim()} · ${s.label()}`, icon: "sparkles", run: () => a.setAskText(s.cmd()) })),
    });
  // Ruhe: quiet action chips (28 high, r8, lum2) without accent tint; the model and the tools move into "…".
  const chip = (on = false): ViewStyle =>
    ruhe ? { height: 32, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, borderRadius: 8, backgroundColor: on ? th.accentSoft : th.name === "dark" ? th.lum2 : th.lum3 } : { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: on ? th.accentAiSoft : th.bgSurfaceMuted };
  const chipIcon = (on = false) => (ruhe ? (on ? th.accentInk : th.t3) : on ? th.tags.ai.fg : th.textSecondary);
  const moreMenu = () =>
    a.openMenu({
      title: t("Agent"),
      items: [
        { label: live ? t("Model: {model}", { model: "Auto" }) : t("Model: {model}", { model: MODELS[a.model] ?? "" }), icon: "sparkles", run: live ? () => a.say(t("The model follows your routing (web: Settings → AI)")) : a.nextModel },
        ...(live ? [{ label: `${t("Agent")}: ${AUTONOMY_LABEL[a.autonomy]()}`, icon: "check", run: pickAutonomy }, { label: t("Skills"), icon: "sparkles", run: pickSkill }, { label: t("Report status"), icon: "check", run: () => a.setAskText("/status ") }] : []),
        ...(a.msgs.length ? [{ label: t("New chat"), icon: "plus", run: a.resetChat }] : []),
      ],
    });
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [a.msgs.length, a.thinking]);

  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: top + headerH, bottom: kb, zIndex: kb ? 20 : 1, backgroundColor: kb ? th.bgMainWindow : undefined }}>
      {ruhe ? (
        <View style={{ paddingBottom: 8 }}>
          <RuheLocBar title={t("Agent")} actions={[{ icon: "more", label: t("More"), onPress: moreMenu }]} />
          <AgentSeg cur="ask" />
        </View>
      ) : (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 8, paddingHorizontal: 18, paddingBottom: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T type={th.look === "ruhe" ? "h1" : "h3"}>Agent</T>
          </View>
          <AgentSwitch cur="ask" />
          <Pressable accessibilityRole="button" accessibilityLabel={t("Switch model")} onPress={live ? () => a.say(t("The model follows your routing (web: Settings → AI)")) : a.nextModel} style={{ height: 32, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 10, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: th.accentAi, boxShadow: `0 0 0 3px ${th.accentAiSoft}` } as ViewStyle} />
            <T size={12} lh={18} ls={0}>
              {live ? "Auto" : MODELS[a.model]}
            </T>
          </Pressable>
        </View>
      )}

      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 18, paddingBottom: 12, gap: 14 }} showsVerticalScrollIndicator={false}>
        {a.msgs.map((m, i) =>
          m.me ? (
            <View key={i} style={[{ alignSelf: "flex-end", maxWidth: "82%", paddingVertical: 10, paddingHorizontal: ruhe ? 14 : 12, borderRadius: ruhe ? 16 : RADIUS.row, backgroundColor: ruhe ? (th.name === "dark" ? th.lum2 : th.lum3) : th.bgSurfaceMuted }]}>
              <T size={ruhe ? 15 : 14} lh={ruhe ? 22 : 21} weight={400} ls={0}>
                {m.text}
              </T>
            </View>
          ) : (
            <View key={i} style={{ gap: 8 }}>
              {!!m.steps?.length && <AgentSteps steps={m.steps} />}
              {!!m.text && (
                <T type="read">
                  {m.text}
                </T>
              )}
              <AgentChanges m={m} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                {(m.ids ?? []).map((id, n) => (
                  <Pressable key={id} accessibilityRole="button" accessibilityLabel={t("View source {n}", { n: n + 1 })} onPress={() => setPeekId(id)} hitSlop={{ top: 6, bottom: 6 }} style={ruhe ? chip() : { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }}>
                    <View style={{ width: 18, height: 18, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: ruhe ? "transparent" : th.accentAiSoft }}>
                      <T mono={!ruhe} num={ruhe} size={ruhe ? 12 : 11} lh={14} ls={0} weight={ruhe ? 500 : 400} color={ruhe ? th.t3 : th.tags.ai.fg}>
                        {n + 1}
                      </T>
                    </View>
                    <T size={12} lh={18} ls={0} color={th.textSecondary} numberOfLines={1} style={{ maxWidth: 200 }}>
                      {m.titles?.[n] ?? entryById(id)?.title}
                    </T>
                  </Pressable>
                ))}
              </View>
              {!!m.action && (
                <Btn variant="primary" sm icon="check" style={{ alignSelf: "flex-start" }} onPress={m.action.run}>
                  {m.action.label}
                </Btn>
              )}
              {!m.action && !!m.ids?.length && (
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Pressable accessibilityRole="button" onPress={() => saveAnswer(m.text, (m.titles ?? m.ids?.map((x) => entryById(x)?.title ?? "") ?? []).filter(Boolean))} style={ruhe ? chip() : { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }}>
                    <Icon name="note" size={14} color={th.textSecondary} />
                    <T size={12} lh={18} ls={0} color={th.textSecondary}>
                      {t("Save as a note")}
                    </T>
                  </Pressable>
                </View>
              )}
            </View>
          ),
        )}
        {a.thinking && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Spinner />
            <T size={14} lh={21} color={th.textMuted}>
              {a.agentStep ?? t("Searching your vault")}
            </T>
          </View>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: 14, paddingBottom: kb ? 10 : 100, gap: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Choose the scope of the question")} onPress={pickScope} style={[chip(!!scopeEntry), { maxWidth: 220 }]}>
            <Icon name={scopeEntry ? "note" : "grid"} size={14} color={chipIcon(!!scopeEntry)} />
            <T size={ruhe ? 12.5 : 12} lh={18} ls={0} numberOfLines={1} color={ruhe ? (scopeEntry ? th.accentInk : th.t2) : scopeEntry ? th.tags.ai.fg : th.textSecondary} style={{ flexShrink: 1 }}>
              {scopeEntry ? scopeEntry.title : t("Whole vault")}
            </T>
            <Icon name="chev" size={12} color={th.textMuted} rotate={90} />
          </Pressable>
          {live && !ruhe && (
            <Pressable accessibilityRole="button" accessibilityLabel={t("Agent: {level}", { level: AUTONOMY_LABEL[a.autonomy]() })} onPress={pickAutonomy} style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: a.autonomy === "read" ? th.bgSurfaceMuted : th.accentAiSoft }}>
              <Icon name={a.autonomy === "read" ? "eye" : a.autonomy === "ask" ? "check" : "bolt"} size={14} color={a.autonomy === "read" ? th.textSecondary : th.tags.ai.fg} />
              <T size={12} lh={18} ls={0} color={a.autonomy === "read" ? th.textSecondary : th.tags.ai.fg}>
                {AUTONOMY_LABEL[a.autonomy]()}
              </T>
              <Icon name="chev" size={12} color={th.textMuted} rotate={90} />
            </Pressable>
          )}
          {live && !ruhe && (
            <Pressable accessibilityRole="button" onPress={pickSkill} style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }}>
              <Icon name="sparkles" size={14} color={th.tags.ai.fg} />
              <T size={12} lh={18} ls={0} color={th.textSecondary}>
                {t("Skills")}
              </T>
            </Pressable>
          )}
          {live && !ruhe && a.msgs.length > 0 && (
            <Pressable accessibilityRole="button" onPress={a.resetChat} style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }}>
              <Icon name="plus" size={14} color={th.textSecondary} />
              <T size={12} lh={18} ls={0} color={th.textSecondary}>
                {t("New chat")}
              </T>
            </Pressable>
          )}
          {live && !ruhe && (
            <Pressable accessibilityRole="button" accessibilityHint={t("Example: read Dune, 9 out of 10")} onPress={() => a.setAskText("/status ")} style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }}>
              <Icon name="check" size={14} color={th.tags.ai.fg} />
              <T size={12} lh={18} ls={0} color={th.textSecondary}>
                {t("Report status")}
              </T>
            </Pressable>
          )}
          {(live ? LIVE_SUGGESTIONS(entries[0]?.title) : ASK_SUGGESTIONS).map((l) => (
            <Pressable key={l} accessibilityRole="button" onPress={() => send(l)} style={chip()}>
              <Icon name="sparkles" size={14} color={chipIcon()} />
              <T size={ruhe ? 12.5 : 12} lh={18} ls={0} color={ruhe ? th.t2 : th.textSecondary}>
                {l}
              </T>
            </Pressable>
          ))}
        </ScrollView>
        <View style={ruhe ? ({ height: 52, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 18, paddingRight: 6, borderRadius: 26, backgroundColor: th.name === "dark" ? th.lum2 : th.lum1, boxShadow: `0 0 0 1px ${th.hairStrong}` } as ViewStyle) : [{ height: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 18, paddingRight: 6, borderRadius: RADIUS.pill, boxShadow: `inset 0 1px 0 0 ${th.borderSubtle}, ${th.shadowFloating}` } as ViewStyle, glass(th)]}>
          {a.askRec ? (
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
              {a.voiceRecorder ? <LevelWave recorder={a.voiceRecorder} n={34} h={20} /> : <Wave n={30} h={18} />}
            </View>
          ) : a.askTranscribing ? (
            <View accessibilityLiveRegion="polite" style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Spinner />
              <T size={14} lh={20} color={th.textMuted} numberOfLines={1} style={{ flexShrink: 1 }}>
                {t("Turning your words into text …")}
              </T>
            </View>
          ) : (
            <TextInput
              accessibilityLabel={t("Question for Kortex")}
              placeholder={t("Ask your Second Brain")}
              placeholderTextColor={ruhe ? th.t4 : th.textMuted}
              selectionColor={th.accent}
              value={a.askText}
              onChangeText={a.setAskText}
              onSubmitEditing={() => void submit()}
              returnKeyType="send"
              style={[{ flex: 1, minWidth: 0, height: 52, padding: 0, fontFamily: FONT.sans400, fontSize: ruhe ? 15 : 14, color: th.textPrimary, letterSpacing: -0.005 * 14 }, Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null]}
            />
          )}
          <Btn variant="ghost" round iconOnly size={40} icon={a.askRec ? "stop" : "mic"} style={a.askTranscribing ? { opacity: 0.4 } : undefined} accessibilityLabel={a.askRec ? t("Stop voice input") : t("Speak your question")} onPress={a.toggleAskRec} />
          <Btn variant="primary" round iconOnly size={40} icon="send" accessibilityLabel={a.askRec ? t("Stop and send") : t("Send")} onPress={() => void submit()} />
        </View>
      </View>

      {peek && (
        <>
          <Pressable accessibilityLabel={t("Close source")} onPress={() => setPeekId(null)} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 30, backgroundColor: "rgba(4,4,6,0.4)" }} />
          <View accessibilityRole="alert" style={[{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 31, gap: 10, paddingTop: 12, paddingHorizontal: 18, paddingBottom: 100, borderTopLeftRadius: RADIUS.card, borderTopRightRadius: RADIUS.card, boxShadow: `inset 0 1px 0 0 ${th.borderSubtle}, ${th.shadowFloating}` } as ViewStyle, glass(th)]}>
            <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: th.borderSubtle }} />
            <Micro>{t("Source · {type}", { type: peek.type })}</Micro>
            <T type="h3">{peek.title}</T>
            <T type="body" color={th.textSecondary} numberOfLines={6} style={{ borderLeftWidth: 2, borderLeftColor: th.accentAiSoft, paddingLeft: 12 }}>
              {peek.tldr || peek.content?.slice(0, 400) || t("No preview available.")}
            </T>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Btn variant="primary" grow minHeight={48} onPress={() => { setPeekId(null); a.openEntry(peek.id); }}>
                {t("Open entry")}
              </Btn>
              <Btn iconOnly icon="x" size={48} accessibilityLabel={t("Close")} onPress={() => setPeekId(null)} />
            </View>
          </View>
        </>
      )}
    </View>
  );
}
