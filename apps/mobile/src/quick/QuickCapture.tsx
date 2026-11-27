import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, BackHandler, Linking, Pressable, Text, TextInput, useColorScheme, View, type ViewStyle } from "react-native";
import { createTask, secureStorage } from "../api/kortex";
import { APP_VERSION } from "../api/config";
import { requestFromShare } from "../api/ingest";
import { hasSession } from "../api/restore";
import { LevelWave, takePeakDb } from "../capture/LevelWave";
import { voiceRejection } from "../capture/level";
import { createQueue, type QueueJob } from "../capture/queue";
import { sendCapture } from "../capture/send";
import { useVoice } from "../capture/useVoice";
import { t } from "../i18n";
import { restoreDeviceLocale } from "../i18n/device";
import { createTheme, DEFAULT_ACCENT, RUHE_GLASS } from "../theme/tokens";
import { alpha } from "../theme/color";
import { dropOf } from "../ui/ruhe/glass";
import { storedStyle, type StoredStyle } from "../widgets/data";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/iconShapes";
import { quickKindOf, type QuickKind } from "../widgets/model";

/*
 * Quick overlay over the home screen (QuickCaptureActivity, plugins/with-quick-capture.js). The widgets open it
 * for a note, a voice memo or a task: a small card, nothing else of the app is drawn. It sends straight to
 * Kortex, keeps an offline capture in the app's queue, redraws the widgets and closes itself.
 */

type Phase = "loading" | "signedOut" | "edit" | "recording" | "sending" | "done" | "error";

const close = () => BackHandler.exitApp();
const refreshWidgets = () => void import("../widgets/refresh").then((m) => m.refreshWidgets()).catch(() => undefined);
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

const TITLE: Record<QuickKind, () => string> = { note: () => t("Note"), voice: () => t("Voice memo"), task: () => t("New task") };
const ICON: Record<QuickKind, IconName> = { note: "note", voice: "mic", task: "checkSquare" };

export function QuickCapture(props: { kind?: string }) {
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const [style, setStyle] = useState<StoredStyle>({ accent: DEFAULT_ACCENT, look: "ruhe", themePref: 0 });
  const th = createTheme(style.themePref === 1 ? "light" : style.themePref === 2 ? "dark" : system, style.accent, style.look);
  const ruhe = style.look === "ruhe";
  const [kind, setKind] = useState<QuickKind>(() => quickKindOf(props.kind));
  const [phase, setPhase] = useState<Phase>("loading");
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [sec, setSec] = useState(0);
  const voice = useVoice();
  const queue = useMemo(() => createQueue(secureStorage), []);
  const started = useRef(0);

  const startVoice = useCallback(async () => {
    setPhase("recording");
    setSec(0);
    started.current = Date.now();
    if (!(await voice.start())) {
      setMessage(t("Microphone access not granted"));
      setPhase("error");
    } else takePeakDb(voice.recorder);
  }, [voice]);

  useEffect(() => {
    void (async () => {
      await restoreDeviceLocale();
      setStyle(await storedStyle());
      if (!(await hasSession())) return setPhase("signedOut");
      if (kind === "voice") await startVoice();
      else setPhase("edit");
    })();
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setSec(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(id);
  }, [phase]);

  // Back or a tap outside: a running recording is thrown away, a send in flight carries on.
  const dismiss = useCallback(() => {
    if (phase === "recording") void voice.cancel();
    close();
  }, [phase, voice]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [dismiss]);

  const finish = (msg: string) => {
    setMessage(msg);
    setPhase("done");
    refreshWidgets();
    setTimeout(close, 900);
  };
  const fail = (msg: string) => {
    setMessage(msg);
    setPhase("error");
  };

  const sendText = async () => {
    const v = text.trim();
    if (!v) return;
    setPhase("sending");
    if (kind === "task") {
      try {
        await createTask(v);
        return finish(t("Task added"));
      } catch (e) {
        return fail(e instanceof Error ? e.message : t("Error while saving"));
      }
    }
    // A pasted link becomes a web clip (the server fetches the page), anything else a note.
    const req = requestFromShare({ text: v }, APP_VERSION);
    if (!req) return fail(t("Write down a thought first"));
    const job: QueueJob = { kind: "ingest", title: v.slice(0, 40), req };
    const r = await sendCapture(job);
    if (r.result === "ok") return finish(r.duplicate ? t("Already in the vault, nothing saved twice") : req.kind === "web_clip" ? t("Link in the Inbox") : t("Note in the Inbox"));
    if (r.result === "retry") {
      await queue.add(job);
      return finish(t("Saved offline, will be sent as soon as Kortex is reachable"));
    }
    fail(r.error ?? t("Error while saving"));
  };

  const sendVoice = async () => {
    const seconds = Math.floor((Date.now() - started.current) / 1000);
    const bad = voiceRejection(seconds, takePeakDb(voice.recorder));
    if (bad) {
      await voice.cancel();
      return fail(bad === "short" ? t("Too short. Speak a little longer.") : t("Nothing understood. Check the microphone and speak louder."));
    }
    setPhase("sending");
    const uri = await voice.stop();
    if (!uri) return fail(t("Recording failed"));
    const job: QueueJob = { kind: "voice", title: t("Voice memo {time}", { time: clock(seconds) }), uri };
    // Stored first: closing the card (or the phone ending the process) never loses the memo, the app sends it later.
    const id = await queue.put(job);
    const r = await sendCapture(job);
    if (r.result !== "retry") await queue.remove(id);
    if (r.result === "ok") return finish(r.duplicate ? t("Already in the vault, nothing saved twice") : t("Voice memo in the Inbox"));
    if (r.result === "retry") return finish(t("Saved offline, will be sent as soon as Kortex is reachable"));
    fail(r.nothingHeard ? t("Nothing understood") : (r.error ?? t("Error while saving")));
  };

  const button = (label: string, onPress: () => void, primary: boolean, icon?: IconName, disabled = false) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => (ruhe ? { flex: 1, height: 44, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: primary ? th.accentFill : th.lum3, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] } : { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 999, backgroundColor: primary ? th.accentFill : th.lum3, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 })}
    >
      {icon && <Icon name={icon} color={primary ? th.onAccent : th.t1} size={17} strokeWidth={2} />}
      <Text style={{ color: primary ? th.onAccent : th.t1, fontSize: 15, fontWeight: ruhe ? "500" : "700" }}>{label}</Text>
    </Pressable>
  );

  const chip = (k: QuickKind) => {
    const on = k === kind;
    return (
      <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setKind(k)} style={ruhe ? { height: 28, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, borderRadius: 8, backgroundColor: on ? th.t1 : th.name === "dark" ? th.lum2 : th.lum3 } : { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: on ? th.accentSoft : "transparent", borderWidth: 1, borderColor: on ? th.accentLine : th.hair }}>
        <Icon name={ICON[k]} color={ruhe ? (on ? th.lum1 : th.t2) : on ? th.accent : th.t3} size={ruhe ? 12 : 14} strokeWidth={ruhe ? 1.4 : 2} />
        <Text style={{ color: ruhe ? (on ? th.lum1 : th.t2) : on ? th.accent : th.t2, fontSize: ruhe ? 12.5 : 13, fontWeight: ruhe ? "400" : "600" }}>{TITLE[k]()}</Text>
      </Pressable>
    );
  };

  let body: ReactNode;
  if (phase === "loading") body = <ActivityIndicator color={th.accent} style={{ marginVertical: 24 }} />;
  else if (phase === "signedOut")
    body = (
      <>
        <Text style={{ color: th.t2, fontSize: 14, marginBottom: 16 }}>{t("Sign in to Kortex first, then the widgets save directly.")}</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>{button(t("Open Kortex"), () => void Linking.openURL("kortex://open").finally(close), true)}</View>
      </>
    );
  else if (phase === "recording")
    body = (
      <>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 14 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: th.crit }} />
          <Text style={{ color: th.t1, fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"], width: 56 }}>{clock(sec)}</Text>
          <View style={{ flex: 1, overflow: "hidden" }}>
            <LevelWave recorder={voice.recorder} n={30} h={30} color={th.accent} />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {button(t("Discard"), dismiss, false, "trash")}
          {button(t("Send"), () => void sendVoice(), true, "send")}
        </View>
      </>
    );
  else if (phase === "sending")
    body = (
      <>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 18 }}>
          <ActivityIndicator color={th.accent} />
          <Text style={{ color: th.t2, fontSize: 14, flex: 1 }}>{kind === "voice" ? t("Transcribing") : t("Saving")}</Text>
        </View>
        {kind === "voice" && <View style={{ flexDirection: "row" }}>{button(t("Close, keeps running"), close, false)}</View>}
      </>
    );
  else if (phase === "done")
    body = (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 18 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: th.accentFill }}>
          <Icon name="check" color={th.onAccent} size={16} strokeWidth={3} />
        </View>
        <Text style={{ color: th.t1, fontSize: 15, fontWeight: "600", flex: 1 }}>{message}</Text>
      </View>
    );
  else if (phase === "error")
    body = (
      <>
        <Text style={{ color: th.crit, fontSize: 14, marginVertical: 12 }}>{message}</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {button(t("Close"), close, false)}
          {button(t("Try again"), () => (kind === "voice" ? void startVoice() : setPhase("edit")), true)}
        </View>
      </>
    );
  else
    body = (
      <>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
          {chip("note")}
          {chip("task")}
        </View>
        <TextInput
          value={text}
          onChangeText={setText}
          autoFocus
          multiline={kind === "note"}
          placeholder={kind === "task" ? t("What needs doing?") : t("Thought, link or idea")}
          placeholderTextColor={th.t4}
          returnKeyType={kind === "task" ? "done" : "default"}
          onSubmitEditing={kind === "task" ? () => void sendText() : undefined}
          cursorColor={th.accent}
          selectionColor={th.accent}
          // Ruhe: the thought in large type straight on the glass (input step 20/27), no field box.
          style={ruhe ? { minHeight: kind === "note" ? 84 : 40, maxHeight: 220, textAlignVertical: "top", color: th.t1, fontSize: 20, lineHeight: 27, letterSpacing: -0.3, padding: 0 } : { minHeight: kind === "note" ? 96 : 48, maxHeight: 220, textAlignVertical: "top", color: th.t1, fontSize: 16, padding: 12, borderRadius: 14, backgroundColor: th.lum2, borderWidth: 1, borderColor: th.hair }}
        />
        <View style={{ flexDirection: "row", gap: ruhe ? 8 : 10, marginTop: ruhe ? 18 : 12 }}>
          {button(t("Voice"), () => {
            setKind("voice");
            void startVoice();
          }, false, "mic")}
          {button(kind === "task" ? t("Add") : t("Send"), () => void sendText(), true, kind === "task" ? "plus" : "send", !text.trim())}
        </View>
      </>
    );

  return (
    <Pressable onPress={phase === "recording" || (phase === "edit" && text.trim()) ? undefined : dismiss} style={{ flex: 1, backgroundColor: ruhe ? alpha(th.lum0, 0.45) : "rgba(0, 0, 0, 0.38)", paddingHorizontal: ruhe ? 8 : 14, paddingTop: 72 }}>
      {/* The card swallows taps, so only the dim area around it closes the overlay. */}
      <Pressable onPress={() => undefined} style={
          // Ruhe: the app's glass sheet recipe (radius 36, padding 10 18 22, ring plus soft drop). Over the home screen
          // there is nothing to blur in-process, so it takes the calm opaque fill (.94); classic: a solid card.
          ruhe
            ? ({ borderRadius: 36, paddingTop: 10, paddingHorizontal: 18, paddingBottom: 22, backgroundColor: alpha(RUHE_GLASS[th.name], 0.94), boxShadow: `0 0 0 1px ${th.hairStrong}, ${dropOf(th.name)}` } as ViewStyle)
            : { borderRadius: 24, padding: 16, backgroundColor: th.lum1, borderWidth: 1, borderColor: th.hair, elevation: 12 }
        }>
        {ruhe && <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: th.t4, opacity: 0.5, alignSelf: "center", marginBottom: 14 }} />}
        {ruhe ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <Icon name={ICON[kind]} color={th.t3} size={14} />
            <Text numberOfLines={1} style={{ flex: 1, color: th.t3, fontSize: 12.5, lineHeight: 17 }}>{TITLE[kind]()}</Text>
            <Pressable onPress={dismiss} accessibilityLabel={t("Close")} hitSlop={12} style={{ padding: 4 }}>
              <Icon name="x" color={th.t3} size={16} />
            </Pressable>
          </View>
        ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: th.accentSoft }}>
            <Icon name={ICON[kind]} color={th.accent} size={16} strokeWidth={2} />
          </View>
          <Text style={{ flex: 1, color: th.t1, fontSize: 17, fontWeight: "700" }}>{TITLE[kind]()}</Text>
          <Pressable onPress={dismiss} accessibilityLabel={t("Close")} hitSlop={10} style={{ padding: 4 }}>
            <Icon name="x" color={th.t3} size={18} strokeWidth={2} />
          </Pressable>
        </View>
        )}
        {body}
      </Pressable>
    </Pressable>
  );
}
