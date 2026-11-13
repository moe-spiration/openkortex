"use client";

import "@blocknote/ariakit/style.css";
import "./editor.css";

import { de, en } from "@blocknote/core/locales";
import { getLocale, t } from "@kortex/i18n";
import { BlockNoteView } from "@blocknote/ariakit";
import {
  FormattingToolbarController,
  SideMenu,
  SideMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";
import type { EditorAiRequest } from "./ai";
import { getBridge, type WikiLinkTarget } from "./bridge";
import { KortexDragHandleMenu, KortexFormattingToolbar } from "./controls";
import { blocksToMarkdown, markdownToBlocks } from "./markdown";
import { nestSections } from "./sections";
import { MentionMenu, SlashMenu, WikiLinkMenu } from "./menus";
import { isSafeHref } from "./links";
import { kortexSchema, type KortexEditorInstance, type KortexEditorPartialBlock } from "./schema";

export interface KortexEditorProps {
  /** content_md (may start with a YAML frontmatter block, which must be preserved verbatim). */
  markdown: string;
  /** Called with the full markdown (incl. preserved frontmatter) after edits. */
  onChange?: (markdown: string) => void;
  /** Autocomplete source for [[Wiki-Links]] and the Unterseite command. */
  wikiTargets?: WikiLinkTarget[];
  onOpenWikiLink?: (target: { id?: string; title: string }) => void;
  /** KI-Zusammenfassung: returns (or resolves to) the summary text to put into the AI block. */
  onAiSummary?: () => string | Promise<string>;
  /** Unterseite: creates a child page and returns its target (title used for the ![[...]] embed). */
  onCreateSubpage?: (title: string) => WikiLinkTarget | Promise<WikiLinkTarget>;
  /**
   * KI on the selection (toolbar "KI": Umformulieren, Kürzen, Fortsetzen, Zusammenfassen; slash
   * "Fortsetzen"): call POST /api/chat/action with `request.action` / `request.markdown` and return
   * the answer as Markdown. Without it the KI entries are hidden.
   */
  onAiAction?: (request: EditorAiRequest) => string | Promise<string>;
  /** "Frage dazu stellen": open the copilot with the selected text. */
  onAiAsk?: (selection: string) => void;
  /** Slash "Daily Note (heute)": today's daily note as a wiki target (the host creates it when missing). */
  onDailyNote?: () => WikiLinkTarget | Promise<WikiLinkTarget>;
  editable?: boolean;
  /**
   * Long entries (books, long articles): every chapter heading starts folded, the table of contents
   * stays open. View state only, the Markdown is unchanged (sections.ts).
   */
  foldSections?: boolean;
  /** Placeholder for empty blocks; default "Write, or type / for commands" in the user's language. */
  placeholder?: string;
  className?: string;
}

const NO_TARGETS: WikiLinkTarget[] = [];

type Theme = "dark" | "light";
const readTheme = (): Theme =>
  typeof document !== "undefined" && document.documentElement.dataset.theme === "light"
    ? "light"
    : "dark";

/** Follows `data-theme` on <html> (set by the app shell); dark by default. */
function useDocumentTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    setTheme(readTheme());
    return () => observer.disconnect();
  }, []);
  return theme;
}

const toEditorBlocks = (blocks: ReturnType<typeof markdownToBlocks>["blocks"]) =>
  blocks as unknown as KortexEditorPartialBlock[];

const KortexSideMenu = () => <SideMenu dragHandleMenu={KortexDragHandleMenu} />;

/**
 * Kortex block editor: BlockNote with the Kortex schema, prototype-styled menus and blocks,
 * reading and writing portable Markdown (`content_md`).
 */
type InlineLike = { type: string; href?: string; content?: unknown };
type BlockWithContent = { id: string; content?: unknown; children?: BlockWithContent[] };

/** Replaces links with unsafe targets by their text, in every block; true when something changed. */
function stripUnsafeLinks(editor: KortexEditorInstance): boolean {
  let changed = false;
  const visit = (blocks: readonly BlockWithContent[]) => {
    for (const b of blocks) {
      if (Array.isArray(b.content) && (b.content as InlineLike[]).some((c) => c.type === "link" && !isSafeHref(c.href))) {
        const content = (b.content as InlineLike[]).flatMap((c) =>
          c.type === "link" && !isSafeHref(c.href) ? ((Array.isArray(c.content) ? c.content : []) as InlineLike[]) : [c],
        );
        editor.updateBlock(b.id, { content: content as never });
        changed = true;
      }
      if (b.children?.length) visit(b.children);
    }
  };
  visit(editor.document as unknown as BlockWithContent[]);
  return changed;
}

export function KortexEditor(props: KortexEditorProps): JSX.Element {
  const {
    markdown,
    onChange,
    wikiTargets = NO_TARGETS,
    onOpenWikiLink,
    onAiSummary,
    onCreateSubpage,
    onAiAction,
    onAiAsk,
    onDailyNote,
    editable = true,
    foldSections = false,
    placeholder = t("Write, or type / for commands"),
    className,
  } = props;

  // The editor is created once from the first `markdown`; later prop changes are applied below.
  const fold = useRef(foldSections);
  fold.current = foldSections;
  const [initial] = useState(() => markdownToBlocks(markdown));
  const shown = (blocks: ReturnType<typeof markdownToBlocks>["blocks"]) => (fold.current ? nestSections(blocks) : blocks);
  const frontmatter = useRef(initial.frontmatter);
  /** Last `markdown` prop applied, and the last markdown this editor emitted (canonical form). */
  const lastProp = useRef(markdown);
  const lastEmitted = useRef(blocksToMarkdown(initial.blocks, initial.frontmatter));
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const dictionary = useMemo(
    () => {
      // BlockNote's own texts (table handles, link toolbar, file panel, ...) in the user's language.
      const base = getLocale() === "de" ? de : en;
      return {
        ...base,
        placeholders: { ...base.placeholders, default: placeholder, emptyDocument: placeholder },
      };
    },
    [placeholder],
  );

  const editor = useCreateBlockNote(
    {
      schema: kortexSchema,
      initialContent: initial.blocks.length ? toEditorBlocks(shown(initial.blocks)) : undefined,
      dictionary,
      tables: { headers: true },
    },
    [],
  );

  useEffect(() => {
    getBridge(editor).set({
      wikiTargets,
      onOpenWikiLink,
      onAiSummary,
      onCreateSubpage,
      onAiAction,
      onAiAsk,
      onDailyNote,
    });
  }, [editor, wikiTargets, onOpenWikiLink, onAiSummary, onCreateSubpage, onAiAction, onAiAsk, onDailyNote]);

  // External content changes (another tab, sync daemon, an AI proposal, ...) replace the document.
  // Compared with what the editor shows now (lastEmitted, canonical), not with the previous prop:
  // after local edits an external text equal to an earlier prop is still a real change (review N5 #19).
  // A text that only differs in Markdown spelling (same canonical form) changes nothing, so the
  // caret stays where it is.
  useEffect(() => {
    if (markdown === lastProp.current && markdown === lastEmitted.current) return;
    lastProp.current = markdown;
    if (markdown === lastEmitted.current) return; // the host echoes what we emitted
    const next = markdownToBlocks(markdown);
    const canonical = blocksToMarkdown(next.blocks, next.frontmatter);
    if (canonical === lastEmitted.current) return;
    frontmatter.current = next.frontmatter;
    lastEmitted.current = canonical;
    // Keep the caret in the block with the same position, when the editor has focus.
    const focused = editor.isFocused();
    const at = focused ? editor.document.findIndex((b) => b.id === editor.getTextCursorPosition().block.id) : -1;
    editor.replaceBlocks(
      editor.document,
      next.blocks.length ? toEditorBlocks(shown(next.blocks)) : [{ type: "paragraph" }],
    );
    if (at >= 0) {
      const doc = editor.document;
      const target = doc[Math.min(at, doc.length - 1)];
      if (target) editor.setTextCursorPosition(target, "end");
    }
  }, [editor, markdown]);

  const handleChange = useCallback(() => {
    // N5 #24: a link with an unsafe target (toolbar "Link", paste) becomes plain text again; the
    // update fires another change, which then emits the Markdown.
    if (stripUnsafeLinks(editor)) return;
    const md = blocksToMarkdown(editor.document, frontmatter.current);
    if (md === lastEmitted.current) return; // no Markdown-visible change (e.g. empty paragraph, pending AI block)
    lastEmitted.current = md;
    onChangeRef.current?.(md);
  }, [editor]);

  const theme = useDocumentTheme();

  // Alt+↑ / Alt+↓ moves the block at the caret (or the selected blocks), W8.1.
  const onKeyDownCapture = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!editable || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "ArrowUp") editor.moveBlocksUp();
      else editor.moveBlocksDown();
    },
    [editor, editable],
  );

  return (
    <BlockNoteView
      editor={editor}
      theme={theme}
      editable={editable}
      onChange={handleChange}
      className={className ? `kx-editor ${className}` : "kx-editor"}
      onKeyDownCapture={onKeyDownCapture}
      slashMenu={false}
      formattingToolbar={false}
      sideMenu={false}
      emojiPicker={false}
    >
      <SlashMenu editor={editor} />
      <WikiLinkMenu editor={editor} />
      <MentionMenu editor={editor} />
      <FormattingToolbarController formattingToolbar={KortexFormattingToolbar} />
      <SideMenuController sideMenu={KortexSideMenu} />
    </BlockNoteView>
  );
}
