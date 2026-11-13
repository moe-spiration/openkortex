"use client";

import { t } from "@/i18n";
import { typeIcon } from "@kortex/db";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setFavorite } from "@/lib/api/actions";
import { isAbort, readApi } from "@/lib/api/read";
import type { DataResult } from "@/lib/data/run";
import type { FavoriteRow } from "@/lib/data/favorites";
import {
  NOTES,
  RECENT_NOTE_IDS,
  isLiveData,
  noteById,
  type NoteSummary,
} from "@/lib/workspace-data";
import { FAVORITES_EVENT, insertFavorite, moveFavorite, orderFavorites } from "./favorites-core";
import { useShell } from "./store";

export { FAVORITES_EVENT };

/** Tells every open sidebar to reload its favourites (after a star changed). */
export const announceFavorites = () => {
  try {
    window.dispatchEvent(new Event(FAVORITES_EVENT));
  } catch {
    /* no window (tests) */
  }
};

/** Mock mode: a few recent notes stand in for starred ones, changes last for the session. */
function mockRows(): FavoriteRow[] {
  const starred = NOTES.filter((n) => (n as { favorite?: boolean }).favorite === true);
  const src = starred.length
    ? starred
    : RECENT_NOTE_IDS.slice(0, 3)
        .map((id) => noteById(id))
        .filter((n): n is NoteSummary => !!n);
  return src.map((n) => ({
    id: n.id,
    title: n.title,
    type: n.dbType ?? n.type,
    icon: typeIcon(n.dbType ?? n.type),
  }));
}

/**
 * Sidebar favourites (variant A2): the starred items in the user's own order. `move` reorders (drag and drop,
 * Alt+arrow), `unpin` removes the star, `pin` stars an item dropped onto the section. Optimistic: the list changes
 * at once, a failed write puts it back and shows a toast.
 */
export function useFavorites() {
  const live = isLiveData();
  const { prefs, setFavOrder, showToast } = useShell();
  const [rows, setRows] = useState<FavoriteRow[] | null>(() => (live ? null : mockRows()));
  const ac = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    if (!live) return;
    ac.current?.abort();
    const c = new AbortController();
    ac.current = c;
    void readApi<DataResult<FavoriteRow[]>>("favorites", undefined, c.signal)
      .then((r) => r.ok && setRows(r.data))
      .catch((err: unknown) => {
        if (!isAbort(err)) console.warn("[kortex] favorites not loaded:", err);
      });
  }, [live]);

  useEffect(() => {
    load();
    window.addEventListener(FAVORITES_EVENT, load);
    window.addEventListener("focus", load);
    return () => {
      ac.current?.abort();
      window.removeEventListener(FAVORITES_EVENT, load);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const list = useMemo(() => orderFavorites(rows ?? [], prefs.favOrder), [rows, prefs.favOrder]);
  const ids = useMemo(() => list.map((r) => r.id), [list]);

  const move = useCallback(
    (id: string, to: number) => setFavOrder(moveFavorite(ids, id, to)),
    [ids, setFavOrder],
  );

  const unpin = useCallback(
    async (id: string) => {
      const before = rows;
      setRows((r) => (r ?? []).filter((x) => x.id !== id));
      if (!live) return;
      const res = await setFavorite([id], false);
      if (!res.ok) {
        setRows(before);
        showToast(t("Favorite not removed: {error}", { error: res.error }));
      } else announceFavorites();
    },
    [live, rows, showToast],
  );

  const pin = useCallback(
    async (id: string, at?: number) => {
      setFavOrder(insertFavorite(ids, id, at));
      if (rows?.some((r) => r.id === id)) return;
      if (!live) {
        const n = noteById(id);
        if (n)
          setRows((r) => [
            ...(r ?? []),
            { id, title: n.title, type: n.dbType ?? n.type, icon: typeIcon(n.dbType ?? n.type) },
          ]);
        return;
      }
      const res = await setFavorite([id], true);
      if (!res.ok) showToast(t("Favorite not saved: {error}", { error: res.error }));
      else announceFavorites();
    },
    [ids, live, rows, setFavOrder, showToast],
  );

  return { list, loading: rows === null, move, unpin, pin };
}
