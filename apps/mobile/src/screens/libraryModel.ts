import { msg, t } from "../i18n";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { useIsFocused } from "expo-router";
import type { Entry } from "../data/mock";
import { useData } from "../state/Data";
import { groupByRecency, searchEntries } from "../lib/search";
import { useApp, type EntryScope, type ViewMode } from "../state/AppState";
import { useSelection } from "../ui/useSelection";
import { useEntryActions } from "../ui/entryActions";
import { childFolders, parentFolder } from "../lib/links";
import { inMix } from "../lib/library";

/*
 * The data side of the Einträge / Bibliothek tab, shared by the Ruhe screen (screens/ruhe/LibraryRuhe.tsx) and the
 * Vivid one (Entries.tsx): search with its deferred query, scopes (all, favorites, archive, folders), the folder
 * browser, paging, the Ruhe filters (Smart Mix, day of the week band) and the selection mode with Android Back.
 */

/* The chip and sort keys come from the data module; their labels are named here so they follow the language. */
export const CHIP_LABEL: Record<string, string> = {
  all: msg("All"),
  note: msg("Notes"),
  meeting: msg("Meetings"),
  read: msg("Articles and books"),
  video: msg("Reels and podcasts"),
  food: msg("Recipes"),
  ai: msg("AI Memories"),
  object: msg("Objects"),
};
export const SORT_LABEL: Record<string, string> = {
  rel: msg("Relevance"),
  new: msg("Newest"),
  old: msg("Oldest"),
  open: msg("Last opened"),
  az: msg("A to Z"),
};
export const SUGGESTIONS = [msg("Meetings with Tom this week"), msg("Low-carb recipes under 30 min"), msg("What have I saved about MCP?")];

export const EMPTY: Record<Exclude<EntryScope, "all" | "folders">, [string, string]> = {
  favorites: [msg("No favorites yet"), msg("Swipe an entry to the right or mark it with the star in the menu. It then shows up here.")],
  archive: [msg("The archive is empty"), msg("Archived entries end up here. Swipe right to bring one back, left to delete it for good.")],
};

export const VIEWS: { key: ViewMode; aria: string; icon: "list" | "grid" | "time" }[] = [
  { key: "list", aria: msg("List"), icon: "list" },
  { key: "grid", aria: msg("Grid"), icon: "grid" },
  { key: "time", aria: msg("Timeline"), icon: "time" },
];

/** Rows rendered per page: hundreds of rows at once (each with its own swipe gesture) made scrolling stutter. */
export const PAGE = 40;

export function useLibraryModel({ ruhe }: { ruhe: boolean }) {
  const a = useApp();
  const d = useData();
  const { entries, archived, loadArchive } = d;
  const act = useEntryActions();
  const focused = useIsFocused();
  // Ruhe filters on top of the search: a Smart Mix (hashtag) and a day of the week band.
  const [mixTag, setMixTag] = useState<string | null>(null);
  const [dayPick, setDayPick] = useState<number | null>(null);
  // Folder browser: the open folder ("" = vault root), all folder paths and the open folder's entries.
  const [folder, setFolder] = useState("");
  const [paths, setPaths] = useState<string[] | null>(null);
  const [inFolder, setInFolder] = useState<Entry[]>([]);
  const [folderBusy, setFolderBusy] = useState(false);
  const browse = a.scope === "folders";
  const loader = useRef({ loadFolders: d.loadFolders, loadFolder: d.loadFolder, say: a.say });
  loader.current = { loadFolders: d.loadFolders, loadFolder: d.loadFolder, say: a.say };
  useEffect(() => {
    if (!browse || paths) return;
    void loader.current.loadFolders().then((r) => ("error" in r ? loader.current.say(t("Folders not loaded: {error}", { error: r.error })) : setPaths(r.paths)));
  }, [browse, paths]);
  useEffect(() => {
    if (!browse || !folder) return setInFolder([]);
    let live = true;
    setFolderBusy(true);
    void loader.current.loadFolder(folder).then((r) => {
      if (!live) return;
      setFolderBusy(false);
      if ("error" in r) loader.current.say(t("Folder not loaded: {error}", { error: r.error }));
      else setInFolder(r.entries);
    });
    return () => {
      live = false;
    };
  }, [browse, folder]);
  // Entries filed or removed elsewhere while the folder is open: keep the list in step with the loaded data.
  const inFolderLive = useMemo(() => {
    const byId = new Map(entries.map((x) => [x.id, x]));
    return inFolder
      .map((e) => {
        const cur = byId.get(e.id);
        return cur ? { ...cur, folder: cur.folder ?? e.folder } : e;
      })
      .filter((e) => e.folder === folder);
  }, [inFolder, entries, folder]);
  const subfolders = useMemo(() => (browse && paths ? childFolders(paths, folder) : []), [browse, paths, folder]);
  const source = useMemo(
    // A search at the vault root of the folder view searches the whole vault.
    () => (a.scope === "archive" ? archived : a.scope === "favorites" ? entries.filter((e) => e.fav) : browse && (folder || !a.q.trim()) ? inFolderLive : entries),
    [a.scope, archived, entries, browse, folder, a.q, inFolderLive],
  );
  // The list follows the typed query a beat later (deferred), so typing in the search field never waits for the filter.
  const q = useDeferredValue(a.q);
  const { list: found, state, answer } = useMemo(() => searchEntries(source, q, a.chip, a.sort), [source, q, a.chip, a.sort]);
  const list = useMemo(
    () => (ruhe && (mixTag || dayPick !== null) ? found.filter((e) => (!mixTag || inMix(e, mixTag)) && (dayPick === null || e.day === dayPick)) : found),
    [ruhe, found, mixTag, dayPick],
  );
  // The archive is not part of the normal item load: fetch it whenever the Archiv view opens.
  const reload = useRef({ loadArchive, say: a.say });
  reload.current = { loadArchive, say: a.say };
  useEffect(() => {
    if (a.scope === "archive") void reload.current.loadArchive().then((err) => err && reload.current.say(t("Archive not loaded: {error}", { error: err })));
  }, [a.scope]);
  const hasQuery = !!a.q.trim();
  // Live data still on its way and nothing to show yet: placeholder rows instead of "No hits".
  const firstLoad = d.auth === "live" && d.loading && !entries.length && a.scope === "all" && !hasQuery;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [a.scope, q, a.chip, a.sort, a.view, folder, mixTag, dayPick]);
  const shown = useMemo(() => list.slice(0, limit), [list, limit]);
  const more = () => setLimit((l) => (l < list.length ? l + PAGE : l));
  const groups = useMemo(() => groupByRecency(shown), [shown]);

  // Selection mode (feedback #4): a long-press starts it, taps add / remove rows, Back ends it.
  const sel = useSelection(useMemo(() => list.map((e) => e.id), [list]));
  // Android Back inside a folder goes up one level (selection mode handles Back itself).
  useEffect(() => {
    if (!browse || !folder || sel.active || !focused) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setFolder(parentFolder(folder));
      return true;
    });
    return () => sub.remove();
  }, [browse, folder, sel.active, focused]);
  useEffect(() => {
    if (!sel.active) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      sel.clear();
      return true;
    });
    return () => sub.remove();
  }, [sel.active, sel.clear]);
  const press = (id: string) => (sel.active ? sel.toggle(id) : a.openEntry(id));
  const hold = (id: string) => (sel.active ? sel.toggle(id) : sel.start(id));
  return {
    a,
    d,
    act,
    focused,
    mixTag,
    setMixTag,
    dayPick,
    setDayPick,
    folder,
    setFolder,
    paths,
    folderBusy,
    inFolderLive,
    subfolders,
    browse,
    source,
    list,
    state,
    answer,
    hasQuery,
    firstLoad,
    shown,
    more,
    groups,
    sel,
    press,
    hold,
  };
}
