"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionId } from "@kortex/ui";
import { deleteItems, moveItems, setArchived, setFavorite, tagItems } from "@/lib/api/actions";
import { announceFavorites } from "@/lib/shell/favorites";
import { noteHrefById } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { VAULT_TREE, isLiveData } from "@/lib/workspace-data";
import type { ViewEntry } from "./entries";
import { t, tn, tx } from "@/i18n";

/*
 * What the context menu and the selection bar do to entries (feedback round 2, #3/#4). Changes show at once
 * (optimistic overrides on top of the server-rendered list) and go through the server actions (RLS); a failure
 * rolls the row back with a toast. Archive and delete come with an undo toast; a delete only reaches the
 * server when the undo window has passed.
 */

export const UNDO_MS = 6000;

const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");
const tagKey = (label: string) => label.replace(/^#/, "").toLowerCase();

interface Overrides {
  hidden: ReadonlySet<string>;
  favorite: ReadonlyMap<string, boolean>;
  /** Tags added (true) or removed (false) per item. */
  tags: ReadonlyMap<string, ReadonlyMap<string, boolean>>;
}

const NONE: Overrides = { hidden: new Set(), favorite: new Map(), tags: new Map() };

export function useItemActions(entries: readonly ViewEntry[], opts: { refresh?: () => void } = {}) {
  const { openNote, setSplit, showToast } = useShell();
  const live = isLiveData();
  const [ov, setOv] = useState<Overrides>(NONE);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const pendingDelete = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const refresh = opts.refresh;

  const visible = useMemo(() => entries.filter((e) => !ov.hidden.has(e.id)), [entries, ov.hidden]);

  const tagsOf = useCallback(
    (id: string): string[] => {
      const base = (byId.get(id)?.tags ?? []).map((t) => t.label);
      const changes = ov.tags.get(id);
      if (!changes) return base;
      const next = base.filter((t) => changes.get(tagKey(t)) !== false);
      for (const [k, on] of changes) if (on && !next.some((t) => tagKey(t) === k)) next.push(`#${k}`);
      return next;
    },
    [byId, ov.tags],
  );

  // The optimistic choice wins over the loaded state (knowledge_items.is_favorite, G4).
  const favoriteOf = useCallback((id: string) => ov.favorite.get(id) ?? byId.get(id)?.favorite === true, [ov.favorite, byId]);

  const knownTags = useMemo(() => [...new Set(entries.flatMap((e) => e.tags.map((t) => t.label)))].sort(), [entries]);
  const folders = useMemo(() => [...new Set([...VAULT_TREE.map((f) => f.path), ...entries.map((e) => dirOf(e.path))].filter(Boolean))].sort(), [entries]);

  const patch = useCallback((fn: (o: Overrides) => Overrides) => setOv(fn), []);
  const hide = useCallback((ids: readonly string[], on: boolean) => patch((o) => {
    const hidden = new Set(o.hidden);
    for (const id of ids) {
      if (on) hidden.add(id);
      else hidden.delete(id);
    }
    return { ...o, hidden };
  }), [patch]);

  const fail = useCallback((what: string, error: string) => showToast(t("{what} not saved: {error}", { what, error })), [showToast]);

  /** Runs the server part (live) and reports failures; resolves true on success (always in the demo). */
  const server = useCallback(
    async <T,>(what: string, call: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<boolean> => {
      if (!live) return true;
      const r = await call();
      if (!r.ok) fail(what, r.error);
      return r.ok;
    },
    [live, fail],
  );

  const flushDelete = useCallback((ids: string[]) => {
    for (const id of ids) {
      const timer = pendingDelete.current.get(id);
      if (timer) clearTimeout(timer);
      pendingDelete.current.delete(id);
    }
    if (!live) return;
    // Audit 0.6.1 W-10: a delete the server refused brings the rows back and says so (no silent "gone until reload").
    void deleteItems(ids).then(
      (r) => {
        if (r.ok) return;
        hide(ids, false);
        fail(t("Delete"), r.error);
      },
      (e: unknown) => {
        hide(ids, false);
        fail(t("Delete"), e instanceof Error ? e.message : String(e));
      },
    );
  }, [live, hide, fail]);

  // Leaving the page must not lose a delete that was already confirmed by waiting.
  useEffect(() => {
    const pending = pendingDelete.current;
    const flush = () => {
      const ids = [...pending.keys()];
      if (ids.length) flushDelete(ids);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flushDelete]);

  const run = useCallback(
    async (action: ActionId, ids: readonly string[], arg?: string): Promise<void> => {
      const list = [...ids];
      const first = list[0] ? byId.get(list[0]) : undefined;
      if (!list.length) return;
      const n = list.length;

      switch (action) {
        case "open":
        case "accept":
          if (first) openNote(first.openId);
          return;
        case "open-split":
          if (first) {
            openNote(first.openId);
            setSplit(true);
          }
          return;
        case "copy-link": {
          if (!first) return;
          const url = `${window.location.origin}${noteHrefById(first.openId)}`;
          try {
            await navigator.clipboard.writeText(url);
            showToast(t("Link copied"));
          } catch {
            showToast(t("Link could not be copied"));
          }
          return;
        }
        case "favorite":
        case "unfavorite": {
          const on = action === "favorite";
          const before = ov.favorite;
          patch((o) => ({ ...o, favorite: new Map([...o.favorite, ...list.map((id) => [id, on] as const)]) }));
          showToast(on ? tn(n, "Entry marked as favorite", "{n} entries marked as favorite") : t("Favorite removed"));
          if (!(await server(t("Favorite"), () => setFavorite(list, on)))) patch((o) => ({ ...o, favorite: before }));
          // G4: the Favoriten view and the sidebar follow the server state.
          else {
            refresh?.();
            announceFavorites();
          }
          return;
        }
        case "archive":
        case "unarchive": {
          // Either way the entry leaves the current list: archiving leaves the normal views, bringing back leaves
          // the Archiv view (G4). Undo puts it back and reverts the status.
          const on = action === "archive";
          hide(list, true);
          const ok = await server(on ? tx("verb", "Archive") : t("Restore"), () => setArchived(list, on));
          if (!ok) {
            hide(list, false);
            return;
          }
          showToast(on ? tn(n, "Entry archived", "{n} entries archived") : tn(n, "Entry restored", "{n} entries restored"), {
            label: t("Undo"),
            run: () => {
              hide(list, false);
              void server(t("Undo"), () => setArchived(list, !on)).then(() => refresh?.());
            },
          });
          refresh?.();
          return;
        }
        case "delete": {
          hide(list, true);
          const timers = pendingDelete.current;
          const timer = setTimeout(() => flushDelete(list), UNDO_MS + 400);
          for (const id of list) timers.set(id, timer);
          showToast(tn(n, "Entry deleted", "{n} entries deleted"), {
            label: t("Undo"),
            run: () => {
              clearTimeout(timer);
              for (const id of list) timers.delete(id);
              hide(list, false);
            },
          });
          return;
        }
        case "move": {
          if (!arg) return;
          const from = new Map(list.map((id) => [id, dirOf(byId.get(id)?.path ?? "")] as const));
          if (!(await server(t("Move"), () => moveItems(list, arg)))) return;
          showToast(tn(n, "Entry moved to {folder}", "{n} entries moved to {folder}", { folder: arg }), live ? {
            label: t("Undo"),
            run: () => {
              const groups = new Map<string, string[]>();
              for (const [id, dir] of from) if (dir) groups.set(dir, [...(groups.get(dir) ?? []), id]);
              void Promise.all([...groups].map(([dir, group]) => moveItems(group, dir))).then(() => refresh?.());
            },
          } : undefined);
          refresh?.();
          return;
        }
        case "tags": {
          if (!arg) return;
          const key = tagKey(arg);
          const on = !list.every((id) => tagsOf(id).some((x) => tagKey(x) === key));
          const before = ov.tags;
          patch((o) => {
            const tags = new Map(o.tags);
            for (const id of list) tags.set(id, new Map([...(tags.get(id) ?? []), [key, on]]));
            return { ...o, tags };
          });
          showToast(on ? t("#{tag} added", { tag: key }) : t("#{tag} removed", { tag: key }));
          if (!(await server(t("Tag"), () => tagItems(list, arg, on)))) patch((o) => ({ ...o, tags: before }));
          else refresh?.();
          return;
        }
        default:
          return;
      }
    },
    [byId, flushDelete, hide, live, openNote, ov.favorite, ov.tags, patch, refresh, server, setSplit, showToast, tagsOf],
  );

  return { visible, run, tagsOf, favoriteOf, knownTags, folders, live };
}
