import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BAKED_INSTANCE, instance } from "../api/config";
import { connectInstance, forgetInstance, readStoredInstance } from "../api/instance";
import { refreshWidgets } from "../widgets/refresh";
import { feature, getLocale, t, type Locale } from "../i18n";
import { chooseDeviceLocale, useLocale } from "../i18n/device";
import { createQueue } from "../capture/queue";
import { cleanTaskPatch, stageUpdate, type Stage, type TaskPatch } from "../data/tasks";
import { mergeMeta } from "../data/meta";
import { applyWatchPatch, parseWatch, type WatchPatch } from "@kortex/db/radar";
import { demoRemindAt } from "../data/demoRemind";
import { cancelReminder, scheduleReminder, syncLocalReminders } from "../notify/notifications";
import { AREAS, ENTRIES, IMG, INBOX_JOBS, JUMP, PROCESSED, type Entry, type LifeArea } from "../data/mock";
import { linksOf, resolveWiki, wikiTitles } from "../lib/links";
import { findLifePage, LIFE_PAGE_FOLDER, lifePageTemplate, lifeTag } from "../lib/lifePage";
import { SPACES, backInToJump, emptyHome, homeOf, inboxOf, itemsToEntries, lifeToAreas, sortTasks, type Art, type InboxJob, type ItemRow, type JumpItem, type LiveHome, type Processed, type ReviewRow, type TaskRow } from "../data/live";
import { DEFAULT_AUTO_PLACE_THRESHOLD, thresholdOf } from "@kortex/db/gates";
import { checkAllowed, clearFlashcards, setRead, patchItemMetadata, patchItemWatch, createNote, deleteItems, saveNote, createTask, setArchived, setTasksExported, handOverTask, updateTask, isConfigured, switchInstance, loadArchived, loadFolderItems, loadFolderPaths, loadLifePages, loadLinkedItems, findItemByTitle, loadHome, loadItems, loadLife, loadSettings, loadTasks, patchSettings, setTaskDone, signIn as apiSignIn, secureStorage, signOut as apiSignOut, supabase, updateItem } from "../api/kortex";

/*
 * Who is signed in and the live data of the four tabs. `demo` keeps the prototype's mock data
 * (no account needed); `live` reads Supabase (RLS) and the Kortex API.
 */

export type AuthState = "loading" | "signedOut" | "noAccess" | "live" | "demo";

interface Data {
  auth: AuthState;
  email: string | null;
  /** Display name: user_metadata full_name / name, else the e-mail local part. */
  name: string | null;
  /** Address of the Kortex this app talks to; null until one is entered (first start without a baked server). */
  server: string | null;
  /** The server is part of the build and cannot be changed in the app. */
  serverFixed: boolean;
  /** First start: checks the address (`/api/instance`) and remembers the server. Error text or null. */
  connectServer: (address: string) => Promise<string | null>;
  /** Signs out and forgets the entered server, back to the server step. */
  forgetServer: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  useDemo: () => void;
  /**
   * Switches the app language at once, remembers it on the device and writes `user_settings.locale`
   * (live). Rolled back when the server refuses. Returns an error text or null.
   */
  setLanguage: (locale: Locale) => Promise<string | null>;
  entries: Entry[];
  areas: LifeArea[];
  jump: JumpItem[];
  /** Live Home sections (archive, flashcards, fits today, meeting); null in demo. */
  home: LiveHome | null;
  jobs: InboxJob[];
  processed: Processed[];
  /** "Einsortiert, bitte kurz prüfen" (like the web Inbox): captures the Gardener placed with low confidence. */
  review: ReviewRow[];
  /** "Passt" / a picked folder: files the capture there as a manual placement, so it leaves the review. */
  acceptPlacement: (id: string, folder: string) => Promise<string | null>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Re-reads only the items (Inbox polling, after a capture). */
  refreshItems: () => Promise<void>;
  entryById: (id: string) => Entry | undefined;
  /** G4 Archiv: archived entries (status `archived`), loaded on demand by `loadArchive`. */
  archived: Entry[];
  loadArchive: () => Promise<string | null>;
  // Actions: optimistic, rolled back when the server refuses. They return an error text or null.
  tasks: TaskRow[];
  toggleTask: (id: string) => Promise<string | null>;
  addTask: (title: string) => Promise<string | null>;
  /** Project, timeframe or context of one task (optimistic). */
  patchTask: (id: string, patch: TaskPatch) => Promise<string | null>;
  /** Status board: moves a task to another stage (taken over, with the agent, in Griply, …), optimistic. */
  setTaskStage: (id: string, stage: Stage) => Promise<string | null>;
  /** Sets (on) or clears the "überführt" mark of tasks after an export (optimistic). */
  markTasksExported: (ids: string[], on: boolean) => Promise<string | null>;
  archive: (id: string) => Promise<string | null>;
  /** Undoes the last archive (toast "Undo"). */
  unarchive: (id: string) => Promise<string | null>;
  toggleFavorite: (id: string) => Promise<string | null>;
  /** "Markieren" (is_pinned), optimistic. */
  togglePin: (id: string) => Promise<string | null>;
  /** "Gelesen" / "Ungelesen" (metadata.read_at), optimistic. */
  toggleRead: (id: string) => Promise<string | null>;
  /** Sets (ISO) or clears (null) the reminder of an entry (snooze, S11), optimistic. */
  setReminder: (id: string, iso: string | null) => Promise<string | null>;
  /** Eigenschaften (status, rating, …): merges into metadata, null removes a key; optimistic. */
  patchMeta: (id: string, patch: Record<string, unknown>) => Promise<string | null>;
  /** Watched page (delta radar): "Gesehen" or "Beobachten aus"; optimistic. */
  patchWatch: (id: string, patch: WatchPatch) => Promise<string | null>;
  moveTo: (id: string, folder: string) => Promise<string | null>;
  /** Hashtags in use (without #), for the tag picker of the list menu. */
  knownTags: string[];
  /** Tags of one entry (without #); empty in the demo. */
  tagsOf: (id: string) => string[];
  /** Adds (on) or removes one tag on several entries. */
  tagEntries: (ids: string[], label: string, on: boolean) => Promise<string | null>;
  /**
   * Hides entries at once; `commit` deletes them for good (call it when the undo window has passed),
   * `undo` brings them back. Both are safe to call once.
   */
  deleteEntries: (ids: string[]) => { commit: () => Promise<string | null>; undo: () => void };
  /** "Als Notiz exportieren": copies an entry (a daily note) into a regular note. */
  exportNote: (id: string) => Promise<{ id: string } | { error: string }>;
  /** Hides the flashcard deck of the Home tile; `commit` removes it from the note, `undo` brings it back. */
  deleteDeck: (itemId: string) => { commit: () => Promise<string | null>; undo: () => void };
  /** Editor: saves an existing item (id) or creates a note (null). Returns the id or an error. */
  writeNote: (id: string | null, title: string, md: string) => Promise<{ id: string } | { error: string }>;
  /** Folder browser: every folder path of the vault. */
  loadFolders: () => Promise<{ paths: string[] } | { error: string }>;
  /** Folder browser: the entries filed directly in one folder (also those beyond the loaded page). */
  loadFolder: (path: string) => Promise<{ entries: Entry[] } | { error: string }>;
  /** Detail sheet: what an entry links to and what links back to it, across the whole vault. */
  loadLinks: (id: string) => Promise<{ out: Entry[]; back: Entry[] } | { error: string }>;
  /** Tap on a `[[wiki-link]]`: the id of the entry it points to, or null when there is none. */
  findWiki: (target: string) => Promise<string | null>;
  /** Life: the id of an area's page (10_Notes/Life Areas, tag #life/<key>); created with the vision when missing. */
  lifePage: (key: string) => Promise<{ id: string } | { error: string }>;
}

const DEMO_TASKS: TaskRow[] = [
  { id: "t1", title: "Send the checksum concept to Tom", status: "open", priority: "high", due_date: new Date().toISOString().slice(0, 10), source_item_id: "e2", created_at: "" },
  { id: "t2", title: "Hiring plan by Friday", status: "open", priority: "medium", due_date: null, source_item_id: "e11", created_at: "" },
  { id: "t3", title: "Read chapter 3 on contextual retrieval", status: "done", priority: "low", due_date: null, source_item_id: "e3", created_at: "" },
];

/** Demo entries carry no folder: the folder browser files them by kind, like the vault layout. */
const DEMO_FOLDER: Record<Entry["kind"], string> = { note: "10_Notes", meeting: "20_Meetings", read: "30_Clippings", video: "30_Clippings", ai: "40_AI_Memories", food: "50_Recipes", object: "70_Objects" };

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const art: Art = (key) => (IMG as Record<string, (typeof IMG)["home"]>)[key] ?? IMG.journal;

const MOCK_JOBS: InboxJob[] = INBOX_JOBS.map((j, i) => ({ id: `job${i}`, title: j.title, img: j.img, step: j.steps[0]!, pct: j.start, failed: false }));

/** Copy of a set with `id` toggled. */
const flip = (s: Set<string>, id: string) => {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
};

function displayName(user: { email?: string; user_metadata?: Record<string, unknown> }): string | null {
  const meta = user.user_metadata ?? {};
  const n = [meta.full_name, meta.name, meta.display_name].find((v): v is string => typeof v === "string" && !!v.trim());
  if (n) return n.trim();
  const local = user.email?.split("@")[0]?.split(/[._-]/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : null;
}

const Ctx = createContext<Data | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [server, setServer] = useState<string | null>(() => instance()?.kortexUrl ?? null);
  const [name, setName] = useState<string | null>(null);
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [areas, setAreas] = useState<LifeArea[]>([]);
  const [jump, setJump] = useState<JumpItem[]>([]);
  const [home, setHome] = useState<LiveHome>(emptyHome());
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  // Demo mode: archive / favourite only change local state.
  const [demoHidden, setDemoHidden] = useState<Set<string>>(new Set());
  const [demoFiled, setDemoFiled] = useState<Set<string>>(new Set());
  const [demoFav, setDemoFav] = useState<Set<string>>(new Set());
  const [demoArchived, setDemoArchived] = useState<Set<string>>(new Set());
  const [demoPinned, setDemoPinned] = useState<Set<string>>(new Set());
  const [demoRead, setDemoRead] = useState<Set<string>>(new Set());
  const [demoRemind, setDemoRemind] = useState<Record<string, string | null>>({});
  const [archivedRows, setArchivedRows] = useState<ItemRow[]>([]);
  // Rows fetched on demand (folder browser, links) that are not in the loaded page: kept so their sheet opens.
  const [extraRows, setExtraRows] = useState<ItemRow[]>([]);
  const remember = useCallback((more: ItemRow[]) => {
    if (!more.length) return;
    setExtraRows((rs) => {
      const ids = new Set(more.map((r) => r.id));
      return [...more, ...rs.filter((r) => !ids.has(r.id))].slice(0, 600);
    });
  }, []);
  const archivedRef = useRef(archivedRows);
  archivedRef.current = archivedRows;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(false);
  live.current = auth === "live";
  // Date labels and fallback texts in the context value are built in the current language.
  const locale = useLocale();
  // When the language was last picked on this phone: an account value read before that is stale.
  const localePickedAt = useRef(0);
  const [placeThreshold, setPlaceThreshold] = useState(DEFAULT_AUTO_PLACE_THRESHOLD);

  /** The account's `user_settings.locale` wins over the device language: applied and remembered once it arrives. */
  const syncLocale = useCallback(async () => {
    if (!live.current) return;
    const asked = Date.now();
    try {
      const settings = await loadSettings();
      if (settings) setPlaceThreshold(thresholdOf(settings.auto_place_threshold));
      if (settings && typeof settings.locale === "string" && asked >= localePickedAt.current) await chooseDeviceLocale(settings.locale);
    } catch {
      /* offline: keep the language in use */
    }
  }, []);

  const refreshItems = useCallback(async () => {
    if (!live.current) return;
    try {
      setRows(await loadItems());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!live.current) return;
    setLoading(true);
    void syncLocale();
    // Each part on its own, so one failing endpoint does not blank the others.
    const [items, home, life, taskRows] = await Promise.allSettled([loadItems(), loadHome(), loadLife(), loadTasks()]);
    if (taskRows.status === "fulfilled") setTasks(taskRows.value);
    if (items.status === "fulfilled") {
      setRows(items.value);
      void syncLocalReminders(items.value);
    }
    if (home.status === "fulfilled") {
      setJump(backInToJump(home.value.backIn ?? []));
      setHome(homeOf(home.value));
    }
    if (life.status === "fulfilled") setAreas(lifeToAreas(life.value, art));
    const failed = [items, home, life, taskRows].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    setError(failed ? String(failed.reason instanceof Error ? failed.reason.message : failed.reason) : null);
    setLoading(false);
  }, [syncLocale]);

  // Restore the server (entered on first start, unless the build names one) and the stored session.
  // Runs again when the server changes (entered on first start, or forgotten in the settings).
  useEffect(() => {
    let cancelled = false;
    if (!isConfigured()) {
      void readStoredInstance(AsyncStorage).then((stored) => {
        if (cancelled) return;
        if (!stored) return setAuth((a) => (a === "demo" ? a : "signedOut"));
        switchInstance(stored);
        setServer(stored.kortexUrl);
      });
      return () => {
        cancelled = true;
      };
    }
    const { data: sub } = supabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setAuth((a) => (a === "demo" ? a : "signedOut"));
    });
    (async () => {
      const { data } = await supabase().auth.getSession();
      if (cancelled) return;
      if (!data.session) return setAuth("signedOut");
      setEmail(data.session.user.email ?? null);
      setName(displayName(data.session.user));
      try {
        setAuth((await checkAllowed()) ? "live" : "noAccess");
      } catch {
        // Offline start: keep the session, data loads fail visibly.
        setAuth("live");
      }
    })();
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [server]);

  useEffect(() => {
    if (auth === "live") void refresh();
    if (auth === "demo") setTasks(DEMO_TASKS);
  }, [auth, refresh]);

  /** Optimistic row patch: apply now, restore the previous rows when `run` fails. */
  const patchRow = useCallback(async (id: string, patch: Partial<ItemRow>, run: () => Promise<void>): Promise<string | null> => {
    const before = rowsRef.current;
    const beforeArchived = archivedRef.current;
    setRows((rs) => (patch.status === "archived" ? rs.filter((r) => r.id !== id) : rs.map((r) => (r.id === id ? { ...r, ...patch } : r))));
    // Favourite, tags and moves also work on an entry of the Archiv view.
    if (patch.status !== "archived") setArchivedRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try {
      await run();
      return null;
    } catch (e) {
      setRows(before);
      setArchivedRows(beforeArchived);
      return msgOf(e);
    }
  }, []);

  const value = useMemo<Data>(() => {
    const demo = auth === "demo";
    const entries = demo ? ENTRIES.filter((e) => !demoHidden.has(e.id) && !demoArchived.has(e.id)).map((e) => ({ ...e, fav: demoFav.has(e.id), remindAt: e.id in demoRemind ? demoRemind[e.id] : demoRemindAt(e.id) })) : itemsToEntries(rows, new Date(), art);
    const archived = (demo ? ENTRIES.filter((e) => demoArchived.has(e.id) && !demoHidden.has(e.id)).map((e) => ({ ...e, fav: demoFav.has(e.id) })) : itemsToEntries(archivedRows, new Date(), art)).map((e) => ({ ...e, archived: true }));
    const inbox = demo ? null : inboxOf(rows, new Date(), placeThreshold);
    const extra = demo ? [] : itemsToEntries(extraRows, new Date(), art);
    const byId = new Map([...extra, ...archived, ...entries].map((e) => [e.id, e]));
    const rowOf = (id: string) => rowsRef.current.find((r) => r.id === id) ?? archivedRef.current.find((r) => r.id === id);
    return {
      auth,
      email,
      name: demo ? "Alex" : name,
      server,
      serverFixed: BAKED_INSTANCE !== null,
      connectServer: async (address) => {
        const r = await connectInstance(address, AsyncStorage);
        if (!r.ok) return r.error;
        switchInstance(r.instance);
        setServer(r.instance.kortexUrl);
        return null;
      },
      forgetServer: async () => {
        if (BAKED_INSTANCE) return;
        if (auth !== "demo") await apiSignOut().catch(() => undefined);
        await createQueue(secureStorage).clear().catch(() => undefined);
        await forgetInstance(AsyncStorage).catch(() => undefined);
        switchInstance(null);
        setServer(null);
        setRows([]);
        setArchivedRows([]);
        setExtraRows([]);
        setAreas([]);
        setJump([]);
        setEmail(null);
        setAuth("signedOut");
      },
      signIn: async (mail, password) => {
        const r = await apiSignIn(mail, password);
        if (!r.ok) {
          if (r.noAccess) setAuth("noAccess");
          return r.error;
        }
        setEmail(r.session.user.email ?? mail);
        setName(displayName(r.session.user));
        setAuth("live");
        return null;
      },
      signOut: async () => {
        if (auth !== "demo") await apiSignOut().catch(() => undefined);
        await createQueue(secureStorage).clear().catch(() => undefined);
        setRows([]);
        setArchivedRows([]);
        setExtraRows([]);
        setAreas([]);
        setJump([]);
        setEmail(null);
        setAuth("signedOut");
      },
      useDemo: () => setAuth("demo"),
      setLanguage: async (next) => {
        const before = getLocale();
        localePickedAt.current = Date.now();
        await chooseDeviceLocale(next);
        if (demo || auth !== "live") return null;
        try {
          await patchSettings({ locale: next });
          localePickedAt.current = Date.now();
          return null;
        } catch (e) {
          await chooseDeviceLocale(before);
          return msgOf(e);
        }
      },
      entries,
      areas: demo ? AREAS : areas,
      jump: demo ? JUMP : jump,
      home: demo ? null : home,
      jobs: inbox ? inbox.jobs : MOCK_JOBS,
      review: inbox ? inbox.review : PROCESSED.filter((p) => !demoHidden.has(p.id) && !demoArchived.has(p.id) && !demoFiled.has(p.id)).map((p) => ({ id: p.id, title: p.title, target: `30_${p.space}`, tags: [] })),
      acceptPlacement: async (id, folder) => {
        if (demo) {
          setDemoFiled((s) => new Set(s).add(id));
          return null;
        }
        return patchRow(id, { folder_path: folder, is_manual_placement: true }, () => updateItem(id, { folder_path: folder }));
      },
      processed: inbox
        ? inbox.processed
        : PROCESSED.filter((p) => !demoHidden.has(p.id) && !demoArchived.has(p.id)).map((p) => ({ ...p, read: demoRead.has(p.id), pinned: demoPinned.has(p.id) })),
      loading,
      error,
      refresh,
      refreshItems,
      entryById: (id) => byId.get(id),
      archived,
      loadArchive: async () => {
        if (demo) return null;
        try {
          setArchivedRows(await loadArchived());
          return null;
        } catch (e) {
          return msgOf(e);
        }
      },
      tasks: sortTasks(tasks),
      toggleTask: async (id) => {
        const task = tasksRef.current.find((x) => x.id === id);
        if (!task) return null;
        const done = task.status !== "done";
        setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, status: done ? "done" : "open", completed_at: done ? new Date().toISOString() : null } : x)));
        if (demo) return null;
        try {
          await setTaskDone(id, done);
          void refreshWidgets();
          return null;
        } catch (e) {
          setTasks((ts) => ts.map((x) => (x.id === id ? task : x)));
          return msgOf(e);
        }
      },
      addTask: async (title) => {
        if (!title.trim()) return t("Title is missing");
        const tmp: TaskRow = { id: `tmp${Date.now()}`, title: title.trim(), status: "open", priority: "medium", due_date: null, source_item_id: null, created_at: new Date().toISOString() };
        setTasks((ts) => [tmp, ...ts]);
        if (demo) return null;
        try {
          const saved = await createTask(title);
          void refreshWidgets();
          setTasks((ts) => ts.map((x) => (x.id === tmp.id ? saved : x)));
          return null;
        } catch (e) {
          setTasks((ts) => ts.filter((x) => x.id !== tmp.id));
          return msgOf(e);
        }
      },
      patchTask: async (id, patch) => {
        const task = tasksRef.current.find((x) => x.id === id);
        if (!task) return null;
        let clean: TaskPatch;
        try {
          clean = cleanTaskPatch(patch);
        } catch (e) {
          return msgOf(e);
        }
        setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, ...clean } : x)));
        if (demo || id.startsWith("tmp")) return null;
        try {
          await updateTask(id, clean);
          return null;
        } catch (e) {
          setTasks((ts) => ts.map((x) => (x.id === id ? task : x)));
          return msgOf(e);
        }
      },
      setTaskStage: async (id, stage) => {
        const task = tasksRef.current.find((x) => x.id === id);
        if (!task) return null;
        const up = stageUpdate(task, stage);
        if (!up) return t("Only suggestions from the AI can go back to the suggestions");
        const stamp = new Date().toISOString();
        const next: TaskRow = {
          ...task,
          ...(up.status ? { status: up.status } : {}),
          ...(up.assignee !== undefined ? { assignee: up.assignee } : {}),
          ...(up.exported !== undefined ? { exported_at: up.exported ? stamp : null } : {}),
        };
        setTasks((ts) => ts.map((x) => (x.id === id ? next : x)));
        if (demo || id.startsWith("tmp")) return null;
        try {
          if (up.status || up.assignee !== undefined)
            await updateTask(id, {
              ...(up.status ? { status: up.status, completed_at: up.status === "done" ? stamp : null } : {}),
              ...(up.assignee !== undefined ? { assignee: up.assignee } : {}),
            });
          // Like the web board: "In Griply" really creates the task in Griply (needs the connection on the web).
          if (up.exported === true && !task.external_ref && feature("griply")) {
            const r = await handOverTask(id);
            setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, ...r } : x)));
          } else if (up.exported !== undefined) await setTasksExported([id], up.exported);
          void refreshWidgets();
          return null;
        } catch (e) {
          setTasks((ts) => ts.map((x) => (x.id === id ? task : x)));
          return msgOf(e);
        }
      },
      markTasksExported: async (ids, on) => {
        const before = new Map(tasksRef.current.filter((x) => ids.includes(x.id)).map((x) => [x.id, x.exported_at ?? null]));
        const stamp = new Date().toISOString();
        const set = (at: (id: string) => string | null) => setTasks((ts) => ts.map((x) => (ids.includes(x.id) ? { ...x, exported_at: at(x.id) } : x)));
        set(() => (on ? stamp : null));
        const serverIds = ids.filter((id) => !id.startsWith("tmp"));
        if (demo || !serverIds.length) return null;
        try {
          const saved = await setTasksExported(serverIds, on);
          set((id) => (on ? (saved.get(id) ?? stamp) : null));
          return null;
        } catch (e) {
          set((id) => before.get(id) ?? null);
          return msgOf(e);
        }
      },
      archive: async (id) => {
        if (demo) {
          setDemoArchived((h) => new Set(h).add(id));
          return null;
        }
        // The entry moves into the Archiv list at once (newest first), like the web (G4).
        const row = rowsRef.current.find((r) => r.id === id);
        const beforeArchived = archivedRef.current;
        if (row) setArchivedRows((rs) => [{ ...row, status: "archived", updated_at: new Date().toISOString() }, ...rs.filter((r) => r.id !== id)]);
        const err = await patchRow(id, { status: "archived" }, () => setArchived(id, true));
        if (err) setArchivedRows(beforeArchived);
        else void cancelReminder(id);
        return err;
      },
      unarchive: async (id) => {
        if (demo) {
          setDemoArchived((h) => {
            const n = new Set(h);
            n.delete(id);
            return n;
          });
          return null;
        }
        // Back to the status it had before archiving (metadata.status_before_archive).
        const beforeArchived = archivedRef.current;
        setArchivedRows((rs) => rs.filter((r) => r.id !== id));
        try {
          await setArchived(id, false);
          await refreshItems();
          return null;
        } catch (e) {
          setArchivedRows(beforeArchived);
          return msgOf(e);
        }
      },
      toggleFavorite: async (id) => {
        if (demo) {
          setDemoFav((f) => {
            const n = new Set(f);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          });
          return null;
        }
        const fav = !rowOf(id)?.is_favorite;
        return patchRow(id, { is_favorite: fav }, () => updateItem(id, { is_favorite: fav }));
      },
      togglePin: async (id) => {
        if (demo) {
          setDemoPinned((s) => flip(s, id));
          return null;
        }
        const pinned = !rowOf(id)?.is_pinned;
        return patchRow(id, { is_pinned: pinned }, () => updateItem(id, { is_pinned: pinned }));
      },
      setReminder: async (id, iso) => {
        if (demo) {
          setDemoRemind((m) => ({ ...m, [id]: iso }));
          return null;
        }
        const err = await patchRow(id, { remind_at: iso }, () => updateItem(id, { remind_at: iso }));
        // Snooze, done (cleared) and a new time re-plan the local notification; a refused write leaves it as it was.
        if (!err) {
          if (iso) void scheduleReminder(id, rowOf(id)?.title ?? "", iso);
          else void cancelReminder(id);
        }
        return err;
      },
      toggleRead: async (id) => {
        if (demo) {
          setDemoRead((s) => flip(s, id));
          return null;
        }
        const row = rowOf(id);
        const read = !(typeof row?.metadata?.read_at === "string");
        const meta = { ...(row?.metadata ?? {}) };
        if (read) meta.read_at = new Date().toISOString();
        else delete meta.read_at;
        return patchRow(id, { metadata: meta }, async () => {
          await setRead(id, read);
        });
      },
      patchMeta: async (id, patch) => {
        if (demo) return t("Nothing is saved in demo mode");
        const row = rowOf(id);
        return patchRow(id, { metadata: mergeMeta(row?.metadata, patch) }, async () => {
          await patchItemMetadata(id, patch);
        });
      },
      patchWatch: async (id, patch) => {
        if (demo) return t("Nothing is saved in demo mode");
        const meta = (rowOf(id)?.metadata ?? {}) as Record<string, unknown>;
        return patchRow(id, { metadata: { ...meta, watch: applyWatchPatch(parseWatch(meta), patch, new Date()) } as ItemRow["metadata"] }, async () => {
          await patchItemWatch(id, patch);
        });
      },
      writeNote: async (id, title, md) => {
        if (demo) return { error: t("Nothing is saved in demo mode") };
        try {
          if (id) {
            const before = rowsRef.current;
            setRows((rs) => rs.map((r) => (r.id === id ? { ...r, title: title.trim() || r.title, content_md: md, updated_at: new Date().toISOString() } : r)));
            try {
              await saveNote(id, { title, content_md: md });
            } catch (e) {
              setRows(before);
              throw e;
            }
            return { id };
          }
          const created = await createNote(title, md);
          void refreshItems();
          return { id: created.id };
        } catch (e) {
          return { error: msgOf(e) };
        }
      },
      moveTo: async (id, folder) => {
        if (demo) return null;
        return patchRow(id, { folder_path: folder }, () => updateItem(id, { folder_path: folder }));
      },
      tagsOf: (id) => (demo ? [] : (rowOf(id)?.tags ?? [])),
      exportNote: async (id) => {
        if (demo) return { error: t("Nothing is created in demo mode") };
        const row = rowsRef.current.find((r) => r.id === id);
        if (!row) return { error: t("Entry not found") };
        try {
          const created = await createNote(row.title, row.content_md ?? "", "10_Notes");
          void refreshItems();
          return { id: created.id };
        } catch (e) {
          return { error: msgOf(e) };
        }
      },
      deleteDeck: (itemId) => {
        const before = home;
        let settled = false;
        setHome((h) => ({ ...h, flashcards: null }));
        return {
          commit: async () => {
            if (settled) return null;
            settled = true;
            if (demo) return null;
            try {
              await clearFlashcards(itemId);
              return null;
            } catch (e) {
              setHome(before);
              return msgOf(e);
            }
          },
          undo: () => {
            if (settled) return;
            settled = true;
            setHome(before);
          },
        };
      },
      knownTags: [...new Set(demo ? [] : rows.flatMap((r) => r.tags ?? []))].sort(),
      tagEntries: async (ids, label, on) => {
        if (demo) return null;
        const name = label.replace(/^#/, "").trim();
        if (!name) return t("Empty tag");
        let failed: string | null = null;
        for (const id of ids) {
          const cur = rowOf(id)?.tags ?? [];
          const next = on ? [...new Set([...cur, name])] : cur.filter((tag) => tag !== name);
          const err = await patchRow(id, { tags: next }, () => updateItem(id, { tags: next }));
          failed ??= err;
        }
        return failed;
      },
      deleteEntries: (ids) => {
        const before = rowsRef.current;
        const beforeArchived = archivedRef.current;
        let settled = false;
        if (demo) setDemoHidden((h) => new Set([...h, ...ids]));
        else {
          setRows((rs) => rs.filter((r) => !ids.includes(r.id)));
          setArchivedRows((rs) => rs.filter((r) => !ids.includes(r.id)));
        }
        return {
          commit: async () => {
            if (settled) return null;
            settled = true;
            if (demo) return null;
            try {
              await deleteItems(ids);
              for (const id of ids) void cancelReminder(id);
              return null;
            } catch (e) {
              setRows(before);
              setArchivedRows(beforeArchived);
              return msgOf(e);
            }
          },
          undo: () => {
            if (settled) return;
            settled = true;
            if (demo) setDemoHidden((h) => new Set([...h].filter((x) => !ids.includes(x))));
            else {
              setRows(before);
              setArchivedRows(beforeArchived);
            }
          },
        };
      },
      loadFolders: async () => {
        if (demo) return { paths: [...SPACES.map(([f]) => f), "70_Objects"] };
        try {
          return { paths: await loadFolderPaths() };
        } catch (e) {
          return { error: msgOf(e) };
        }
      },
      loadFolder: async (path) => {
        if (demo) return { entries: entries.filter((e) => (e.folder ?? DEMO_FOLDER[e.kind]) === path).map((e) => ({ ...e, folder: path })) };
        try {
          const got = await loadFolderItems(path);
          remember(got);
          return { entries: itemsToEntries(got, new Date(), art) };
        } catch (e) {
          return { error: msgOf(e) };
        }
      },
      loadLinks: async (id) => {
        const item = byId.get(id);
        if (!item) return { out: [], back: [] };
        const local = [...byId.values()];
        if (demo) return linksOf(item, local);
        try {
          const got = await loadLinkedItems(item.title, [...new Set(wikiTitles(item.content ?? "").map((x) => x.split("#")[0]!.trim()))]);
          remember(got);
          const fetched = itemsToEntries(got, new Date(), art);
          const seen = new Set(fetched.map((e) => e.id));
          return linksOf(item, [...fetched, ...local.filter((e) => !seen.has(e.id))]);
        } catch (e) {
          return { error: msgOf(e) };
        }
      },
      lifePage: async (key) => {
        if (demo) return { error: t("Life pages need your Kortex account") };
        try {
          const found = findLifePage(await loadLifePages(), key);
          if (found) {
            remember([found]);
            return { id: found.id };
          }
          const area = areas.find((a) => a.key === key);
          const made = await createNote(area?.name ?? key, lifePageTemplate(area?.vision ?? "", getLocale()), LIFE_PAGE_FOLDER, [lifeTag(key)]);
          await refreshItems();
          return { id: made.id };
        } catch (e) {
          return { error: msgOf(e) };
        }
      },
      findWiki: async (target) => {
        const hit = resolveWiki([...byId.values()], target);
        if (hit || demo) return hit?.id ?? null;
        try {
          const row = await findItemByTitle(target.split("#")[0]!);
          if (!row) return null;
          remember([row]);
          return row.id;
        } catch {
          return null;
        }
      },
    };
  }, [auth, email, name, server, rows, areas, jump, home, loading, error, refresh, refreshItems, tasks, demoHidden, demoFav, demoArchived, demoPinned, demoRead, demoRemind, demoFiled, placeThreshold, archivedRows, extraRows, remember, patchRow, locale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const d = useContext(Ctx);
  if (!d) throw new Error("useData must be used inside <DataProvider>");
  return d;
}
