import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { FilePanelExtension, SuggestionMenu } from "@blocknote/core/extensions";
import { SuggestionMenuController, type SuggestionMenuProps } from "@blocknote/react";
import { t, tx } from "@kortex/i18n";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { runEditorAiAction } from "./ai";
import { getBridge, type WikiLinkTarget } from "./bridge";
import { aiSummaryTitle } from "./markdown";
import {
  BulletIcon,
  CalloutIcon,
  CodeIcon,
  ContinueIcon,
  DailyNoteIcon,
  DividerIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  LinkIcon,
  MentionIcon,
  NoteIcon,
  NumberedIcon,
  QuoteIcon,
  SparklesIcon,
  SubpageIcon,
  TableIcon,
  TextIcon,
  TodoIcon,
  ToggleIcon,
} from "./icons";
import { mentionAllowed, searchMentions } from "./mention";
import type { KortexEditorInstance, KortexEditorPartialBlock } from "./schema";

export interface KxMenuItem {
  key: string;
  title: string;
  /** Slash menu section ("Grundlagen", "Einbetten", "KI"): a header above its first item. */
  group?: string;
  hint?: string;
  icon: ReactNode;
  aliases?: string[];
  onItemClick: () => void;
}

const ico = { className: "kx-ico", "aria-hidden": true } as const;
/** Title of a new sub-page until the host answers with the real one (stored as the embed target). */
export const subpageDefaultTitle = (): string => t("New subpage");

/** The prototype's `.kx-menu` (NoteSheet slash menu), driven by BlockNote's suggestion menu state. */
function KxMenu({
  label,
  items,
  selectedIndex,
  onItemClick,
}: SuggestionMenuProps<KxMenuItem> & { label: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);
  if (!items.length) return null;
  const grouped = !!items[0]?.group;
  return (
    <div
      ref={listRef}
      className="kx-menu kx-in kx-ed-menu"
      role="menu"
      aria-label={label}
      id="bn-suggestion-menu"
    >
      {grouped ? null : <div className="kx-menu-label">{label}</div>}
      {items.map((item, i) => (
        <MenuRow
          key={item.key}
          header={item.group !== items[i - 1]?.group ? item.group : undefined}
        >
          <button
            id={`bn-suggestion-menu-item-${i}`}
            type="button"
            role="menuitem"
            className={i === selectedIndex ? "kxb kx-menu-item is-selected" : "kxb kx-menu-item"}
            onClick={() => onItemClick?.(item)}
          >
            {item.icon}
            <span className="kx-ed-menu-title">{item.title}</span>
            {item.hint ? <span className="kx-hint">{item.hint}</span> : null}
          </button>
        </MenuRow>
      ))}
    </div>
  );
}

/** A menu row, preceded by its group header when a new group starts. */
function MenuRow({ header, children }: { header?: string; children: ReactNode }) {
  return (
    <>
      {header ? (
        <div className="kx-menu-label kx-ed-menu-group" role="presentation">
          {header}
        </div>
      ) : null}
      {children}
    </>
  );
}

const runItem = (item: KxMenuItem) => item.onItemClick();
const SlashMenuView = (props: SuggestionMenuProps<KxMenuItem>) => (
  <KxMenu label={t("Blocks")} {...props} />
);
const WikiMenuView = (props: SuggestionMenuProps<KxMenuItem>) => (
  <KxMenu label={tx("verb", "Link")} {...props} />
);
const MentionMenuView = (props: SuggestionMenuProps<KxMenuItem>) => (
  <KxMenu label={tx("verb", "Mention")} {...props} />
);

/** Slash menu sections in the current language (getters keep the exported shape). */
export const SLASH_GROUPS = {
  get basic(): string {
    return t("Basics");
  },
  get embed(): string {
    return t("Embed");
  },
  get ai(): string {
    return t("AI");
  },
};

export function slashItems(editor: KortexEditorInstance): KxMenuItem[] {
  const bridge = getBridge(editor);
  const insert = (block: KortexEditorPartialBlock) =>
    insertOrUpdateBlockForSlashMenu(editor, block);
  const safeUpdate = (id: string, update: Parameters<KortexEditorInstance["updateBlock"]>[1]) => {
    // The block may have been deleted while the host callback was pending.
    if (editor.getBlock(id)) editor.updateBlock(id, update);
  };
  const { basic, embed, ai } = SLASH_GROUPS;
  const heading = (level: 1 | 2 | 3, Icon: typeof Heading1Icon): KxMenuItem => ({
    key: `h${level}`,
    group: basic,
    title: t("Heading {level}", { level }),
    hint: "#".repeat(level),
    icon: <Icon {...ico} />,
    aliases: [`h${level}`, "heading", "ueberschrift", "überschrift", "titel"],
    onItemClick: () => insert({ type: "heading", props: { level } }),
  });

  const items: KxMenuItem[] = [
    {
      key: "text",
      group: basic,
      title: t("Text"),
      icon: <TextIcon {...ico} />,
      aliases: ["text", "absatz", "paragraph"],
      onItemClick: () => insert({ type: "paragraph" }),
    },
    heading(1, Heading1Icon),
    heading(2, Heading2Icon),
    heading(3, Heading3Icon),
    {
      key: "todo",
      group: basic,
      title: t("Task"),
      hint: "[ ]",
      icon: <TodoIcon {...ico} />,
      aliases: ["todo", "to-do", "task", "aufgabe", "checkbox"],
      onItemClick: () => insert({ type: "checkListItem" }),
    },
    {
      key: "bullet",
      group: basic,
      title: tx("block", "List"),
      hint: "-",
      icon: <BulletIcon {...ico} />,
      aliases: ["liste", "list", "bullet", "aufzaehlung", "aufzählung"],
      onItemClick: () => insert({ type: "bulletListItem" }),
    },
    {
      key: "numbered",
      group: basic,
      title: t("Numbered list"),
      hint: "1.",
      icon: <NumberedIcon {...ico} />,
      aliases: ["nummeriert", "numbered", "ol", "zahlen", "numbers"],
      onItemClick: () => insert({ type: "numberedListItem" }),
    },
    {
      key: "callout",
      group: basic,
      title: t("Callout"),
      hint: ">",
      icon: <CalloutIcon {...ico} />,
      aliases: ["callout", "hinweis", "note", "info"],
      onItemClick: () => insert({ type: "callout" }),
    },
    {
      key: "toggle",
      group: basic,
      title: t("Toggle"),
      hint: "▸",
      icon: <ToggleIcon {...ico} />,
      aliases: ["toggle", "aufklappbar", "klappe", "details", "einklappen", "collapse", "fold"],
      onItemClick: () => insert({ type: "toggle" }),
    },
    {
      key: "quote",
      group: basic,
      title: t("Quote"),
      hint: tx("quote mark", "“"),
      icon: <QuoteIcon {...ico} />,
      aliases: ["zitat", "quote", "blockquote"],
      onItemClick: () => insert({ type: "quote" }),
    },
    {
      key: "code",
      group: basic,
      title: t("Code"),
      hint: "```",
      icon: <CodeIcon {...ico} />,
      aliases: ["code", "codeblock"],
      onItemClick: () => insert({ type: "codeBlock" }),
    },
    {
      key: "divider",
      group: basic,
      title: t("Divider"),
      hint: "---",
      icon: <DividerIcon {...ico} />,
      aliases: ["trennlinie", "divider", "hr", "linie", "line", "separator"],
      onItemClick: () => insert({ type: "divider" }),
    },
    {
      key: "link",
      group: embed,
      title: t("Link [[note]]"),
      hint: "[[",
      icon: <LinkIcon {...ico} />,
      aliases: ["link", "verknuepfung", "verknüpfung", "wiki", "notiz", "note", "backlink"],
      // Opens the [[ autocomplete at the caret, as if "[[" had been typed.
      onItemClick: () => editor.getExtension(SuggestionMenu)?.openSuggestionMenu("[["),
    },
    {
      key: "mention",
      group: embed,
      title: t("Mention object @"),
      hint: "@",
      icon: <MentionIcon {...ico} />,
      aliases: ["@", "objekt", "object", "erwaehnen", "erwähnen", "person", "projekt", "mention"],
      // Same search as a typed "@": the mention is a [[Wiki-Link]], so it stays portable Markdown.
      onItemClick: () => editor.getExtension(SuggestionMenu)?.openSuggestionMenu("@"),
    },
    {
      key: "subpage",
      group: embed,
      title: t("Subpage"),
      hint: "![[ ]]",
      icon: <SubpageIcon {...ico} />,
      aliases: ["unterseite", "page", "seite", "subpage"],
      onItemClick: () => {
        // Optimistic: the row appears at once, the host's real title replaces the default.
        const title = subpageDefaultTitle();
        const block = insert({ type: "subpage", props: { target: title } });
        const create = bridge.get().onCreateSubpage;
        if (!create) return;
        void Promise.resolve(create(title)).then(
          (page) => safeUpdate(block.id, { props: { target: page.title } }),
          () => undefined,
        );
      },
    },
    {
      key: "table",
      group: embed,
      title: t("Table"),
      hint: "|",
      icon: <TableIcon {...ico} />,
      aliases: ["tabelle", "table", "grid"],
      onItemClick: () =>
        insert({
          type: "table",
          content: {
            type: "tableContent",
            headerRows: 1,
            rows: [{ cells: ["", "", ""] }, { cells: ["", "", ""] }],
          },
        }),
    },
    {
      key: "image",
      group: embed,
      title: t("Image"),
      hint: "img",
      icon: <ImageIcon {...ico} />,
      aliases: ["bild", "image", "img", "foto", "datei", "photo", "picture", "file"],
      onItemClick: () => {
        const block = insert({ type: "image" });
        editor.getExtension(FilePanelExtension)?.showMenu(block.id);
      },
    },
    {
      key: "ai",
      group: ai,
      title: t("AI summary"),
      hint: "AI",
      icon: <SparklesIcon {...ico} />,
      aliases: ["ki", "ai", "summary", "zusammenfassung", "zusammenfassen"],
      onItemClick: () => {
        const summarize = bridge.get().onAiSummary;
        const block = insert({ type: "aiSummary", props: { title: aiSummaryTitle(), pending: !!summarize } });
        if (!summarize) return;
        void Promise.resolve()
          .then(summarize)
          .then(
            (text) => safeUpdate(block.id, { props: { pending: false }, content: text }),
            () => safeUpdate(block.id, { props: { pending: false } }),
          );
      },
    },
  ];
  const daily = bridge.get().onDailyNote;
  if (daily) {
    items.push({
      key: "daily-note",
      group: embed,
      title: t("Daily note (today)"),
      hint: "[[ ]]",
      icon: <DailyNoteIcon {...ico} />,
      aliases: ["daily", "journal", "daily journal", "tagebuch", "heute", "today", "tagesnotiz", "checkin", "check-in"],
      // A [[Wiki-Link]] to today's daily note (the same file as the Home check-in), so it stays portable Markdown.
      onItemClick: () => {
        void Promise.resolve()
          .then(daily)
          .then(
            (note) => editor.insertInlineContent([{ type: "wikiLink", props: { target: note.title, alias: "" } }, " "]),
            () => undefined,
          );
      },
    });
  }
  if (bridge.get().onAiAction) {
    items.push({
      key: "continue",
      group: ai,
      title: t("Continue writing"),
      hint: "AI",
      icon: <ContinueIcon {...ico} />,
      aliases: ["ki", "ai", "fortsetzen", "weiter", "continue", "schreiben", "write"],
      onItemClick: () => void runEditorAiAction(editor, "continue").catch(() => undefined),
    });
  }
  return items;
}

/**
 * Slash menu ("/") in groups (Grundlagen, Einbetten, KI): every group while the query is empty,
 * only the hits (under their group header) while typing; arrows and Enter come from BlockNote.
 */
export function SlashMenu({ editor }: { editor: KortexEditorInstance }) {
  const getItems = useCallback(
    async (query: string) => filterSuggestionItems(slashItems(editor), query),
    [editor],
  );
  return (
    <SuggestionMenuController
      triggerCharacter="/"
      getItems={getItems}
      suggestionMenuComponent={SlashMenuView}
      onItemClick={runItem}
    />
  );
}

const MAX_WIKI_RESULTS = 8;

function wikiItems(editor: KortexEditorInstance, rawQuery: string): KxMenuItem[] {
  const [rawTarget = "", ...aliasParts] = rawQuery.replace(/\]+$/, "").split("|");
  const query = rawTarget.trim();
  const alias = aliasParts.join("|").trim();
  const q = query.toLowerCase();
  const targets = getBridge(editor).get().wikiTargets;
  const insert = (target: string) =>
    editor.insertInlineContent([{ type: "wikiLink", props: { target, alias } }, " "]);
  const exact = targets.find((w) => w.title.toLowerCase() === q);

  // Typing the closing `]]` (Obsidian habit) links right away instead of leaving escaped text.
  if (query && /\]\]$/.test(rawQuery)) {
    setTimeout(() => {
      const menu = editor.getExtension(SuggestionMenu);
      menu?.closeMenu();
      menu?.clearQuery();
      insert(exact?.title ?? query);
    });
    return [];
  }

  const hits = targets.filter((w) => w.title.toLowerCase().includes(q)).slice(0, MAX_WIKI_RESULTS);
  const items: KxMenuItem[] = hits.map((w: WikiLinkTarget) => ({
    key: `t:${w.id}`,
    title: w.title,
    icon: <NoteIcon {...ico} />,
    onItemClick: () => insert(w.title),
  }));
  if (query && !exact) {
    items.push({
      key: "new",
      title: t("Link “{query}”", { query }),
      hint: tx("hint", "new"),
      icon: <LinkIcon {...ico} />,
      onItemClick: () => insert(query),
    });
  }
  return items;
}

/** `[[` autocomplete over the host's wiki targets; inserts a wikiLink node in place of `[[query`. */
export function WikiLinkMenu({ editor }: { editor: KortexEditorInstance }) {
  const getItems = useCallback(async (query: string) => wikiItems(editor, query), [editor]);
  return (
    <SuggestionMenuController
      triggerCharacter="[["
      getItems={getItems}
      suggestionMenuComponent={WikiMenuView}
      onItemClick={runItem}
    />
  );
}

type OpenGuard = NonNullable<Parameters<typeof SuggestionMenuController>[0]["shouldOpen"]>;
// Only at a word start: not inside words or e-mail addresses.
const mentionShouldOpen: OpenGuard = (tr) => {
  const { $from } = tr.selection;
  return mentionAllowed($from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset));
};

/** `@` autocomplete over all entities the host knows (notes, people, projects, books, prompts, ...); inserts a wikiLink. */
export function MentionMenu({ editor }: { editor: KortexEditorInstance }) {
  const getItems = useCallback(
    async (query: string): Promise<KxMenuItem[]> =>
      searchMentions(getBridge(editor).get().wikiTargets, query).map((w: WikiLinkTarget) => ({
        key: `t:${w.id}`,
        title: w.title,
        hint: w.typeLabel,
        icon: <MentionIcon {...ico} />,
        onItemClick: () =>
          editor.insertInlineContent([{ type: "wikiLink", props: { target: w.title, alias: "" } }, " "]),
      })),
    [editor],
  );
  return (
    <SuggestionMenuController
      triggerCharacter="@"
      getItems={getItems}
      suggestionMenuComponent={MentionMenuView}
      onItemClick={runItem}
      shouldOpen={mentionShouldOpen}
    />
  );
}
