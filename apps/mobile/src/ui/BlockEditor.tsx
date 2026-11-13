import { useLocale } from "../i18n/device";
import { msg, t } from "../i18n";
import { memo, useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Alert, Image, Platform, Pressable, ScrollView, Text, TextInput, View, type TextStyle, type ViewStyle } from "react-native";
import { applyTool, type Sel, type ToolId } from "../lib/editing";
import {
  autoFormat,
  backspaceAtStart,
  block,
  BLOCK_KINDS,
  convert,
  inlineSegments,
  insertedNewline,
  isAtom,
  isList,
  isSingleLine,
  move,
  numberOf,
  parse,
  remove,
  setIndent,
  slashMatches,
  slashQuery,
  splitAt,
  type Block,
  type BlockType,
  type EditResult,
} from "../lib/blocks";
import { useTheme } from "../theme/ThemeProvider";
import { FONT, RADIUS } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { ring, T } from "./primitives";

/*
 * A3: Notion-like block editor for notes on the phone (mirrors the web BlockNote editor).
 * Every block is its own text field: Enter starts the next block (lists continue, an empty item
 * leaves the list), Backspace at the start lifts the formatting and then merges, "/" opens the
 * block menu, Markdown shortcuts ("# ", "- ", "[] ", "1. ", "> ", "```", "---") convert while you
 * type, checkboxes toggle with a tap. Inline Markdown (**fett**, _kursiv_, `code`, [[Link]]) is
 * styled live inside the field. The blocks serialise back to clean content_md (lib/blocks.ts).
 */

export interface Focus {
  id: string;
  pos: number;
  end?: number;
}

type TextRef = ComponentRef<typeof TextInput>;

const STYLE: Partial<Record<BlockType, { family: string; size: number; lh: number }>> = {
  h1: { family: FONT.sans500, size: 24, lh: 30 },
  h2: { family: FONT.sans500, size: 20, lh: 26 },
  h3: { family: FONT.sans500, size: 16, lh: 24 },
  code: { family: FONT.mono400, size: 13.5, lh: 21 },
};
const BODY = { family: FONT.sans400, size: 15, lh: 25.5 };

/** English sources, shown with `t(…)` where the row renders. */
const PLACEHOLDER: Partial<Record<BlockType, string>> = {
  h1: msg("Heading 1"),
  h2: msg("Heading 2"),
  h3: msg("Heading 3"),
  bullet: msg("List item"),
  number: msg("List item"),
  check: msg("Task"),
  quote: msg("Quote"),
  code: msg("Code"),
};

export function useBlockEditing(blocks: Block[], setBlocks: (b: Block[]) => void, setFocus: (f: Focus | null) => void) {
  const apply = useCallback(
    (r: EditResult | null) => {
      if (!r) return false;
      setBlocks(r.blocks);
      setFocus(r.focus);
      return true;
    },
    [setBlocks, setFocus],
  );

  /** A text change of block i (typing, paste, Enter). */
  const onText = useCallback(
    (i: number, next: string, sel: Sel) => {
      const b = blocks[i];
      if (!b) return;
      const nl = insertedNewline(b.text, next);
      if (nl !== null) {
        // Split the new text (it may carry an autocorrected word) at the typed newline.
        const base = blocks.slice();
        base[i] = { ...b, text: next.slice(0, nl) + next.slice(nl + 1) };
        if (isSingleLine(b.type) || b.type === "p" || b.type === "quote") return void apply(splitAt(base, i, nl));
        // Code: Enter on an empty last line leaves the block.
        if (b.type === "code" && nl === b.text.length && b.text.endsWith("\n")) {
          const p = block("p");
          return void apply({ blocks: [...blocks.slice(0, i), { ...b, text: b.text.replace(/\n$/, "") }, p, ...blocks.slice(i + 1)], focus: { id: p.id, pos: 0 } });
        }
      } else if (next.includes("\n") && next.length > b.text.length + 1 && (isSingleLine(b.type) || b.type === "p")) {
        // Pasted lines become blocks of their own.
        const parsed = parse(next);
        if (parsed.length > 1) {
          if (parsed[0]!.type === "p" && b.type !== "p") parsed[0] = { ...parsed[0]!, type: b.type, indent: b.indent, checked: b.checked };
          parsed[0] = { ...parsed[0]!, id: b.id };
          const last = parsed[parsed.length - 1]!;
          return void apply({ blocks: [...blocks.slice(0, i), ...parsed, ...blocks.slice(i + 1)], focus: { id: last.id, pos: last.text.length } });
        }
      }
      const updated: Block = { ...b, text: isSingleLine(b.type) ? next.replace(/\n/g, " ") : next };
      const af = autoFormat(updated);
      if (af) {
        if (af.type === "divider") return void apply(convert(blocks, i, "divider"));
        const out = blocks.slice();
        out[i] = af;
        return void apply({ blocks: out, focus: { id: af.id, pos: Math.max(0, sel.start - (next.length - af.text.length)) } });
      }
      const out = blocks.slice();
      out[i] = updated;
      setBlocks(out);
    },
    [blocks, apply, setBlocks],
  );

  const onBackspaceAtStart = useCallback((i: number) => apply(backspaceAtStart(blocks, i)), [blocks, apply]);

  const toggle = useCallback(
    (i: number) => {
      const out = blocks.slice();
      out[i] = { ...out[i]!, checked: !out[i]!.checked };
      setBlocks(out);
    },
    [blocks, setBlocks],
  );

  const setType = useCallback(
    (i: number, type: BlockType, clearText = false) => {
      const src = clearText ? blocks.map((b, k) => (k === i ? { ...b, text: "" } : b)) : blocks;
      const cur = src[i]!;
      // Same type again toggles back to text (like the web toolbar).
      apply(convert(src, i, cur.type === type && type !== "p" ? "p" : type));
    },
    [blocks, apply],
  );

  /** Inline formatting on the selection of block i (reuses the Markdown toolbar logic). */
  const inline = useCallback(
    (i: number, tool: ToolId, sel: Sel) => {
      const b = blocks[i];
      if (!b || isAtom(b.type)) return;
      const r = applyTool(tool, b.text, sel);
      const out = blocks.slice();
      out[i] = { ...b, text: r.text };
      setBlocks(out);
      setFocus({ id: b.id, pos: r.sel.start, end: r.sel.end });
    },
    [blocks, setBlocks, setFocus],
  );

  return {
    onText,
    onBackspaceAtStart,
    toggle,
    setType,
    inline,
    indent: (i: number, d: 1 | -1) => setBlocks(setIndent(blocks, i, d)),
    move: (i: number, d: 1 | -1) => setBlocks(move(blocks, i, d)),
    remove: (i: number) => apply(remove(blocks, i)),
  };
}

function Segments({ text, color }: { text: string; color: string }) {
  const th = useTheme();
  return (
    <>
      {inlineSegments(text).map((s, k) => {
        const st: TextStyle = s.mark
          ? { color: th.textMuted }
          : {
              ...(s.bold ? { fontFamily: FONT.sans600 } : null),
              ...(s.italic ? { fontStyle: "italic" as const } : null),
              ...(s.strike ? { textDecorationLine: "line-through" as const, color: th.textSecondary } : null),
              ...(s.code ? { fontFamily: FONT.mono400, backgroundColor: th.bgSurfaceMuted } : null),
              ...(s.link ? { color: th.accentAi, textDecorationLine: "underline" as const } : null),
            };
        return (
          <Text key={k} style={[{ color }, st]}>
            {s.text}
          </Text>
        );
      })}
    </>
  );
}

interface RowProps {
  b: Block;
  i: number;
  n: number;
  editable: boolean;
  placeholder?: string;
  setRef: (id: string, r: TextRef | null) => void;
  onText: (i: number, next: string, sel: Sel) => void;
  onBackspaceAtStart: (i: number) => boolean;
  onSel: (i: number, sel: Sel) => void;
  onFocusRow: (i: number) => void;
  onToggle: (i: number) => void;
  onRemove: (i: number) => void;
}

const BlockRow = memo(function BlockRow({ b, i, n, editable, placeholder, setRef, onText, onBackspaceAtStart, onSel, onFocusRow, onToggle, onRemove }: RowProps) {
  const th = useTheme();
  useLocale();
  const sel = useRef<Sel>({ start: 0, end: 0 });
  const st = STYLE[b.type] ?? BODY;
  const done = b.type === "check" && b.checked;
  const color = done ? th.textMuted : b.type === "quote" ? th.textSecondary : th.textPrimary;
  const pad = (b.indent ?? 0) * 22;
  // Obsidian-style callout "> [!toggle]- Titel": collapsed by default with "-", open with "+". Opens for editing.
  const toggle = b.type === "quote" ? /^\[!toggle\]([+-]?)[ \t]*([^\n]*)/.exec(b.text) : null;
  const [open, setOpen] = useState(toggle?.[1] === "+");

  const askRemove = () =>
    editable &&
    Alert.alert(b.type === "image" ? t("Remove image?") : t("Remove divider?"), undefined, [
      { text: t("Cancel"), style: "cancel" },
      { text: t("Remove"), style: "destructive", onPress: () => onRemove(i) },
    ]);

  if (b.type === "divider")
    return (
      <Pressable accessibilityLabel={t("Divider")} accessibilityHint={t("Long-press to remove")} onLongPress={askRemove} style={{ paddingVertical: 12 }}>
        <View style={{ height: 1, backgroundColor: th.borderSubtle }} />
      </Pressable>
    );
  if (b.type === "image")
    return (
      <Pressable accessibilityLabel={b.text || t("Image")} accessibilityHint={t("Long-press to remove")} onLongPress={askRemove} style={{ paddingVertical: 6, gap: 4 }}>
        <Image source={{ uri: b.url }} resizeMode="cover" style={{ width: "100%", aspectRatio: 16 / 10, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceMuted }} />
        {b.text ? (
          <T size={12.5} lh={18} color={th.textMuted}>
            {b.text}
          </T>
        ) : null}
      </Pressable>
    );

  const field = (
    <TextInput
      ref={(r) => setRef(b.id, r)}
      accessibilityLabel={t(PLACEHOLDER[b.type] ?? "Text")}
      multiline
      scrollEnabled={false}
      editable={editable}
      placeholder={placeholder}
      placeholderTextColor={th.textMuted}
      onChangeText={(next) => onText(i, next, sel.current)}
      onSelectionChange={(e) => {
        sel.current = e.nativeEvent.selection;
        onSel(i, sel.current);
      }}
      onFocus={() => onFocusRow(i)}
      onKeyPress={(e) => {
        if (e.nativeEvent.key === "Backspace" && sel.current.start === 0 && sel.current.end === 0) onBackspaceAtStart(i);
      }}
      textAlignVertical="top"
      style={[
        { flex: 1, minWidth: 0, padding: 0, paddingVertical: 3, fontFamily: st.family, fontSize: st.size, lineHeight: st.lh, color },
        done ? { textDecorationLine: "line-through" } : null,
        Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null,
      ]}
    >
      {b.type === "code" ? b.text : <Segments text={b.text} color={color} />}
    </TextInput>
  );

  const lead = (w: number, child: ReactNode) => <View style={{ width: w, minHeight: st.lh + 6, alignItems: "center", justifyContent: "center" }}>{child}</View>;

  return (
    <View style={[{ flexDirection: "row", alignItems: "flex-start", gap: 6, paddingLeft: pad, marginTop: b.type === "h1" ? 14 : b.type === "h2" ? 10 : b.type === "h3" ? 6 : 0 }]}>
      {b.type === "bullet" && lead(18, <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: th.textSecondary }} />)}
      {b.type === "number" &&
        lead(
          22,
          <T num size={14} lh={st.lh} ls={0} color={th.textSecondary}>
            {`${n}.`}
          </T>,
        )}
      {b.type === "check" &&
        lead(
          24,
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!b.checked }}
            accessibilityLabel={b.text || t("Task")}
            hitSlop={10}
            disabled={!editable}
            onPress={() => onToggle(i)}
          >
            <Icon name={b.checked ? "checkSquare" : "square"} size={20} color={b.checked ? th.accentAi : th.textSecondary} />
          </Pressable>,
        )}
      {b.type === "quote" && toggle ? (
        <View style={{ flex: 1, flexDirection: "row", gap: 10 }}>
          <View style={{ width: 3, borderRadius: 2, backgroundColor: th.accentLine }} />
          <View style={{ flex: 1 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={open ? t("Collapse: {title}", { title: toggle[2] || "Toggle" }) : t("Expand: {title}", { title: toggle[2] || "Toggle" })}
              onPress={() => setOpen((v) => !v)}
              style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
                <Icon name="chev" size={16} color={th.textSecondary} />
              </View>
              <Text style={{ flex: 1, fontFamily: FONT.sans600, fontSize: 15, lineHeight: 22, color: th.textPrimary }} numberOfLines={open ? undefined : 2}>
                {toggle[2] || "Toggle"}
              </Text>
            </Pressable>
            {open && field}
          </View>
        </View>
      ) : b.type === "quote" ? (
        <View style={{ flex: 1, flexDirection: "row", gap: 10 }}>
          <View style={{ width: 3, borderRadius: 2, backgroundColor: th.accentLine }} />
          {field}
        </View>
      ) : b.type === "code" ? (
        <View style={[{ flex: 1, padding: 10, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceMuted }, ring(th.borderSubtle)]}>{field}</View>
      ) : b.type === "raw" ? (
        <View style={[{ flex: 1, padding: 8, borderRadius: RADIUS.row, borderStyle: "dashed", borderWidth: 1, borderColor: th.borderSubtle }]}>{field}</View>
      ) : (
        field
      )}
    </View>
  );
});

export function BlockList({
  blocks,
  editable,
  focus,
  focusedIndex,
  onFocusIndex,
  onSelection,
  ops,
  onAppend,
}: {
  blocks: Block[];
  editable: boolean;
  focus: Focus | null;
  focusedIndex: number;
  onFocusIndex: (i: number) => void;
  onSelection: (i: number, sel: Sel) => void;
  ops: ReturnType<typeof useBlockEditing>;
  onAppend: () => void;
}) {
  const refs = useRef(new Map<string, TextRef>());
  const setRef = useCallback((id: string, r: TextRef | null) => {
    if (r) refs.current.set(id, r);
    else refs.current.delete(id);
  }, []);

  // Moves the cursor after structural edits (split, merge, type change).
  useEffect(() => {
    if (!focus) return;
    const id = setTimeout(() => {
      const r = refs.current.get(focus.id);
      if (!r) return;
      r.focus();
      (r as unknown as { setSelection?: (a: number, b: number) => void }).setSelection?.(focus.pos, focus.end ?? focus.pos);
    }, 0);
    return () => clearTimeout(id);
  }, [focus]);

  return (
    <View style={{ gap: 2 }}>
      {blocks.map((b, i) => (
        <BlockRow
          key={b.id}
          b={b}
          i={i}
          n={b.type === "number" ? numberOf(blocks, i) : 0}
          editable={editable}
          placeholder={b.type === "p" ? (i === focusedIndex ? t("Type / for blocks") : blocks.length === 1 ? t("Start writing …") : undefined) : PLACEHOLDER[b.type] && t(PLACEHOLDER[b.type]!)}
          setRef={setRef}
          onText={ops.onText}
          onBackspaceAtStart={ops.onBackspaceAtStart}
          onSel={onSelection}
          onFocusRow={onFocusIndex}
          onToggle={ops.toggle}
          onRemove={ops.remove}
        />
      ))}
      {editable && <Pressable accessibilityLabel={t("New block at the end")} onPress={onAppend} style={{ minHeight: 120 }} />}
    </View>
  );
}

/** Block menu: "/" in an empty paragraph or the type button of the toolbar. */
export function BlockMenu({ query, current, onPick }: { query: string; current?: BlockType; onPick: (type: BlockType) => void }) {
  const th = useTheme();
  const items = slashMatches(query);
  if (!items.length) return null;
  const icon: Record<BlockType, IconName> = { p: "type", h1: "heading", h2: "heading", h3: "heading", bullet: "list", number: "listOrdered", check: "checkSquare", quote: "quote", code: "code", divider: "minus", image: "grid", raw: "code" };
  return (
    <View accessibilityRole="menu" accessibilityLabel={t("Block type")} style={[{ maxHeight: 248, borderRadius: RADIUS.card, backgroundColor: th.bgSurfaceFlat, boxShadow: th.shadowFloating } as ViewStyle, ring(th.borderSubtle)]}>
      <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ padding: 6 }}>
        {items.map((k) => (
          <Pressable
            key={k.type}
            accessibilityRole="menuitem"
            accessibilityState={{ selected: current === k.type }}
            onPress={() => onPick(k.type)}
            style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10, borderRadius: RADIUS.row, backgroundColor: pressed || current === k.type ? th.bgHover : "transparent" })}
          >
            <Icon name={icon[k.type]} size={18} color={th.textSecondary} />
            <T size={14.5} lh={20} style={{ flex: 1 }}>
              {t(k.label)}
            </T>
            <T mono size={12} lh={16} ls={0} color={th.textMuted}>
              {t(k.hint)}
            </T>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** The formatting toolbar above the keyboard for the focused block. */
export function BlockToolbar({
  b,
  onType,
  onInline,
  onToggleCheck,
  onIndent,
  onMove,
  onRemove,
}: {
  b: Block;
  onType: () => void;
  onInline: (tool: ToolId) => void;
  onToggleCheck: () => void;
  onIndent: (d: 1 | -1) => void;
  onMove: (d: 1 | -1) => void;
  onRemove: () => void;
}) {
  const th = useTheme();
  const kind = BLOCK_KINDS.find((k) => k.type === b.type);
  const textual = !isAtom(b.type) && b.type !== "code";
  const btn = (key: string, icon: IconName, label: string, onPress: () => void, on = false) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: RADIUS.control, alignItems: "center", justifyContent: "center", backgroundColor: pressed || on ? th.bgHover : "transparent" })}
    >
      <Icon name={icon} size={18} color={on ? th.accentAi : th.textSecondary} />
    </Pressable>
  );
  return (
    <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2, alignItems: "center", paddingHorizontal: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Block type: {type}", { type: t(kind?.label ?? "Text") })}
        onPress={onType}
        style={({ pressed }) => [{ height: 40, paddingHorizontal: 12, marginRight: 4, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: RADIUS.pill, backgroundColor: pressed ? th.bgHover : th.bgSurfaceMuted }]}
      >
        <Icon name="type" size={15} color={th.textSecondary} />
        <T size={12.5} lh={18} ls={0} color={th.textSecondary}>
          {kind ? t(kind.label) : b.type === "raw" ? "Markdown" : "Text"}
        </T>
      </Pressable>
      {textual && btn("bold", "bold", t("Bold"), () => onInline("bold"))}
      {textual && btn("italic", "italic", t("Italic"), () => onInline("italic"))}
      {textual && btn("link", "link", "Link", () => onInline("link"))}
      {textual && btn("wiki", "wiki", t("Wiki link"), () => onInline("wiki"))}
      {btn("check", "checkSquare", b.type === "check" ? t("Checklist off") : t("As checklist"), onToggleCheck, b.type === "check")}
      {isList(b.type) && btn("in", "indent", t("Indent"), () => onIndent(1))}
      {isList(b.type) && btn("out", "outdent", t("Outdent"), () => onIndent(-1))}
      {btn("up", "arrowUp", t("Move block up"), () => onMove(-1))}
      {btn("down", "arrowDown", t("Move block down"), () => onMove(1))}
      {btn("del", "trash", t("Delete block"), onRemove)}
    </ScrollView>
  );
}

export { slashQuery };
