import { t, tn } from "../i18n";
import { Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { bulkActions, flattenMenu, menuFor, type ActionId, type MenuIcon } from "@kortex/ui/menu-model";
import { kortexUrl } from "../api/config";
import type { Entry } from "../data/mock";
import { SPACES, spaceOf } from "../data/live";
import { useApp, type Menu } from "../state/AppState";
import { useData } from "../state/Data";
import { useTheme } from "../theme/ThemeProvider";
import type { IconName } from "./Icon";
import type { BarAction } from "./SelectionBar";
import type { SwipeAction } from "./SwipeRow";

/*
 * What a row of an entry can do, shared by every list. The actions come from the same model as the web
 * context menu (`@kortex/ui/menu-model`, feedback round 2): open, copy link, move, tags, favourite,
 * archive, delete. Swipe right = favourite, swipe left opens Archivieren · Löschen (both with undo); a long-press starts the
 * selection mode, whose bar runs the same actions on several rows; "Mehr" there opens the row's menu.
 */

/** Seconds an undo toast stays before a delete reaches the server. */
const UNDO_MS = 6500;

const ICON: Record<MenuIcon, IconName> = {
  open: "note",
  split: "note",
  link: "link",
  move: "folder",
  tag: "tag",
  star: "star",
  "star-off": "star",
  archive: "archive",
  unarchive: "archive",
  trash: "trash",
  check: "check",
  undo: "x",
  accept: "check",
  export: "note",
  edit: "note",
  study: "play",
};

/** Daily notes are journal entries: they get the journal menu (export as note instead of move / tags). */
const isJournal = (e: Entry) => /Daily/i.test(e.folder ?? "") || /^Daily Journal/i.test(e.title);

export function useEntryActions() {
  const a = useApp();
  const d = useData();
  const th = useTheme();
  const router = useRouter();
  const live = d.auth === "live";

  const report = (err: string | null, ok: string, undo?: () => void) => {
    if (err) a.say(err);
    else a.say(ok, undo ? { label: t("Undo"), run: undo } : undefined);
  };

  const archive = (ids: string[]) =>
    void Promise.all(ids.map((id) => d.archive(id))).then((errs) =>
      report(errs.find(Boolean) ?? null, tn(ids.length, "Entry archived", "{n} entries archived"), () => void Promise.all(ids.map((id) => d.unarchive(id))).then((u) => u.find(Boolean) && a.say(u.find(Boolean)!))),
    );

  // G4: back out of the Archiv view, with undo (archives again).
  const restore = (ids: string[]) =>
    void Promise.all(ids.map((id) => d.unarchive(id))).then((errs) =>
      report(errs.find(Boolean) ?? null, tn(ids.length, "Entry restored", "{n} entries restored"), () => void Promise.all(ids.map((id) => d.archive(id))).then((u) => u.find(Boolean) && a.say(u.find(Boolean)!))),
    );

  const favorite = (ids: string[], on: boolean) => {
    const todo = ids.filter((id) => !!d.entryById(id)?.fav !== on);
    if (!todo.length) return;
    void Promise.all(todo.map((id) => d.toggleFavorite(id))).then((errs) => report(errs.find(Boolean) ?? null, on ? t("Added to favorites") : t("Removed from favorites")));
  };

  const move = (ids: string[], folder: string, label: string) => void Promise.all(ids.map((id) => d.moveTo(id, folder))).then((errs) => report(errs.find(Boolean) ?? null, tn(ids.length, "Entry moved to {label}", "{n} entries moved to {label}", { label })));

  const remove = (ids: string[]) => {
    const h = d.deleteEntries(ids);
    const timer = setTimeout(() => void h.commit().then((err) => err && a.say(t("Not deleted: {message}", { message: err }))), UNDO_MS);
    a.say(tn(ids.length, "Entry deleted", "{n} entries deleted"), {
      label: t("Undo"),
      run: () => {
        clearTimeout(timer);
        h.undo();
      },
    });
  };

  const copyLink = async (id: string) => {
    try {
      await Clipboard.setStringAsync(`${kortexUrl()}/notes/${id}`);
      a.say(t("Link copied"));
    } catch {
      a.say(t("The link could not be copied"));
    }
  };

  const moveMenu = (ids: string[]): Menu => {
    const first = d.entryById(ids[0] ?? "");
    return {
      title: ids.length === 1 ? t("Move “{title}”", { title: first?.title ?? t("Entry") }) : t("Move {n} entries", { n: ids.length }),
      items: SPACES.filter(([f]) => ids.length > 1 || !first?.folder || spaceOf(first.folder) !== spaceOf(f)).map(([folder, label]) => ({ label: t(label), icon: "folder", run: () => move(ids, folder, t(label)) })),
    };
  };

  const tagsMenu = (ids: string[]): Menu => {
    const have = (tag: string) => ids.every((id) => d.tagsOf(id).includes(tag));
    return {
      title: ids.length === 1 ? "Tags" : t("Tags for {n} entries", { n: ids.length }),
      items: d.knownTags.length
        ? d.knownTags.map((tag) => ({
            label: `${have(tag) ? "✓ " : ""}#${tag}`,
            icon: "tag",
            run: () => void d.tagEntries(ids, tag, !have(tag)).then((err) => report(err, have(tag) ? t("#{tag} removed", { tag }) : t("#{tag} added", { tag }))),
          }))
        : [{ label: t("No tags in the vault yet"), icon: "tag", run: () => undefined }],
    };
  };

  /** Runs an action of the shared model on one or several entries. */
  const many = (action: ActionId, ids: string[]) => {
    if (!ids.length) return;
    switch (action) {
      case "open":
        a.openEntry(ids[0]!);
        return;
      case "copy-link":
        void copyLink(ids[0]!);
        return;
      case "favorite":
        favorite(ids, true);
        return;
      case "unfavorite":
        favorite(ids, false);
        return;
      case "archive":
        archive(ids);
        return;
      case "unarchive":
        restore(ids);
        return;
      case "delete":
        remove(ids);
        return;
      case "export-note":
        void d.exportNote(ids[0]!).then((r) => ("error" in r ? a.say(t("Not exported: {message}", { message: r.error })) : a.say(t("Exported as a note"), { label: t("Open"), run: () => a.openEntry(r.id) })));
        return;
      case "move":
        if (live) setTimeout(() => a.openMenu(moveMenu(ids)), 220);
        else a.say(t("Nothing is moved in demo mode"));
        return;
      case "tags":
        if (live) setTimeout(() => a.openMenu(tagsMenu(ids)), 220);
        else a.say(t("There are no tags to change in demo mode"));
        return;
      default:
        return;
    }
  };

  /** Menu of one entry: the shared actions plus what only makes sense on the phone. */
  const menu = (e: Entry): Menu => {
    const model = isJournal(e) ? menuFor({ kind: "journal-entry", split: false }) : menuFor({ kind: "item", split: false, favorite: e.fav, archived: e.archived });
    const base = flattenMenu(model).map((m) => ({
      id: m.id,
      label: m.label.replace(/ …$/, ""),
      icon: ICON[m.icon],
      danger: m.danger,
      run: () => many(m.id, [e.id]),
    }));
    const extras = [
      ...(live ? [{ label: t("Edit"), icon: "note", run: () => router.push(`/editor?id=${e.id}`) }] : []),
      {
        label: t("Ask AI about it"),
        icon: "sparkles",
        run: () => {
          router.navigate("/ask");
          a.ask(t("Summarize {title} for me", { title: e.title }), live ? e.id : undefined);
        },
      },
      { label: t("Share"), icon: "share", run: () => void Share.share({ message: `${e.title}\n\n${e.tldr}` }) },
    ];
    const at = base.findIndex((m) => m.id === "copy-link");
    return { title: e.title, items: [...base.slice(0, at + 1), ...extras, ...base.slice(at + 1)] };
  };

  /** Buttons of the selection bar (feedback #4): the bulk actions of the model. */
  const bar = (ids: string[], onDone: () => void): BarAction[] => {
    const more: BarAction[] = ids.length === 1 ? [{ key: "more", label: t("More"), icon: "list", run: () => d.entryById(ids[0]!) && a.openMenu(menu(d.entryById(ids[0]!)!)) }] : [];
    const fromModel = bulkActions("item", ids.length, { archived: !!d.entryById(ids[0] ?? "")?.archived }).map<BarAction>((m) => ({
      key: m.id,
      label: m.label.replace(/ \(\d+\)/, "").replace(/ …$/, ""),
      icon: ICON[m.icon],
      danger: m.danger,
      run: () => {
        many(m.id, ids);
        if (m.id !== "move" && m.id !== "tags") onDone();
      },
    }));
    return [...fromModel, ...more];
  };

  const archiveAction = (id: string): SwipeAction => ({ label: t("Archive"), icon: "archive", color: th.textSecondary, run: () => archive([id]) });
  const deleteAction = (id: string): SwipeAction => ({ label: t("Delete"), icon: "trash", color: th.statusUrgentText, run: () => remove([id]) });

  const pin = (id: string, on: boolean) => void d.togglePin(id).then((err) => report(err, on ? t("Flagged") : t("Flag removed")));
  const read = (id: string) => void d.toggleRead(id).then((err) => err && a.say(err));

  /** "Processed today" (Inbox): swipe left opens Read · Flag · Archive · Delete; right = favourite. */
  const processedSwipe = (p: { id: string; read?: boolean; pinned?: boolean }): { left?: SwipeAction; right: SwipeAction[] } => {
    const e = d.entryById(p.id);
    return {
      left: e ? { label: e.fav ? t("Remove") : t("Favorite"), icon: "star", color: th.accentAi, run: () => favorite([e.id], !e.fav) } : undefined,
      right: [
        { label: p.read ? t("Unread") : t("Read"), icon: "mailOpen", color: th.textSecondary, run: () => read(p.id) },
        { label: p.pinned ? t("Unflag") : t("Flag"), icon: "flag", color: th.accentAi, run: () => pin(p.id, !p.pinned) },
        archiveAction(p.id),
        deleteAction(p.id),
      ],
    };
  };

  const swipe = (e: Entry): { left: SwipeAction; right: SwipeAction | SwipeAction[] } =>
    e.archived
      ? {
          // Archiv view (G4): swipe right brings it back, swipe left deletes it for good (with undo).
          left: { label: t("Restore"), icon: "archive", color: th.accentAi, run: () => restore([e.id]) },
          right: { label: t("Delete"), icon: "trash", color: th.statusUrgentText, confirm: true, run: () => remove([e.id]) },
        }
      : {
    left: { label: e.fav ? t("Remove") : t("Favorite"), icon: "star", color: th.accentAi, run: () => favorite([e.id], !e.fav) },
    right: [archiveAction(e.id), deleteAction(e.id)],
        };

  /** Long-press on a Life tile: open and copy link (editing the vision is a web action for now). */
  const areaMenu = (area: { key: string; name: string }): Menu => ({
    title: area.name,
    items: flattenMenu(menuFor({ kind: "life-area", split: false, hasSource: false }))
      .filter((m) => m.id !== "edit")
      .map((m) => ({
        label: m.label,
        icon: ICON[m.icon],
        run: () => {
          if (m.id === "open") a.openArea(area.key);
          else if (m.id === "copy-link") void Clipboard.setStringAsync(`${kortexUrl()}/life/${area.key}`).then(() => a.say(t("Link copied")));
        },
      })),
  });

  /** Long-press on the Home flashcard tile: learn, edit (open the note), copy link, delete the deck with undo. */
  const deckMenu = (deck: { itemId: string; deck: string }, learn: () => void): Menu => ({
    title: deck.deck,
    items: flattenMenu(menuFor({ kind: "flashcard-deck" })).map((m) => ({
      label: m.label,
      icon: ICON[m.icon],
      danger: m.danger,
      run: () => {
        if (m.id === "study") learn();
        else if (m.id === "edit") a.openEntry(deck.itemId);
        else if (m.id === "copy-link") void copyLink(deck.itemId);
        else if (m.id === "delete") {
          const h = d.deleteDeck(deck.itemId);
          const timer = setTimeout(() => void h.commit().then((err) => err && a.say(t("Not deleted: {message}", { message: err }))), UNDO_MS);
          a.say(t("Deck deleted"), {
            label: t("Undo"),
            run: () => {
              clearTimeout(timer);
              h.undo();
            },
          });
        }
      },
    })),
  });

  return { menu, swipe, processedSwipe, bar, many, areaMenu, deckMenu, archive, remove, openMenu: (e: Entry) => a.openMenu(menu(e)) };
}
