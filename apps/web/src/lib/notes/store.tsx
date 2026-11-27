"use client";

import { t, tx } from "@/i18n";
import { todayIso } from "@/lib/date/today";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { DomainObjectType } from "@kortex/db/domain";
import {
  initialKnowledgeItems,
  isLiveData,
  subscribeSnapshot,
  workspaceSnapshot,
  type ItemType,
  type KnowledgeItem,
  type NoteType,
} from "@/lib/workspace-data";
import { useTracked, useTrackedStore, type TrackedStore } from "@/lib/tracked-store";
import { mergeSnapshotItems } from "./merge";
import { clearDraft, saveDrafts, takeRestorableDrafts } from "./drafts";
import { createContentSaver } from "./save-queue";
import { useShell } from "@/lib/shell/store";
import {
  addTag as addTagAction,
  createNote,
  loadItemBody,
  moveItem,
  patchWatch as patchWatchAction,
  removeTag as removeTagAction,
  setReminder as setReminderAction,
  setActionItemDone,
  setItemLook,
  setMetadataField,
  turnIntoObject,
  updateNote,
  type ActionResult,
} from "@/lib/api/actions";
import { checklistChanges, setChecklistDone } from "@/lib/api/checklist";
import { applyReplacements, type ReplacementSpec } from "@/lib/text/replace";
import { applyWatchPatch, type WatchPatch } from "@/lib/radar";
import { convertMetadata, folderSuggestionFor, isDomainObjectType, validateMetadata } from "@/lib/objects/schema";
import { parseTypedValue, typedFieldsOf } from "@/lib/typed/fields";

/*
 * Knowledge-item store with optimistic updates. Every change applies locally first; in live mode
 * (KORTEX_DATA_SOURCE=supabase) it is then persisted through the server actions in
 * lib/api/actions.ts and rolled back when the server refuses it. Body edits are debounced and never
 * rolled back (that would eat typing). Review N5 #3: body saves go through a per-note queue
 * (./save-queue.ts: last version wins, never out of order), are flushed when the store unmounts and
 * when the page is hidden or closed, and a failed save shows a toast with "Erneut versuchen". What is
 * still unsaved when the page goes away is kept as a local draft (./drafts.ts) and restored on the
 * next load if the server copy has not changed since.
 */

const CONTENT_SAVE_DELAY_MS = 800;

export type ObjectTarget = DomainObjectType | "note";

interface NotesState {
  items: Record<string, KnowledgeItem>;
  get: (id: string) => KnowledgeItem | undefined;
  /**
   * Loads the body of an item the snapshot sent without it (`bodyPending`); no-op otherwise. Also used to prefetch on
   * hover. Concurrent calls share one request.
   */
  loadBody: (id: string) => Promise<void>;
  setContent: (id: string, md: string) => void;
  toggleAction: (id: string, actionId: string) => void;
  /** Turn into Object: new type, metadata reduced to the target field set, folder suggestion. */
  convert: (id: string, to: ObjectTarget) => void;
  /** Sets one metadata field; returns an error message when the value is invalid (nothing saved). */
  setField: (id: string, key: string, value: unknown) => string | null;
  /** Merges metadata the server already saved (e.g. the Copilot status action) into the local item. */
  applyMetadata: (id: string, patch: Record<string, unknown>) => void;
  /**
   * Shows an edit the copilot already saved (note_edit). With unsaved typing in that note the same
   * replacements are replayed on the local text and saved, so neither side is lost. Returns the
   * local body and title before the edit (for "Rückgängig"), or null when the note is not loaded.
   */
  applyServerEdit: (id: string, edit: ServerEdit) => { contentMd: string; title: string } | null;
  acceptFolder: (id: string) => void;
  dismissFolder: (id: string) => void;
  createSubpage: (parentId: string, title: string) => KnowledgeItem;
  /**
   * New note from the editor (/notes/new): optimistic, then persisted in live mode. Body and title saves of the new
   * id wait until the row exists. Resolves false when the server refused it (the local item is dropped again).
   */
  createNote: (input: NewNoteInput) => { item: KnowledgeItem; ready: Promise<boolean> };
  /** Renames an item (debounced save in live mode; the vault file name follows on the server). */
  setTitle: (id: string, title: string) => void;
  addTag: (id: string, tag: string) => void;
  removeTag: (id: string, tag: string) => void;
  /** W4: cover URL and / or page icon (Lucide name); undefined keeps a field, null clears it. */
  setLook: (id: string, patch: { cover?: string | null; icon?: string | null }) => void;
  /** W4: moves an item into a folder by hand (manual placement, the organizer keeps it there). */
  moveTo: (id: string, folder: string) => void;
  /** S11: snooze / set a reminder (ISO instant); null clears it. Optimistic, rolled back on failure. */
  setReminder: (id: string, remindAt: string | null) => void;
  /** S11: delta radar of a URL item (on/off, interval, change seen). Optimistic. */
  patchWatch: (id: string, patch: WatchPatch) => void;
}

export interface ServerEdit {
  contentMd?: string;
  title?: string;
  replacements: ReplacementSpec[];
  appendedMd?: string;
}

export interface NewNoteInput {
  title: string;
  contentMd: string;
  folder: string;
  tags?: string[];
  /** W4: cover and icon chosen before the first save. */
  cover?: string | null;
  icon?: string | null;
  /** Audit 0.6.1 W-13: create a domain object (person, project, goal, ...) instead of a note. */
  objectType?: DomainObjectType;
}

const TITLE_SAVE_DELAY_MS = 600;
/** Tags as the shell shows them: with a leading #. */
const asTag = (t: string) => (t.trim().startsWith("#") ? t.trim() : `#${t.trim()}`);

// The provider publishes into a tracked store (lib/tracked-store.ts): a consumer re-renders only when a field it read
// changes, and the actions are stable. A keystroke in one note no longer re-renders components that only use actions.
const Ctx = createContext<TrackedStore<NotesState> | null>(null);

/** Content type an object returns to when turned back into a note. */
const baseTypeOf = (item: KnowledgeItem): NoteType => (isDomainObjectType(item.type) ? "note" : (item.type as NoteType));

export function NotesProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Record<string, KnowledgeItem>>(() =>
    Object.fromEntries(initialKnowledgeItems().map((i) => [i.id, i])),
  );
  // Original content type per id, so "Note" restores a meeting as a meeting.
  const [baseTypes] = useState<Record<string, NoteType>>(() =>
    Object.fromEntries(initialKnowledgeItems().map((i) => [i.id, baseTypeOf(i)])),
  );

  // Links from the item's metadata/import; body [[links]] are added on top when content changes.
  const [baseLinks] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(initialKnowledgeItems().map((i) => [i.id, i.links])),
  );

  const { showToast } = useShell();
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  // Body saves per item: debounced, serialised, flushable (also: which items have unsaved edits).
  const saverRef = useRef<ReturnType<typeof createContentSaver> | null>(null);
  saverRef.current ??= createContentSaver({
    delayMs: CONTENT_SAVE_DELAY_MS,
    save: (id, md) => updateNote(id, { contentMd: md }).then((r) => (r.ok ? { ok: true as const } : { ok: false as const, error: r.error })),
    onSaved: (id, md) => clearDraft(id, md),
    onError: (id, error) => {
      console.warn("[kortex] content not saved:", error);
      const title = itemsRef.current[id]?.title;
      toastRef.current(t("“{title}” not saved", { title: title ?? t("Note") }), { label: t("Try again"), run: () => void saverRef.current?.flush(id) });
    },
  });
  const saver = saverRef.current;

  // Latest items for the persistence callbacks (rollback snapshots).
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Live: merge every newly installed snapshot (captures, router.refresh()) so new items open with
  // their content and server-side changes arrive; unsaved local edits win (lib/notes/merge.ts).
  const snapshot = useSyncExternalStore(subscribeSnapshot, workspaceSnapshot, workspaceSnapshot);
  useEffect(() => {
    const incoming = [...snapshot.notes, ...snapshot.objects];
    const next = mergeSnapshotItems(itemsRef.current, incoming, saver.dirtyIds());
    if (!next) return;
    for (const i of incoming) {
      baseTypes[i.id] ??= baseTypeOf(i);
      baseLinks[i.id] ??= i.links;
    }
    setItems(next);
  }, [snapshot, baseTypes, baseLinks, saver]);

  /** Runs a server action in live mode; restores `before` when it fails. */
  const persist = useCallback((before: KnowledgeItem | undefined, call: () => Promise<ActionResult<unknown>>) => {
    if (!isLiveData()) return;
    void call()
      .catch((err: unknown): ActionResult<unknown> => ({ ok: false, error: String(err) }))
      .then((r) => {
        if (r.ok || !before) return;
        console.warn("[kortex] change not saved:", r.error);
        setItems((all) => ({ ...all, [before.id]: before }));
      });
  }, []);

  // Debounced, serialised body saves per item.
  // Notes created here but not yet stored on the server: saves of their id wait for the insert.
  const creating = useRef(new Map<string, Promise<boolean>>());
  const saveContent = useCallback(
    (id: string, md: string) => {
      if (!isLiveData()) return;
      const pending = creating.current.get(id);
      if (pending) void pending.then((ok) => ok && saver.schedule(id, itemsRef.current[id]?.contentMd ?? md));
      else saver.schedule(id, md);
    },
    [saver],
  );
  const titleTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saveTitle = useCallback((id: string, title: string) => {
    if (!isLiveData()) return;
    const prev = titleTimers.current.get(id);
    if (prev) clearTimeout(prev);
    titleTimers.current.set(
      id,
      setTimeout(() => {
        titleTimers.current.delete(id);
        const go = () =>
          void updateNote(id, { title: itemsRef.current[id]?.title ?? title }).then((r) => {
            if (r.ok) return;
            console.warn("[kortex] title not saved:", r.error);
            toastRef.current(t("Title not saved"));
          });
        const pending = creating.current.get(id);
        if (pending) void pending.then((ok) => ok && go());
        else go();
      }, TITLE_SAVE_DELAY_MS),
    );
  }, []);

  // Flush pending saves when the page is hidden (tab switch, app switch, closing) or unloaded, and when
  // the store unmounts. Whatever is still unsaved then is also written as a local draft, because a
  // request started during unload may never arrive.
  useEffect(() => {
    if (!isLiveData()) return;
    const keepDrafts = () => {
      const dirty = [...saver.dirtyIds()].map((id) => [id, saver.pendingText(id) ?? itemsRef.current[id]?.contentMd] as const);
      saveDrafts(dirty.filter((e): e is [string, string] => typeof e[1] === "string"));
    };
    const onHide = () => {
      if (saver.dirtyIds().size === 0) return;
      keepDrafts();
      void saver.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      onHide();
    };
  }, [saver]);

  const update = useCallback((id: string, fn: (i: KnowledgeItem) => KnowledgeItem) => {
    setItems((all) => {
      const cur = all[id];
      if (!cur) return all;
      const next = fn(cur);
      return next === cur ? all : { ...all, [id]: next };
    });
  }, []);

  // Restore drafts left by a page that closed before its last save arrived (live mode, once).
  useEffect(() => {
    if (!isLiveData()) return;
    const restore = takeRestorableDrafts(itemsRef.current);
    if (!restore.length) return;
    for (const { id, md } of restore) {
      setItems((all) => (all[id] ? { ...all, [id]: { ...all[id], contentMd: md, bodyPending: undefined } } : all));
      saver.schedule(id, md);
    }
    const first = itemsRef.current[restore[0]!.id]?.title ?? t("Note");
    toastRef.current(restore.length === 1 ? t("Unsaved change to “{title}” restored", { title: first }) : t("{n} unsaved changes restored", { n: restore.length }));
  }, [saver]);

  // Bodies on their way (bodyPending items): one request per id at a time.
  const bodyLoads = useRef(new Map<string, Promise<void>>());
  const loadBody = useCallback(
    (id: string): Promise<void> => {
      if (!itemsRef.current[id]?.bodyPending) return Promise.resolve();
      const running = bodyLoads.current.get(id);
      if (running) return running;
      const p = loadItemBody(id)
        .catch((err: unknown) => ({ ok: false as const, error: String(err) }))
        .then((r) => {
          bodyLoads.current.delete(id);
          if (!r.ok) {
            console.warn("[kortex] body not loaded:", r.error);
            const title = itemsRef.current[id]?.title ?? t("Note");
            toastRef.current(t("“{title}” not loaded: {error}", { title, error: r.error }), { label: t("Try again"), run: () => void loadBodyRef.current(id) });
            return;
          }
          // Only fills a still-pending item: whatever arrived meanwhile (a newer snapshot copy) wins.
          update(id, (i) => (i.bodyPending ? { ...i, contentMd: r.data.contentMd, bodyPending: undefined, updatedAt: i.updatedAt ?? r.data.updatedAt } : i));
        });
      bodyLoads.current.set(id, p);
      return p;
    },
    [update],
  );
  const loadBodyRef = useRef(loadBody);
  loadBodyRef.current = loadBody;

  const state = useMemo<NotesState>(
    () => ({
      items,
      get: (id) => items[id],
      loadBody,
      setContent: (id, md) => {
        // Never save over a body that has not been loaded yet (it is "" locally, not on the server).
        if (items[id]?.bodyPending) return;
        if (items[id] && items[id].contentMd !== md) saveContent(id, md);
        update(id, (i) => {
          if (i.contentMd === md) return i;
          // [[Title]] / [[Title|alias]] / ![[Title]] in the body become links, so backlinks stay live.
          const titles = [...md.matchAll(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]!.trim());
          const linked = Object.values(items)
            .filter((o) => o.id !== id && titles.includes(o.title))
            .map((o) => o.id);
          const links = [...new Set([...(baseLinks[id] ?? []), ...linked])];
          // A ticked `- [x] Text` line closes the matching action item (the server does the same).
          const changes = new Map(checklistChanges(md, i.actionItems).map((c) => [c.id, c.done]));
          const actionItems = changes.size ? i.actionItems.map((a) => (changes.has(a.id) ? { ...a, done: changes.get(a.id)! } : a)) : i.actionItems;
          return { ...i, contentMd: md, links, actionItems };
        });
      },
      toggleAction: (id, actionId) => {
        const before = items[id];
        const action = before?.actionItems.find((a) => a.id === actionId);
        // The matching checklist line in the body flips with the task (server mirrors it).
        update(id, (i) => ({
          ...i,
          actionItems: i.actionItems.map((a) => (a.id === actionId ? { ...a, done: !a.done } : a)),
          contentMd: action && !i.bodyPending ? setChecklistDone(i.contentMd, action.text, !action.done) : i.contentMd,
        }));
        if (action) persist(before, () => setActionItemDone(actionId, !action.done));
      },
      convert: (id, to) => {
        const before = items[id];
        const type: ItemType = to === "note" ? (baseTypes[id] ?? "note") : to;
        if (!before || type === before.type) return;
        const metadata = convertMetadata(to, before.metadata);
        update(id, (i) => ({ ...i, type, metadata, folderSuggestion: folderSuggestionFor(to, i.path) }));
        persist(before, () => turnIntoObject(id, type, metadata));
      },
      setField: (id, key, value) => {
        const item = items[id];
        if (!item) return t("Not an object");
        const objectType = item.type;
        if (!isDomainObjectType(objectType)) {
          // Typed item (movie, book, ...): the field set and its parsing come from the type registry.
          const field = typedFieldsOf(item.dbType).find((f) => f.key === key);
          if (!field) return t("Unknown field");
          const parsed = parseTypedValue(field, value);
          if (!parsed.ok) return parsed.error;
          update(id, (i) => {
            const metadata = { ...i.metadata };
            if (parsed.value === undefined) delete metadata[key];
            else metadata[key] = parsed.value;
            return { ...i, metadata };
          });
          persist(item, () => setMetadataField(id, key, parsed.value));
          return null;
        }
        // Validate the one field on its own and merge inside the updater, so several fields saved
        // in one go don't overwrite each other.
        const r = validateMetadata(objectType, { [key]: value });
        if (r.errors[key]) return r.errors[key];
        if (r.dropped.length) return t("Unknown field");
        update(id, (i) => {
          const metadata = { ...i.metadata };
          if (key in r.metadata) metadata[key] = r.metadata[key];
          else delete metadata[key];
          return { ...i, metadata };
        });
        persist(item, () => setMetadataField(id, key, key in r.metadata ? r.metadata[key] : undefined));
        return null;
      },
      applyMetadata: (id, patch) => update(id, (i) => ({ ...i, metadata: { ...i.metadata, ...patch } })),
      applyServerEdit: (id, edit) => {
        const cur = items[id];
        if (!cur) return null;
        if (cur.bodyPending) {
          // The local body is not loaded: take the server's new text as the body, offer no local undo (it would
          // restore the empty placeholder).
          const md = edit.contentMd;
          const title = edit.title;
          update(id, (i) => ({ ...i, ...(md !== undefined ? { contentMd: md, bodyPending: undefined } : {}), ...(title ? { title } : {}) }));
          return null;
        }
        const before = { contentMd: cur.contentMd, title: cur.title };
        if (edit.contentMd !== undefined) {
          if (saver.dirtyIds().has(id)) {
            // Unsaved typing: replay the edit on the local text; the queued save then carries both.
            const local = saver.pendingText(id) ?? cur.contentMd;
            let md = applyReplacements(local, edit.replacements).content;
            if (edit.appendedMd) md = `${md.replace(/\s+$/, "")}\n\n${edit.appendedMd}\n`;
            saver.schedule(id, md);
            update(id, (i) => ({ ...i, contentMd: md }));
          } else {
            const md = edit.contentMd;
            update(id, (i) => ({ ...i, contentMd: md }));
          }
        }
        if (edit.title) {
          const title = edit.title;
          update(id, (i) => ({ ...i, title }));
        }
        return before;
      },
      acceptFolder: (id) => {
        const before = items[id];
        const target = before?.folderSuggestion;
        update(id, (i) => {
          if (!i.folderSuggestion) return i;
          const file = i.path.split("/").pop() ?? `${i.title}.md`;
          return { ...i, path: `${i.folderSuggestion}/${file}`, folderSuggestion: null, manualPlacement: false };
        });
        // The suggested type folder is the system place for the object, not a manual placement.
        if (target) persist(before, () => moveItem(id, target, { manual: false }));
      },
      dismissFolder: (id) => update(id, (i) => ({ ...i, folderSuggestion: null })),
      createSubpage: (parentId, title) => {
        const parent = items[parentId];
        const folder = parent ? parent.path.split("/").slice(0, -1).join("/") : "00_Inbox";
        const id = isLiveData() ? crypto.randomUUID() : `p${Date.now().toString(36)}`;
        const slug = title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
        const page: KnowledgeItem = {
          id,
          type: "note",
          title,
          path: `${folder}/${slug || t("Subpage")}.md`,
          date: todayIso(),
          time: new Date().toTimeString().slice(0, 5),
          tags: [],
          tldr: "",
          links: [parentId],
          contentMd: "",
          cover: null,
          actionItems: [],
          metadata: {},
          manualPlacement: false,
          folderSuggestion: null,
        };
        setItems((all) => ({ ...all, [id]: page }));
        if (isLiveData())
          void createNote({ id, title, folderPath: folder, parentItemId: parentId }).then((r) => {
            if (r.ok) update(id, (i) => ({ ...i, path: r.data.path }));
            else {
              console.warn("[kortex] subpage not saved:", r.error);
              setItems((all) => {
                const rest = { ...all };
                delete rest[id];
                return rest;
              });
            }
          });
        return page;
      },
      createNote: ({ title, contentMd, folder, tags = [], cover = null, icon = null, objectType }) => {
        const id = isLiveData() ? crypto.randomUUID() : `n${Date.now().toString(36)}`;
        const slug = title.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || tx("file", "Untitled");
        const item: KnowledgeItem = {
          id,
          type: objectType ?? "note",
          title: title.trim(),
          path: `${folder}/${slug}.md`,
          date: todayIso(),
          time: new Date().toTimeString().slice(0, 5),
          tags: tags.map(asTag),
          tldr: "",
          links: [],
          contentMd,
          cover,
          icon,
          actionItems: [],
          metadata: {},
          manualPlacement: false,
          folderSuggestion: null,
          ...(isLiveData() ? { status: "processed" as const } : {}),
        };
        baseTypes[id] = "note";
        baseLinks[id] = [];
        setItems((all) => ({ ...all, [id]: item }));
        if (!isLiveData()) return { item, ready: Promise.resolve(true) };
        const ready = createNote({ id, title: item.title, contentMd, folderPath: folder, tags: item.tags, coverUrl: cover, icon })
          .then(async (r) => {
            if (!r.ok || !objectType) return r;
            const turned = await turnIntoObject(id, objectType, {});
            return turned.ok ? r : { ok: false as const, error: turned.error };
          })
          .catch((err: unknown) => ({ ok: false as const, error: String(err) }))
          .then((r) => {
            creating.current.delete(id);
            if (r.ok) {
              update(id, (i) => ({ ...i, path: r.data.path }));
              return true;
            }
            console.warn("[kortex] note not saved:", r.error);
            toastRef.current(t("Note not saved"));
            setItems((all) => {
              const rest = { ...all };
              delete rest[id];
              return rest;
            });
            return false;
          });
        creating.current.set(id, ready);
        return { item, ready };
      },
      setTitle: (id, title) => {
        if (!items[id] || items[id].title === title) return;
        update(id, (i) => ({ ...i, title }));
        saveTitle(id, title);
      },
      addTag: (id, tag) => {
        const before = items[id];
        const label = asTag(tag);
        if (!before || label === "#" || before.tags.some((t) => t.toLowerCase() === label.toLowerCase())) return;
        update(id, (i) => ({ ...i, tags: [...i.tags, label] }));
        const call = () => addTagAction(id, label);
        const pending = creating.current.get(id);
        if (pending) void pending.then((ok) => ok && persist(before, call));
        else persist(before, call);
      },
      removeTag: (id, tag) => {
        const before = items[id];
        if (!before) return;
        update(id, (i) => ({ ...i, tags: i.tags.filter((t) => t !== tag) }));
        persist(before, () => removeTagAction(id, tag));
      },
      moveTo: (id, folder) => {
        const before = items[id];
        const dir = folder.trim().replace(/^\/+|\/+$/g, "");
        if (!before || !dir || before.path.split("/").slice(0, -1).join("/") === dir) return;
        const file = before.path.split("/").pop() ?? `${before.title}.md`;
        update(id, (i) => ({ ...i, path: `${dir}/${file}`, manualPlacement: true, folderSuggestion: null }));
        const call = () => moveItem(id, dir, { manual: true });
        const pending = creating.current.get(id);
        if (pending) void pending.then((ok) => ok && persist(before, call));
        else persist(before, call);
      },
      setLook: (id, patch) => {
        const before = items[id];
        if (!before) return;
        update(id, (i) => ({
          ...i,
          ...(patch.cover !== undefined ? { cover: patch.cover } : {}),
          ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
        }));
        const call = () => setItemLook(id, { coverUrl: patch.cover, icon: patch.icon });
        const pending = creating.current.get(id);
        if (pending) void pending.then((ok) => ok && persist(before, call));
        else persist(before, call);
      },
      setReminder: (id, remindAt) => {
        const before = items[id];
        if (!before) return;
        update(id, (i) => ({ ...i, remindAt }));
        persist(before, () => setReminderAction(id, remindAt));
      },
      patchWatch: (id, patch) => {
        const before = items[id];
        if (!before) return;
        update(id, (i) => ({ ...i, watch: applyWatchPatch(i.watch ?? null, patch, new Date()) }));
        persist(before, () => patchWatchAction(id, patch));
      },
    }),
    [items, update, loadBody, baseTypes, baseLinks, persist, saveContent, saveTitle, saver],
  );

  const store = useTrackedStore(state, { get: "items" });
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useNotes(): NotesState {
  const store = useContext(Ctx);
  if (!store) throw new Error("useNotes must be used inside <NotesProvider>");
  return useTracked(store);
}

export function useNote(id: string | null | undefined): KnowledgeItem | undefined {
  const { items } = useNotes();
  return id ? items[id] : undefined;
}
