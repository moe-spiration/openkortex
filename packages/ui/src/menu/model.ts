/*
 * One menu model per kind of object (feedback round 2, #3). Pure data, no React and no icons: the web
 * ContextMenu renders it as a right-click / Shift+F10 menu, the mobile app as a long-press sheet.
 */
import { t, tx } from "@kortex/i18n";

export type MenuKind = "item" | "task" | "folder" | "graph-node" | "inbox" | "journal-entry" | "life-area" | "flashcard-deck";

/** Neutral icon keys; each platform maps them to its own icon set. */
export type MenuIcon =
  | "open"
  | "split"
  | "link"
  | "move"
  | "tag"
  | "star"
  | "star-off"
  | "archive"
  | "unarchive"
  | "trash"
  | "check"
  | "undo"
  | "accept"
  | "export"
  | "edit"
  | "study";

export type ActionId =
  | "open"
  | "open-split"
  | "copy-link"
  | "move"
  | "tags"
  | "favorite"
  | "unfavorite"
  | "archive"
  | "unarchive"
  | "delete"
  | "done"
  | "reopen"
  | "accept"
  | "export-note"
  | "edit"
  | "study";

export interface MenuAction {
  id: ActionId;
  label: string;
  icon: MenuIcon;
  /** Hint shown on the right (not a binding by itself; the host wires the keys). */
  shortcut?: string;
  danger?: boolean;
  /** The action needs a second step: pick a folder / toggle tags. */
  submenu?: "folders" | "tags";
}

export type MenuSection = MenuAction[];

export interface MenuContext {
  kind: MenuKind;
  /** Selected objects the menu acts on (1 when omitted). More than 1 gives the bulk variant. */
  count?: number;
  favorite?: boolean;
  archived?: boolean;
  done?: boolean;
  /** False where "in Split öffnen" makes no sense (mobile, no source note, ...). Default true. */
  split?: boolean;
  /** Bulk variant for a selection (also with a single selected object): no navigation actions. */
  bulk?: boolean;
  /** Tasks: whether the task has a source note to open. Default true. */
  hasSource?: boolean;
}

const open = (): MenuAction => ({ id: "open", label: tx("verb", "Open"), icon: "open", shortcut: "Enter" });
const openSplit = (): MenuAction => ({ id: "open-split", label: t("Open in split"), icon: "split", shortcut: "Alt+Enter" });
const exportNote = (): MenuAction => ({ id: "export-note", label: t("Export as note"), icon: "export" });
const copyLink = (): MenuAction => ({ id: "copy-link", label: t("Copy link"), icon: "link" });
/** Single object: "Move to …"; selection: "Move (n) …". The trailing " …" marks the second step. */
const moveAction = (count: number, bulk: boolean): MenuAction => ({
  id: "move",
  label: bulk ? `${withCount(t("Move"), count)} …` : t("Move to …"),
  icon: "move",
  submenu: "folders",
});
const tagsAction = (count: number): MenuAction => ({ id: "tags", label: `${withCount(t("Tags"), count)} …`, icon: "tag", submenu: "tags" });

const withCount = (label: string, count: number) => (count > 1 ? `${label} (${count})` : label);

const favoriteAction = (on: boolean | undefined, count: number): MenuAction =>
  on
    ? { id: "unfavorite", label: withCount(t("Remove favorite"), count), icon: "star-off" }
    : { id: "favorite", label: withCount(t("Mark as favorite"), count), icon: "star" };

const archiveAction = (archived: boolean | undefined, count: number): MenuAction =>
  archived
    ? { id: "unarchive", label: withCount(t("Restore from archive"), count), icon: "unarchive" }
    : { id: "archive", label: withCount(tx("verb", "Archive"), count), icon: "archive" };

const deleteAction = (count: number, label = t("Delete")): MenuAction => ({
  id: "delete",
  label: withCount(label, count),
  icon: "trash",
  shortcut: tx("key", "Del"),
  danger: true,
});

/** Sections of the menu for one object (or, with `count` > 1, for a selection of them). */
export function menuFor(ctx: MenuContext): MenuSection[] {
  const count = Math.max(1, ctx.count ?? 1);
  const bulk = ctx.bulk === true || count > 1;
  const split = ctx.split !== false;
  const nav: MenuAction[] = [open(), ...(split ? [openSplit()] : [])];

  switch (ctx.kind) {
    case "item":
      if (bulk) {
        return [[moveAction(count, true), tagsAction(count), favoriteAction(ctx.favorite, count)], [archiveAction(ctx.archived, count), deleteAction(count)]];
      }
      return [nav, [copyLink()], [moveAction(1, false), tagsAction(1), favoriteAction(ctx.favorite, 1)], [archiveAction(ctx.archived, 1), deleteAction(1)]];

    case "graph-node":
      return [nav, [copyLink()], [favoriteAction(ctx.favorite, 1)]];

    case "folder":
      return [nav, [copyLink()]];

    case "task": {
      const toggle: MenuAction = ctx.done
        ? { id: "reopen", label: withCount(t("Reopen"), count), icon: "undo" }
        : { id: "done", label: withCount(tx("task", "Done"), count), icon: "check" };
      const sections: MenuSection[] = [];
      if (!bulk && ctx.hasSource !== false) sections.push([{ ...open(), label: t("Open source") }, ...(split ? [openSplit()] : [])]);
      sections.push([toggle], [deleteAction(count)]);
      return sections;
    }

    case "journal-entry":
      return [nav, [copyLink(), exportNote()], [deleteAction(count)]];

    case "life-area":
      return [
        [open(), ...(split && ctx.hasSource !== false ? [{ ...openSplit(), label: t("Open latest note in split") }] : [])],
        [copyLink()],
        [{ id: "edit", label: t("Edit vision"), icon: "edit" }],
      ];

    case "flashcard-deck":
      return [
        [
          { id: "study", label: t("Study"), icon: "study" },
          { id: "edit", label: t("Edit"), icon: "edit" },
        ],
        [copyLink()],
        [deleteAction(1, t("Delete deck"))],
      ];

    case "inbox": {
      const accept: MenuAction = { id: "accept", label: withCount(t("Accept"), count), icon: "accept", shortcut: "Enter" };
      return [bulk ? [accept] : [accept, { ...open(), shortcut: undefined }], [moveAction(count, true)], [deleteAction(count, t("Discard"))]];
    }
  }
}

/** Flat list of every action of a menu, in display order. */
export const flattenMenu = (sections: readonly MenuSection[]): MenuAction[] => sections.flat();

/** Actions of the bulk bar above a list (feedback #4): the selection menu without navigation. */
export const bulkActions = (kind: "item" | "task" | "inbox", count: number, flags: Pick<MenuContext, "favorite" | "archived" | "done"> = {}): MenuAction[] =>
  flattenMenu(menuFor({ kind, count, bulk: true, ...flags }));
