import "../i18n";
export { KortexEditor, type KortexEditorProps } from "./KortexEditor";
export { nestSections } from "./sections";
export type { WikiLinkTarget } from "./bridge";
export type { EditorAiAction, EditorAiRequest } from "./ai";
export {
  markdownToBlocks,
  blocksToMarkdown,
  splitFrontmatter,
  type BlockLike,
  type KortexInline,
  type KortexLink,
  type KortexPartialBlock,
  type KortexStyles,
  type KortexTableCell,
  type KortexTableContent,
  type KortexText,
  type KortexWikiLink,
} from "./markdown";
// Type-only: keeps this entry importable from server code (markdown helpers) without pulling in BlockNote.
export type { KortexBlock, KortexEditorInstance, KortexEditorPartialBlock } from "./schema";
