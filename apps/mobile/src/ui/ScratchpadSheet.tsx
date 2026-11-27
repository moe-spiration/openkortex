import { t } from "../i18n";
import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, TextInput, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { addScratchpad, loadScratchpad, type ScratchEntry } from "../api/kortex";
import { kortexUrl } from "../api/config";
import { useApp } from "../state/AppState";
import { useRuhe, useTheme } from "../theme/ThemeProvider";
import { FONT, RADIUS, RUHE_TYPE } from "../theme/tokens";
import { RButton, RSheet, RText } from "./ruhe";
import { Grip, sheetBody } from "./Capture";
import { Btn, Help, Micro, T } from "./primitives";
import { Icon } from "./Icon";
import { SwipeSheet } from "./SwipeSheet";
import { useKeyboardInset } from "./useKeyboard";

/*
 * Scratchpad sheet (next to the quick note): one multi-line field, appended as a list entry to the single
 * scratchpad document (POST /api/scratchpad). Shares the draft with the quick note, so text typed there
 * can be moved over. Below the field the latest entries are listed for reading; the AI cleanup happens on
 * the web ("Im Web aufräumen" opens /home?scratchpad=1, the drawer with "Aufräumen").
 */

/** Newest first, at most this many on the phone. */
const SHOW = 20;
export function ScratchpadSheet() {
  const th = useTheme();
  const ruhe = useRuhe();
  const a = useApp();
  const kb = useKeyboardInset();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<ScratchEntry[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!a.live) return;
    let off = false;
    loadScratchpad()
      .then((r) => !off && setEntries(r.entries.slice(-SHOW).reverse()))
      .catch((e: unknown) => !off && setFailed(e instanceof Error ? e.message : t("Scratchpad not reachable")));
    return () => {
      off = true;
    };
  }, [a.live]);

  const save = async () => {
    const text = a.noteText.trim();
    if (busy) return;
    if (!text) {
      a.say(t("Write something down first"));
      return;
    }
    if (!a.live) {
      a.setNoteText("");
      a.closeCap();
      a.say(t("Demo: entry in the scratchpad"));
      return;
    }
    setBusy(true);
    try {
      await addScratchpad(text);
      a.setNoteText("");
      a.closeCap();
      a.say(t("Noted in the scratchpad"));
    } catch (e) {
      a.say(e instanceof Error ? e.message : t("Scratchpad not reachable"));
    } finally {
      setBusy(false);
    }
  };

  if (ruhe) {
    // Ruhe: the glass sheet like the quick note; target line instead of a heading, input without a box.
    const dark = th.name === "dark";
    return (
      <RSheet z={15} onClose={a.closeCap} target={{ icon: "note", text: t("Scratchpad") }} label={t("Scratchpad")}>
        <TextInput
          accessibilityLabel={t("Scratchpad entry")}
          multiline
          autoFocus
          placeholder={t("Thought, number, snippet …")}
          placeholderTextColor={th.t4}
          selectionColor={th.accent}
          cursorColor={th.accent}
          value={a.noteText}
          onChangeText={a.setNoteText}
          style={[{ minHeight: 84, maxHeight: 200, padding: 0, fontFamily: FONT.sans400, fontSize: RUHE_TYPE.input.size, lineHeight: RUHE_TYPE.input.lh, letterSpacing: RUHE_TYPE.input.ls * RUHE_TYPE.input.size, color: th.t1, textAlignVertical: "top" }, Platform.OS === "web" ? ({ outlineStyle: "none", caretColor: th.accent } as never) : null]}
        />
        <RButton variant="primary" icon="note" label={t("To the scratchpad")} disabled={busy} onPress={() => void save()} style={{ marginTop: 14 }} />
        {a.live && (
          <View style={{ marginTop: 18 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <RText step="label" color={th.t2} style={{ flex: 1 }}>
                {t("Last noted")}
              </RText>
              {!!entries?.length && (
                <RText step="meta" tnum color={th.t4}>
                  {String(entries.length)}
                </RText>
              )}
              <Pressable accessibilityRole="link" hitSlop={8} onPress={() => void Linking.openURL(`${kortexUrl()}/home?scratchpad=1`)} style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, marginLeft: 8 }}>
                <Icon name="sparkles" size={13} color={th.accentInk} />
                <RText step="kind" color={th.accentInk}>
                  {t("Tidy up on the web")}
                </RText>
              </Pressable>
            </View>
            {failed || entries === null || entries.length === 0 ? (
              <RText step="rowSub" color={th.t3}>
                {failed ?? (entries === null ? t("Loading …") : t("Still empty."))}
              </RText>
            ) : (
              <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {entries.map((e) => (
                  <View key={e.id} style={{ paddingVertical: 7, gap: 2 }}>
                    <RText step="meta" tnum color={dark ? th.t4 : th.t3}>
                      {e.at}
                    </RText>
                    <RText step="rowTitle" weight={400} numberOfLines={4}>
                      {e.text}
                    </RText>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        )}
      </RSheet>
    );
  }

  return (
    <>
      <Pressable accessibilityLabel={t("Close")} onPress={a.closeCap} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 15, backgroundColor: th.bgScrim }} />
      <SwipeSheet
        scroll={false}
        onClose={a.closeCap}
        style={{ position: "absolute", left: 0, right: 0, bottom: kb, zIndex: 16 }}
        contentContainerStyle={sheetBody(th, kb, insets.bottom)}
      >
        <Grip />
        <View accessibilityLabel="Scratchpad" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T type="h3" style={{ flex: 1 }}>
            Scratchpad
          </T>
        </View>
        <View style={{ padding: 8, borderRadius: RADIUS.control, backgroundColor: th.bgSurfaceMuted }}>
          <TextInput
            accessibilityLabel={t("Scratchpad entry")}
            multiline
            autoFocus
            placeholder={t("Thought, number, snippet …")}
            placeholderTextColor={th.textMuted}
            value={a.noteText}
            onChangeText={a.setNoteText}
            style={[{ minHeight: 96, maxHeight: 220, padding: 4, paddingTop: 2, fontFamily: FONT.sans400, fontSize: 13.5, lineHeight: 21, color: th.textPrimary, textAlignVertical: "top" }, Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null]}
          />
        </View>
        <Btn variant="primary" block minHeight={48} icon="note" onPress={save}>
          {t("To the scratchpad")}
        </Btn>
        {a.live && (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Micro style={{ flex: 1 }}>{entries?.length ? t("Last noted ({n})", { n: entries.length }) : t("Last noted")}</Micro>
              <Pressable accessibilityRole="link" hitSlop={8} onPress={() => void Linking.openURL(`${kortexUrl()}/home?scratchpad=1`)} style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 }}>
                <Icon name="sparkles" size={13} color={th.accentAi} />
                <T size={12.5} lh={18} color={th.accentAi}>
                  {t("Tidy up on the web")}
                </T>
              </Pressable>
            </View>
            {failed ? (
              <Help>{failed}</Help>
            ) : entries === null ? (
              <Help>{t("Loading …")}</Help>
            ) : entries.length === 0 ? (
              <Help>{t("Still empty.")}</Help>
            ) : (
              <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {entries.map((e) => (
                  <View key={e.id} style={{ paddingVertical: 8, gap: 2, boxShadow: `inset 0 -1px 0 0 ${th.borderSubtle}` } as ViewStyle}>
                    <Help>{e.at}</Help>
                    <T size={13.5} lh={20} numberOfLines={4}>
                      {e.text}
                    </T>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        )}
      </SwipeSheet>
    </>
  );
}
