import { msg } from "@kortex/i18n";
import { getBridge } from "./bridge";
import { aiSummaryTitle, blocksToMarkdown, markdownToBlocks, type BlockLike, type KortexInline } from "./markdown";
import type { KortexEditorInstance, KortexEditorPartialBlock } from "./schema";

/*
 * KI actions inside the editor (W8): the toolbar's "KI" menu over a selection and the slash
 * command "Fortsetzen". The editor collects the text (Markdown) and applies the host's answer; the
 * host calls the same server actions as the header's KI menu (POST /api/chat/action).
 */

/** Same names as POST /api/chat/action. "custom" applies the user's own instruction. */
export type EditorAiAction = "rewrite" | "shorten" | "continue" | "summarize" | "custom";

export interface EditorAiRequest {
  action: EditorAiAction;
  /** The selection (or the block / the text up to the caret for "continue") as Markdown. */
  markdown: string;
  /** "custom": what the user typed, e.g. "Ersetze Mayer durch Meier" or "als Tabelle". */
  instruction?: string;
}

/** Menu entries of the toolbar's KI menu, in the order of the reference. `label` is the English source: show it with `t(label)`. */
export const AI_SELECTION_ACTIONS: { action: EditorAiAction | "ask"; label: string }[] = [
  { action: "rewrite", label: msg("Rewrite") },
  { action: "shorten", label: msg("Shorten") },
  { action: "continue", label: msg("Continue writing") },
  { action: "summarize", label: msg("Summarize") },
  { action: "ask", label: msg("Ask a question about it") },
  { action: "custom", label: msg("Custom instruction …") },
];

const toEditor = (blocks: ReturnType<typeof markdownToBlocks>["blocks"]) =>
  blocks as unknown as KortexEditorPartialBlock[];

/** Inline content of a Markdown answer, flattened to one block's text (line breaks between blocks). */
function flatInline(md: string): KortexInline[] {
  const out: KortexInline[] = [];
  for (const b of markdownToBlocks(md).blocks) {
    const content = "content" in b && Array.isArray(b.content) ? (b.content as KortexInline[]) : [];
    if (!content.length) continue;
    if (out.length) out.push({ type: "text", text: "\n", styles: {} });
    if (b.type === "bulletListItem" || b.type === "numberedListItem")
      out.push({ type: "text", text: "• ", styles: {} });
    out.push(...content);
  }
  return out;
}

interface Target {
  /** Top-level blocks the action works on (selection or caret block). */
  blocks: { id: string }[];
  /** Selected text at the time of the request ("" without a selection). */
  selectedText: string;
  markdown: string;
  /** The selection covers its blocks completely (so an answer may replace them). */
  whole: boolean;
}

function selectionTarget(editor: KortexEditorInstance, action: EditorAiAction): Target {
  const selectedText = editor.getSelectedText();
  const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
  if (selectedText.trim() && action !== "continue") {
    const cut = editor.getSelectionCutBlocks().blocks as unknown as BlockLike[];
    const markdown = blocksToMarkdown(cut);
    const whole = markdown === blocksToMarkdown(blocks as unknown as BlockLike[]);
    return { blocks, selectedText, markdown, whole };
  }
  if (action === "continue") {
    // Context = the document up to (and including) the last block of the selection.
    const last = blocks[blocks.length - 1]!;
    const doc = editor.document;
    const end = doc.findIndex((b) => b.id === last.id);
    const upTo = end >= 0 ? doc.slice(0, end + 1) : blocks;
    return { blocks, selectedText, markdown: blocksToMarkdown(upTo as unknown as BlockLike[]), whole: false };
  }
  return { blocks, selectedText, markdown: blocksToMarkdown(blocks as unknown as BlockLike[]), whole: true };
}

/**
 * Runs a KI action on the current selection (or the caret's block) and applies the answer:
 * rewrite / shorten / custom replace the selection (or the blocks), continue inserts after it,
 * summarize adds a KI-Zusammenfassung block below. Resolves false when the host has no KI or
 * nothing to send (custom: no instruction).
 */
export async function runEditorAiAction(
  editor: KortexEditorInstance,
  action: EditorAiAction,
  instruction?: string,
): Promise<boolean> {
  const host = getBridge(editor).get().onAiAction;
  if (!host) return false;
  const wish = instruction?.trim();
  if (action === "custom" && !wish) return false;
  const target = selectionTarget(editor, action);
  if (!target.markdown.trim()) return false;
  const last = target.blocks[target.blocks.length - 1]!;
  const exists = (id: string) => !!editor.getBlock(id);

  if (action === "summarize") {
    const [pending] = editor.insertBlocks(
      [{ type: "aiSummary", props: { title: aiSummaryTitle(), pending: true } }],
      last,
      "after",
    );
    const id = pending!.id;
    try {
      const md = await host({ action, markdown: target.markdown });
      if (exists(id))
        editor.updateBlock(id, { props: { pending: false }, content: flatInline(md) as never });
    } catch (err) {
      if (exists(id)) editor.removeBlocks([id]);
      throw err;
    }
    return true;
  }

  const md = (
    await host({ action, markdown: target.markdown, ...(wish ? { instruction: wish } : {}) })
  ).trim();
  if (!md) return true;
  const parsed = markdownToBlocks(md).blocks;
  if (!parsed.length) return true;
  const alive = target.blocks.filter((b) => exists(b.id));
  const anchor = alive[alive.length - 1];

  if (action === "continue") {
    if (anchor) editor.insertBlocks(toEditor(parsed), anchor, "after");
    return true;
  }

  // rewrite / shorten / custom
  const [only] = parsed;
  const sameSelection = !!target.selectedText && editor.getSelectedText() === target.selectedText;
  if (sameSelection && parsed.length === 1 && only?.type === "paragraph") {
    editor.insertInlineContent(only.content as never);
  } else if (
    alive.length &&
    (!target.selectedText ||
      // "Eigene Anweisung" on whole blocks (e.g. the full transcript): the answer replaces them.
      (action === "custom" && target.whole && alive.length === target.blocks.length))
  ) {
    editor.replaceBlocks(alive, toEditor(parsed));
  } else if (anchor) {
    // The selection moved meanwhile, or the answer has several blocks: keep the original, add below.
    editor.insertBlocks(toEditor(parsed), anchor, "after");
  }
  return true;
}
