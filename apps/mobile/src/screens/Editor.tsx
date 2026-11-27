import { msg, t } from "../i18n";
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, Alert, BackHandler, Platform, Pressable, ScrollView, TextInput, View, type ViewStyle } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { block, normalize, parse, serialize, slashQuery, type Block, type BlockType } from "../lib/blocks";
import { applyTool, continueList, stats, type Sel, type ToolId } from "../lib/editing";
import { useApp } from "../state/AppState";
import { useData } from "../state/Data";
import { useTheme } from "../theme/ThemeProvider";
import { FONT, RADIUS } from "../theme/tokens";
import { BlockList, BlockMenu, BlockToolbar, useBlockEditing, type Focus } from "../ui/BlockEditor";
import { useChrome } from "../ui/Chrome";
import { Icon } from "../ui/Icon";
import { Btn, Help, Segmented, T } from "../ui/primitives";
import { RButton, RSegment, RText } from "../ui/ruhe";
import { useKeyboardInset } from "../ui/useKeyboard";

/*
 * Note editor (A3). Default is the block editor (BlockEditor.tsx: headings, lists, checklists,
 * quotes, code, dividers, "/" menu, Markdown shortcuts, live inline styling). "Markdown" shows
 * the same content_md as source with the old toolbar, for anything the blocks do not cover.
 * Saves through /api/mobile/notes, so slugs and checklist → task sync match the web app.
 */

const MD_TOOLS: { id: ToolId; label: string; a11y: string }[] = [
  { id: "h2", label: "H2", a11y: msg("Heading") },
  { id: "h3", label: "H3", a11y: msg("Subheading") },
  { id: "bold", label: "B", a11y: msg("Bold") },
  { id: "italic", label: "I", a11y: msg("Italic") },
  { id: "bullet", label: "•", a11y: msg("List") },
  { id: "number", label: "1.", a11y: msg("Numbered list") },
  { id: "check", label: "[ ]", a11y: msg("Checklist") },
  { id: "quote", label: ">", a11y: msg("Quote") },
  { id: "link", label: "Link", a11y: "Link" },
  { id: "wiki", label: "[[ ]]", a11y: msg("Wiki link") },
  { id: "rule", label: "—", a11y: msg("Divider") },
];

const initialBlocks = (md: string): Block[] => {
  const b = parse(md);
  return b.length ? b : [block("p")];
};

export function Editor() {
  const th = useTheme();
  const router = useRouter();
  const { top } = useChrome();
  const ruhe = th.look === "ruhe";
  const insets = useSafeAreaInsets();
  const kb = useKeyboardInset();
  const a = useApp();
  const d = useData();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const entry = id ? d.entryById(id) : undefined;

  const [title, setTitle] = useState(entry?.title ?? "");
  const [mode, setMode] = useState<"blocks" | "markdown">("blocks");
  const [blocks, setBlocks] = useState<Block[]>(() => initialBlocks(entry?.content ?? ""));
  const [md, setMd] = useState(entry?.content ?? "");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [focused, setFocused] = useState(-1);
  const [typeMenu, setTypeMenu] = useState(false);
  const sel = useRef<Sel>({ start: 0, end: 0 });
  const [mdSel, setMdSel] = useState<Sel>({ start: 0, end: 0 });
  const [pendingSel, setPendingSel] = useState<Sel | null>(null);
  const [saving, setSaving] = useState(false);
  const mdRef = useRef<ComponentRef<typeof TextInput>>(null);

  const body = mode === "blocks" ? serialize(blocks) : md;
  const saved = useRef({ title: entry?.title ?? "", body: normalize(entry?.content ?? "") });
  const dirty = title !== saved.current.title || normalize(body) !== saved.current.body;
  const ops = useBlockEditing(blocks, setBlocks, setFocus);
  const cur = focused >= 0 ? blocks[focused] : undefined;
  const slash = cur ? slashQuery(cur) : null;

  const leave = () => (router.canGoBack() ? router.back() : router.replace("/entries"));
  const confirmLeave = () => {
    if (!dirty) return leave();
    Alert.alert(t("Discard changes?"), t("The note is not saved yet."), [
      { text: t("Keep editing"), style: "cancel" },
      { text: t("Discard"), style: "destructive", onPress: leave },
    ]);
  };

  // Android back button: close the block menu first, then ask before throwing edits away.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (typeMenu) {
        setTypeMenu(false);
        return true;
      }
      if (!dirty) return false;
      confirmLeave();
      return true;
    });
    return () => sub.remove();
  });

  const switchMode = (m: "blocks" | "markdown") => {
    if (m === mode) return;
    if (m === "markdown") setMd(serialize(blocks));
    else setBlocks(initialBlocks(md));
    setFocused(-1);
    setTypeMenu(false);
    setMode(m);
  };

  const save = async () => {
    if (!title.trim() && !body.trim()) return a.say(t("Write something first"));
    setSaving(true);
    const r = await d.writeNote(id ?? null, title.trim() || body.trim().split("\n")[0]!.replace(/^#+\s*/, "").slice(0, 80) || t("Untitled note"), body);
    setSaving(false);
    if ("error" in r) return a.say(r.error);
    saved.current = { title, body: normalize(body) };
    a.say(id ? t("Saved") : t("Note created"));
    if (!id) leave();
  };

  // Markdown source mode (the previous editor).
  const mdTool = (tid: ToolId) => {
    const r = applyTool(tid, md, mdSel);
    setMd(r.text);
    setMdSel(r.sel);
    setPendingSel(r.sel);
    mdRef.current?.focus();
  };
  const onChangeMd = (next: string) => {
    const cursor = mdSel.start + (next.length - md.length);
    const cont = continueList(md, next, cursor);
    if (cont) {
      setMd(cont.text);
      setMdSel(cont.sel);
      setPendingSel(cont.sel);
    } else setMd(next);
  };

  const pickType = (type: BlockType) => {
    if (focused < 0) return;
    ops.setType(focused, type, slash !== null);
    setTypeMenu(false);
  };
  const append = () => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === "p" && !last.text) return setFocus({ id: last.id, pos: 0 });
    const p = block("p");
    setBlocks([...blocks, p]);
    setFocus({ id: p.id, pos: 0 });
  };

  const s = useMemo(() => stats(body), [body]);
  const editable = d.auth === "live";
  const showMenu = mode === "blocks" && cur && (slash !== null || typeMenu);

  return (
    <View style={{ flex: 1, backgroundColor: th.bgMainWindow, paddingBottom: kb }}>
      {ruhe ? (
        // Ruhe editor head (android-richtlinien.md 8 B): back link in accentInk, Note | Markdown as a small segment,
        // save as the one primary (sm); the title below in the detail title step, the type line in t3.
        <View style={{ paddingTop: top + 4, paddingLeft: 14, paddingRight: 16, paddingBottom: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Pressable accessibilityRole="link" accessibilityLabel={t("Back")} hitSlop={8} onPress={confirmLeave} style={({ pressed }) => ({ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.6 : 1 })}>
            <Icon name="chevLeft" size={18} color={th.accentInk} />
            <RText step="body" color={th.accentInk}>
              {t("Back")}
            </RText>
          </Pressable>
          <View style={{ flex: 1 }} />
          <RSegment
            label={t("Editor mode")}
            value={mode}
            onChange={switchMode}
            items={[
              { key: "blocks", label: t("Note") },
              { key: "markdown", label: "Markdown" },
            ]}
            style={{ width: 150, flexShrink: 1 }}
          />
          {saving ? <ActivityIndicator size="small" color={th.t3} style={{ width: 38 }} /> : <RButton variant={dirty ? "primary" : "secondary"} size="sm" label={dirty ? t("Save") : t("Saved")} onPress={() => void save()} />}
        </View>
      ) : (
      <View style={{ paddingTop: top + 6, paddingHorizontal: 12, paddingBottom: 6, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Btn variant="ghost" sm minHeight={40} onPress={confirmLeave}>
          <Icon name="chev" rotate={180} color={th.textSecondary} />
          <T size={12.5} lh={18} color={th.textSecondary}>
            {t("Back")}
          </T>
        </Btn>
        <View style={{ flex: 1 }} />
        <Segmented
          small
          value={mode}
          onChange={switchMode}
          items={[
            { key: "blocks", label: t("Note") },
            { key: "markdown", label: "Markdown" },
          ]}
        />
        <Btn variant="primary" sm minHeight={36} onPress={() => void save()}>
          {saving ? <ActivityIndicator size="small" color={th.onAccentAi} /> : dirty ? t("Save") : t("Saved")}
        </Btn>
      </View>
      )}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 8 }}>
        <TextInput
          accessibilityLabel={t("Title")}
          placeholder={t("Title")}
          placeholderTextColor={ruhe ? th.t4 : th.textMuted}
          value={title}
          onChangeText={(v) => setTitle(v.replace(/\n/g, " "))}
          onFocus={() => setFocused(-1)}
          editable={editable}
          multiline
          submitBehavior="blurAndSubmit"
          onSubmitEditing={() => blocks[0] && mode === "blocks" && setFocus({ id: blocks[0].id, pos: 0 })}
          style={[ruhe ? { fontFamily: FONT.sans700, fontSize: 24, lineHeight: 29, letterSpacing: -0.6, color: th.t1, paddingVertical: 4 } : { fontFamily: FONT.sans300, fontSize: 32, lineHeight: 38, letterSpacing: -0.64, color: th.textPrimary, paddingVertical: 4 }, Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null]}
        />
        <Help>{entry ? `${entry.type} · ${entry.when}` : t("New note · goes to the Inbox")}</Help>
        {mode === "blocks" ? (
          <BlockList
            blocks={blocks}
            editable={editable}
            focus={focus}
            focusedIndex={focused}
            onFocusIndex={(i) => {
              setFocused(i);
              setTypeMenu(false);
            }}
            onSelection={(_i, v) => {
              sel.current = v;
            }}
            ops={ops}
            onAppend={append}
          />
        ) : (
          <TextInput
            ref={mdRef}
            accessibilityLabel="Markdown"
            placeholder={t("## Heading, - list, - [ ] task, [[note]]")}
            placeholderTextColor={th.textMuted}
            value={md}
            onChangeText={onChangeMd}
            selection={pendingSel ?? undefined}
            onSelectionChange={(e) => {
              setMdSel(e.nativeEvent.selection);
              if (pendingSel) setPendingSel(null);
            }}
            editable={editable}
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
            style={[{ minHeight: 320, fontFamily: FONT.mono400, fontSize: 13.5, lineHeight: 22, color: th.textPrimary, paddingTop: 8 }, Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null]}
          />
        )}
      </ScrollView>

      {showMenu && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
          <BlockMenu query={slash ?? ""} current={slash === null ? cur.type : undefined} onPick={pickType} />
        </View>
      )}

      {editable && (mode === "markdown" || cur) && (
        <View style={[{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingRight: 8, paddingBottom: 6 + (kb ? 0 : insets.bottom), backgroundColor: ruhe ? th.lum1 : th.bgFloatingGlass, boxShadow: `inset 0 1px 0 0 ${ruhe ? th.hair : th.borderSubtle}` } as ViewStyle]}>
          <View style={{ flex: 1 }}>
            {mode === "blocks" && cur ? (
              <BlockToolbar
                b={cur}
                onType={() => setTypeMenu((v) => !v)}
                onInline={(tool) => ops.inline(focused, tool, sel.current)}
                onToggleCheck={() => ops.setType(focused, "check")}
                onIndent={(dd) => ops.indent(focused, dd)}
                onMove={(dd) => {
                  ops.move(focused, dd);
                  const j = focused + dd;
                  if (j >= 0 && j < blocks.length) {
                    setFocused(j);
                    setFocus({ id: cur.id, pos: sel.current.start });
                  }
                }}
                onRemove={() => ops.remove(focused)}
              />
            ) : (
              <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, paddingHorizontal: 8 }}>
                {MD_TOOLS.map((x) => (
                  <Pressable
                    key={x.id}
                    accessibilityRole="button"
                    accessibilityLabel={t(x.a11y)}
                    onPress={() => mdTool(x.id)}
                    style={({ pressed }) => ({ minWidth: 44, height: 44, paddingHorizontal: 8, borderRadius: RADIUS.control, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? th.bgHover : "transparent" })}
                  >
                    <T mono size={13} lh={18} weight={x.id === "bold" ? 500 : 400} color={th.textSecondary} style={x.id === "italic" ? { fontStyle: "italic" } : undefined}>
                      {x.label}
                    </T>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
          <T num size={11.5} lh={16} ls={0} color={th.textMuted}>{t("{n} w", { n: s.words })}</T>
        </View>
      )}
      {!editable && (
        <View style={{ padding: 12, paddingBottom: 12 + insets.bottom }}>
          <Help>{t("Read-only in demo mode. Sign in to edit notes.")}</Help>
        </View>
      )}
    </View>
  );
}
