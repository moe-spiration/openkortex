import {
  BlockNoteSchema,
  createBlockSpec,
  createHeadingBlockSpec,
  createToggleFrame,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  type BlockNoDefaults,
  type PartialBlockNoDefaults,
} from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import type { MouseEvent } from "react";
import { CodeBlock } from "./code";
import { openWikiLink, resolveWikiTarget, useBridge } from "./bridge";
import { CalloutIcon, NoteIcon, SparklesIcon } from "./icons";
import { t } from "@kortex/i18n";
import { AI_SUMMARY_TITLE_AUTO, aiSummaryTitle } from "./markdown";

const Brackets = ({ children }: { children: string }) => (
  <span className="kx-mono kx-ed-brackets" aria-hidden="true">
    {children}
  </span>
);

/** `[[Title]]` / `[[Title|alias]]`: dim brackets like the prototype backlinks; click opens the target. */
export const WikiLink = createReactInlineContentSpec(
  {
    type: "wikiLink",
    propSchema: { target: { default: "" }, alias: { default: "" } },
    content: "none",
  },
  {
    render: function WikiLinkView({ inlineContent, editor }) {
      const bridge = useBridge(editor);
      const { target, alias } = inlineContent.props;
      // Without host targets nothing can be judged unresolved.
      const resolved =
        !bridge.wikiTargets.length || !!resolveWikiTarget(bridge.wikiTargets, target);
      const open = (e: MouseEvent) => {
        e.preventDefault();
        openWikiLink(bridge, target);
      };
      return (
        <span
          className={
            resolved ? "kx-wikilink kx-ed-wikilink" : "kx-wikilink kx-ed-wikilink is-unresolved"
          }
          data-target={target}
          title={target}
          role="link"
          onClick={open}
        >
          <Brackets>[[</Brackets>
          {alias || target}
          <Brackets>]]</Brackets>
        </span>
      );
    },
  },
);

/** Obsidian callout `> [!kind] Title`. */
export const Callout = createReactBlockSpec(
  {
    type: "callout",
    propSchema: { kind: { default: "note" }, title: { default: "" }, fold: { default: "" } },
    content: "inline",
  },
  {
    // W8.4: card surface, radius 12, icon in the accent colour, title above the text.
    render: ({ block, contentRef }) => (
      <div className="kx-callout kx-ed-callout" data-kind={block.props.kind}>
        <span className="kx-ed-callout-icon" contentEditable={false}>
          <CalloutIcon className="kx-ico kx-ico--sm" aria-hidden="true" />
        </span>
        <div className="kx-ed-callout-main">
          {block.props.title ? (
            <div className="kx-callout-head" contentEditable={false}>
              {block.props.title}
            </div>
          ) : null}
          <div ref={contentRef} className="kx-ed-callout-body" />
        </div>
      </div>
    ),
  },
);

/** `> [!ai] KI-Zusammenfassung`: AI callout; `pending` shows the caret while the summary loads. */
export const AiSummary = createReactBlockSpec(
  {
    type: "aiSummary",
    propSchema: { title: { default: AI_SUMMARY_TITLE_AUTO }, pending: { default: false } },
    content: "inline",
  },
  {
    render: ({ block, contentRef }) => (
      <div className="kx-callout kx-ed-ai" data-pending={block.props.pending || undefined}>
        <div className="kx-callout-head" contentEditable={false}>
          <SparklesIcon className="kx-ico kx-ico--sm" aria-hidden="true" />
          {block.props.title && block.props.title !== AI_SUMMARY_TITLE_AUTO ? block.props.title : aiSummaryTitle()}
        </div>
        <div className="kx-ed-ai-body">
          <span ref={contentRef} className="kx-ed-ai-text" />
          {block.props.pending ? <span className="kx-caret" contentEditable={false} /> : null}
        </div>
      </div>
    ),
  },
);

/** `![[Title]]` on its own line: a link row to a child page. */
export const Subpage = createReactBlockSpec(
  {
    type: "subpage",
    propSchema: { target: { default: "" }, alias: { default: "" } },
    content: "none",
  },
  {
    render: function SubpageView({ block, editor }) {
      const bridge = useBridge(editor);
      const { target, alias } = block.props;
      return (
        <div className="kx-ed-subpage" contentEditable={false}>
          <button
            type="button"
            className="kxb kx-wikilink kx-ed-subpage-link"
            title={target}
            onClick={(e) => {
              e.preventDefault();
              openWikiLink(bridge, target);
            }}
          >
            <NoteIcon className="kx-ico kx-ico--sm" aria-hidden="true" />
            <Brackets>[[</Brackets>
            {alias || target || t("Subpage")}
            <Brackets>]]</Brackets>
          </button>
        </div>
      );
    },
  },
);

/** Markdown the editor can't model (HTML, footnotes, math, ...): edited as source, saved verbatim. */
export const RawMarkdown = createReactBlockSpec(
  { type: "rawMarkdown", propSchema: {}, content: "plain" },
  {
    meta: { code: true, defining: true },
    experimental_keyboard: { enter: "line-break" },
    render: ({ contentRef }) => (
      <div className="kx-ed-raw">
        <span className="kx-ed-raw-tag" contentEditable={false}>
          Markdown
        </span>
        <pre>
          <code ref={contentRef} />
        </pre>
      </div>
    ),
  },
);

/**
 * Open/closed state of toggles: the reader's view state for this session (block ids are new on
 * every load, so nothing is kept across loads). Until the reader clicks, the Markdown fold marker
 * decides: `+` open, `-` (and none) closed, as in Obsidian.
 */
const openToggles = new Map<string, boolean>();
/** Lucide chevron-right, stroke from the icon tokens. */
const CHEVRON_SVG =
  '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
/** A toggle just inserted (no title, no body) starts open, so its body can be written right away. */
const isBlank = (b: { content?: unknown; children?: readonly unknown[] }) =>
  !b.children?.length && (!Array.isArray(b.content) || b.content.length === 0);
const toggleState = {
  get: (b: {
    id: string;
    props?: { fold?: unknown };
    content?: unknown;
    children?: readonly unknown[];
  }) => {
    const known = openToggles.get(b.id);
    if (known !== undefined) return known;
    // First look (the frame being built): remember an initially open toggle, so the keyboard
    // settings (Enter into the body) agree with the frame while the title is typed.
    const open = b.props?.fold === "+" || isBlank(b);
    if (open) openToggles.set(b.id, true);
    return open;
  },
  set: (b: { id: string }, open: boolean) => void openToggles.set(b.id, open),
};

/**
 * `> [!toggle]- Title` (K4): the title is the block's text, the body its child blocks. BlockNote's
 * toggle frame (chevron, children hidden while closed); `fold` keeps the Markdown marker as written.
 */
export const Toggle = createBlockSpec(
  { type: "toggle", propSchema: { fold: { default: "-" } }, content: "inline" },
  {
    // Same keyboard as BlockNote's toggle list: Enter in an open toggle starts its body.
    experimental_keyboard: (block) => {
      const open = toggleState.get(block);
      return {
        splitKeepsType: true,
        emptyEnterResets: true,
        enter: open ? "into-children" : "split",
        splitKeepsChildren: !open,
        emptyChildEnter: open ? "stay" : "outdent",
      };
    },
    meta: { isolating: false, dropsIntoChildren: () => true },
    render() {
      const title = document.createElement("p");
      title.className = "kx-ed-toggle-title";
      return { dom: title, contentDOM: title };
    },
    renderFrame(block, editor) {
      const frame = createToggleFrame(block, editor, toggleState);
      frame.dom.classList.add("kx-ed-toggle");
      // Thin line chevron (W2 icon style) instead of BlockNote's filled triangle; the frame rotates it.
      const button = frame.dom.querySelector(".bn-toggle-button");
      if (button) button.innerHTML = CHEVRON_SVG;
      return frame;
    },
  },
);

// Blocks without a lossless Markdown form (audio, video, file, toggle list) are left out; toggles
// use the Kortex `toggle` block above (Obsidian fold callout).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { audio, video, file, toggleListItem, heading, ...keptBlocks } = defaultBlockSpecs;
// Only formatting Markdown can hold: underline is written as `<u>…</u>` (K3); no colours.
const { bold, italic, underline, strike, code } = defaultStyleSpecs;

export const kortexSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...keptBlocks,
    // Toggle headings carry the folded chapters of long entries (sections.ts); Markdown sees plain headings.
    heading: createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: true }),
    codeBlock: CodeBlock(),
    callout: Callout(),
    toggle: Toggle(),
    aiSummary: AiSummary(),
    subpage: Subpage(),
    rawMarkdown: RawMarkdown(),
  },
  inlineContentSpecs: { ...defaultInlineContentSpecs, wikiLink: WikiLink },
  styleSpecs: { bold, italic, underline, strike, code },
});

export type KortexBlockSchema = typeof kortexSchema.blockSchema;
export type KortexInlineContentSchema = typeof kortexSchema.inlineContentSchema;
export type KortexStyleSchema = typeof kortexSchema.styleSchema;
/** A block of the Kortex editor document (`editor.document`). */
export type KortexBlock = BlockNoDefaults<
  KortexBlockSchema,
  KortexInlineContentSchema,
  KortexStyleSchema
>;
export type KortexEditorPartialBlock = PartialBlockNoDefaults<
  KortexBlockSchema,
  KortexInlineContentSchema,
  KortexStyleSchema
>;
export type KortexEditorInstance = typeof kortexSchema.BlockNoteEditor;
