import { ShowSelectionExtension, SideMenuExtension } from "@blocknote/core/extensions";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  DragHandleMenu,
  FileCaptionButton,
  FileDeleteButton,
  FileRenameButton,
  FileReplaceButton,
  FormattingToolbar,
  NestBlockButton,
  ScreenReaderOnlySubmit,
  UnnestBlockButton,
  useBlockNoteEditor,
  useComponentsContext,
  useExtension,
  useExtensionState,
  usePortalElement,
  type BlockTypeSelectItem,
} from "@blocknote/react";
import { msg, t } from "@kortex/i18n";
import { useEffect, useMemo, useState, type JSX } from "react";
import { AI_SELECTION_ACTIONS, runEditorAiAction, type EditorAiAction } from "./ai";
import { useBridge } from "./bridge";
import {
  AskIcon,
  CalloutIcon,
  ContinueIcon,
  CustomAiIcon,
  DeleteIcon,
  DuplicateIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  RewriteIcon,
  ShortenIcon,
  SparklesIcon,
  SummarizeIcon,
  TextIcon,
  TodoIcon,
  ToggleIcon,
} from "./icons";
import type { KortexEditorInstance, KortexEditorPartialBlock } from "./schema";

/** "Umwandeln in" / Textart: the block types the reference lists (W8). `name` is the English source: show it with `t(name)`. */
export const TURN_INTO: {
  key: string;
  name: string;
  type: string;
  props?: Record<string, string | number | boolean>;
  icon: BlockTypeSelectItem["icon"];
}[] = [
  { key: "paragraph", name: msg("Text"), type: "paragraph", icon: TextIcon },
  { key: "h1", name: msg("Heading 1"), type: "heading", props: { level: 1 }, icon: Heading1Icon },
  { key: "h2", name: msg("Heading 2"), type: "heading", props: { level: 2 }, icon: Heading2Icon },
  { key: "h3", name: msg("Heading 3"), type: "heading", props: { level: 3 }, icon: Heading3Icon },
  { key: "todo", name: msg("Task"), type: "checkListItem", icon: TodoIcon },
  { key: "callout", name: msg("Callout"), type: "callout", icon: CalloutIcon },
  { key: "toggle", name: msg("Toggle"), type: "toggle", icon: ToggleIcon },
];

const blockTypeItems = (): BlockTypeSelectItem[] =>
  TURN_INTO.map(({ name, type, props, icon }) => ({
    name: t(name),
    type,
    ...(props ? { props } : {}),
    icon,
  }));

const AI_ICONS: Record<EditorAiAction | "ask", typeof RewriteIcon> = {
  rewrite: RewriteIcon,
  shorten: ShortenIcon,
  continue: ContinueIcon,
  summarize: SummarizeIcon,
  ask: AskIcon,
  custom: CustomAiIcon,
};

/**
 * "KI" in the formatting toolbar: Umformulieren, Kürzen, Fortsetzen, Zusammenfassen, Frage dazu
 * stellen, Eigene Anweisung. A BlockNote toolbar menu, so the editor keeps its selection while it is
 * open; the answer is applied by `runEditorAiAction`. "Eigene Anweisung …" swaps the menu for a
 * small prompt field (a popover like the link button's) whose text goes to the model as the
 * instruction for the selection. Hidden when the host offers no KI.
 */
function AiSelectionButton(): JSX.Element | null {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor() as unknown as KortexEditorInstance;
  const bridge = useBridge(editor);
  const portalElement = usePortalElement();
  const { showSelection } = useExtension(ShowSelectionExtension);
  const [busy, setBusy] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const [instruction, setInstruction] = useState("");
  // Keep the selection visible while the prompt field has the focus.
  useEffect(() => {
    showSelection(prompting, "kortexAiPrompt");
    return () => showSelection(false, "kortexAiPrompt");
  }, [prompting, showSelection]);
  if (!editor.isEditable || (!bridge.onAiAction && !bridge.onAiAsk)) return null;

  const execute = (action: EditorAiAction, wish?: string) => {
    setBusy(true);
    void runEditorAiAction(editor, action, wish)
      .catch(() => undefined) // the host reports errors (toast)
      .finally(() => setBusy(false));
  };
  const run = (action: EditorAiAction | "ask") => {
    if (action === "ask") {
      bridge.onAiAsk?.(editor.getSelectedText());
      return;
    }
    if (action === "custom") {
      setPrompting(true);
      return;
    }
    execute(action);
  };
  const closePrompt = () => {
    setPrompting(false);
    editor.focus();
  };
  const submitPrompt = () => {
    const wish = instruction.trim();
    if (!wish) return;
    setPrompting(false);
    setInstruction("");
    execute("custom", wish);
  };

  const button = (
    <Components.FormattingToolbar.Button
      className="bn-button kx-ed-ai-button"
      label={t("AI")}
      mainTooltip={t("AI for the selection")}
      icon={<SparklesIcon className="kx-ico kx-ico--sm" aria-hidden="true" />}
    >
      {busy ? t("AI …") : t("AI")}
    </Components.FormattingToolbar.Button>
  );

  if (prompting) {
    return (
      <Components.Generic.Popover.Root
        open
        onOpenChange={(open) => !open && closePrompt()}
        portalElement={portalElement}
      >
        <Components.Generic.Popover.Trigger>{button}</Components.Generic.Popover.Trigger>
        <Components.Generic.Popover.Content
          className="bn-popover-content bn-form-popover kx-ed-ai-prompt"
          variant="form-popover"
        >
          <Components.Generic.Form.Root
            onSubmit={submitPrompt}
            submitButton={<ScreenReaderOnlySubmit />}
          >
            <Components.Generic.Form.TextInput
              className="bn-text-input"
              name="kortex-ai-instruction"
              icon={<CustomAiIcon className="kx-ico kx-ico--sm" aria-hidden="true" />}
              autoFocus
              autoComplete="off"
              placeholder={t("What should the AI do with the selection? ↵")}
              value={instruction}
              onChange={(e) => setInstruction(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closePrompt();
                }
              }}
            />
          </Components.Generic.Form.Root>
        </Components.Generic.Popover.Content>
      </Components.Generic.Popover.Root>
    );
  }

  return (
    <Components.Generic.Menu.Root portalElement={portalElement} position="bottom-start">
      <Components.Generic.Menu.Trigger>{button}</Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown kx-ed-ai-menu">
        {AI_SELECTION_ACTIONS.filter((a) =>
          a.action === "ask" ? !!bridge.onAiAsk : !!bridge.onAiAction,
        ).map((a) => {
          const Icon = AI_ICONS[a.action];
          return (
            <Components.Generic.Menu.Item
              key={a.action}
              className="bn-menu-item"
              icon={<Icon className="kx-ico kx-ico--sm" aria-hidden="true" />}
              disabled={busy}
              onClick={() => run(a.action)}
            >
              {t(a.label)}
            </Components.Generic.Menu.Item>
          );
        })}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

/**
 * Floating toolbar over a selection (W8.2): Bold, Kursiv, Unterstrichen, Durchgestrichen, Code,
 * Link, Textart, KI. Only formatting Markdown can hold (underline as `<u>`); no colours/alignment.
 */
export const KortexFormattingToolbar = () => {
  const blockTypes = useMemo(blockTypeItems, []);
  return (
  <FormattingToolbar>
    <FileCaptionButton key="fileCaptionButton" />
    <FileReplaceButton key="replaceFileButton" />
    <FileRenameButton key="fileRenameButton" />
    <FileDeleteButton key="fileDeleteButton" />
    <BasicTextStyleButton basicTextStyle="bold" key="boldStyleButton" />
    <BasicTextStyleButton basicTextStyle="italic" key="italicStyleButton" />
    <BasicTextStyleButton basicTextStyle="underline" key="underlineStyleButton" />
    <BasicTextStyleButton basicTextStyle="strike" key="strikeStyleButton" />
    <BasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />
    <CreateLinkButton key="createLinkButton" />
    <BlockTypeSelect key="blockTypeSelect" items={blockTypes} />
    <NestBlockButton key="nestBlockButton" />
    <UnnestBlockButton key="unnestBlockButton" />
    <AiSelectionButton key="aiButton" />
  </FormattingToolbar>
  );
};

/** A copy of a block without ids (BlockNote assigns new ones), children included. */
export function copyBlock(block: {
  type: string;
  props?: object;
  content?: unknown;
  children?: readonly unknown[];
}): KortexEditorPartialBlock {
  const { type, props, content, children } = block;
  return {
    type,
    ...(props ? { props } : {}),
    ...(content !== undefined ? { content } : {}),
    children: (children ?? []).map((c) => copyBlock(c as typeof block)),
  } as unknown as KortexEditorPartialBlock;
}

/** Block-handle menu (W8.1): Umwandeln in …, Duplizieren, Löschen. */
export function KortexDragHandleMenu(): JSX.Element {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor() as unknown as KortexEditorInstance;
  const block = useExtensionState(SideMenuExtension, {
    editor: editor as never,
    selector: (state) => state?.block,
  });

  const targets = () => {
    if (!block) return [];
    const selected = editor.getSelection()?.blocks;
    return selected?.some((b) => b.id === block.id) ? selected : [editor.getBlock(block.id)!];
  };
  const hasInline = !!block && Array.isArray((block as { content?: unknown }).content);
  const ico = { className: "kx-ico kx-ico--sm", "aria-hidden": true } as const;

  return (
    <DragHandleMenu>
      {hasInline ? (
        <>
          <Components.Generic.Menu.Label className="bn-menu-label">
            {t("Turn into")}
          </Components.Generic.Menu.Label>
          {TURN_INTO.map((kind) => {
            const Icon = kind.icon;
            const current =
              block?.type === kind.type &&
              (kind.type !== "heading" ||
                (block?.props as { level?: number })?.level === kind.props?.level);
            return (
              <Components.Generic.Menu.Item
                key={kind.key}
                className="bn-menu-item"
                icon={<Icon {...ico} />}
                checked={current}
                onClick={() => {
                  editor.transact(() => {
                    for (const b of targets())
                      editor.updateBlock(b, { type: kind.type, props: kind.props ?? {} } as never);
                  });
                }}
              >
                {t(kind.name)}
              </Components.Generic.Menu.Item>
            );
          })}
          <Components.Generic.Menu.Divider className="bn-menu-divider" />
        </>
      ) : null}
      <Components.Generic.Menu.Item
        className="bn-menu-item"
        icon={<DuplicateIcon {...ico} />}
        onClick={() => {
          const blocks = targets();
          const last = blocks[blocks.length - 1];
          if (last) editor.insertBlocks(blocks.map(copyBlock), last, "after");
        }}
      >
        {t("Duplicate")}
      </Components.Generic.Menu.Item>
      <Components.Generic.Menu.Item
        className="bn-menu-item"
        icon={<DeleteIcon {...ico} />}
        onClick={() => editor.removeBlocks(targets())}
      >
        {t("Delete")}
      </Components.Generic.Menu.Item>
    </DragHandleMenu>
  );
}
