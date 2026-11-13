"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_PACK, coverTopicForType, parsePack, resolveCover, tileSources, type ModeId, type PackId, type ResolvedCover } from "@kortex/theme-packs";
import { useSettings } from "@/lib/settings/store";
import { useShell } from "@/lib/shell/store";

/*
 * Theme pack state: which pack is active (user_settings.theme_pack), the light/dark mode of the shell and
 * the base URL of the pack files (apps/web/public/theme-packs, copied from packages/theme-packs/media).
 *
 * The accent colour stays in the shell prefs (the pre-paint script reads it from there); this provider keeps
 * it in step with user_settings.accent:
 *  - live: the server value wins once, when the row has loaded; afterwards a change in the UI is written back.
 *  - mock: the device value is the source of truth and is mirrored into the settings row.
 * The pack is cached in localStorage so the first paint of a live session does not flash the default pack.
 */

export const PACK_BASE = "/theme-packs";
const CACHE_KEY = "kortex.themepack";
/** Transparent 1x1 GIF: stands in for a pack image until the stored pack is known. */
const BLANK_IMG = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

interface ThemePackState {
  pack: PackId;
  /** False until the stored choice is known (first paint): pack images are not rendered before, so no wrong pack flashes. */
  ready: boolean;
  mode: ModeId;
  base: string;
  setPack: (p: PackId) => void;
  /** Accent chosen in the UI: applied at once and saved with the user settings. */
  setAccent: (a: string) => void;
}

const Ctx = createContext<ThemePackState | null>(null);

function readCache(): PackId | null {
  try {
    const v = window.localStorage.getItem(CACHE_KEY);
    return v ? parsePack(v) : null;
  } catch {
    return null;
  }
}

export function ThemePackProvider({ children }: { children: ReactNode }) {
  const { user, loading, live, updateUserSettings } = useSettings();
  const { prefs, setAccent } = useShell();
  const [cached, setCached] = useState<PackId | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCached(readCache());
    // One tick later: the settings store hydrates in its own effect right after this one.
    const t = setTimeout(() => setHydrated(true), 0);
    return () => clearTimeout(t);
  }, []);

  // Before the live row has loaded the cached pack is shown; afterwards the row decides.
  const pack = loading && cached ? cached : parsePack(user.theme_pack);
  const ready = hydrated && (!loading || cached !== null);

  useEffect(() => {
    if (loading) return;
    try {
      window.localStorage.setItem(CACHE_KEY, pack);
    } catch {
      /* private mode: no cache */
    }
  }, [pack, loading]);

  const setPack = useCallback(
    (p: PackId) => {
      updateUserSettings({ theme_pack: p });
    },
    [updateUserSettings],
  );

  // --- accent <-> user_settings.accent ---------------------------------------------------------
  // The accent stays in the shell prefs (the pre-paint script reads it from there). Changes made in the UI go through
  // setAccent below, which also saves them; hydration of the prefs is not a choice.
  const adopted = useRef(false);
  const chosen = useRef(false);

  const setAccentChoice = useCallback(
    (a: string) => {
      chosen.current = true;
      setAccent(a);
      updateUserSettings({ accent: a });
    },
    [setAccent, updateUserSettings],
  );

  // Live, once the row is there: a stored accent wins on every device; with nothing stored (NULL) this device uploads its own.
  useEffect(() => {
    if (!live || loading || adopted.current) return;
    adopted.current = true;
    if (chosen.current) return;
    if (user.accent == null) updateUserSettings({ accent: prefs.accent });
    else if (user.accent !== prefs.accent) setAccent(user.accent);
  }, [live, loading, user.accent, prefs.accent, setAccent, updateUserSettings]);

  // Mock: the row mirrors the device value.
  useEffect(() => {
    if (!live && user.accent !== prefs.accent) updateUserSettings({ accent: prefs.accent });
  }, [live, user.accent, prefs.accent, updateUserSettings]);

  const value = useMemo<ThemePackState>(
    () => ({ pack, ready, mode: prefs.theme === "light" ? "light" : "dark", base: PACK_BASE, setPack, setAccent: setAccentChoice }),
    [pack, ready, prefs.theme, setPack, setAccentChoice],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Active pack and mode. Outside the provider (login, tests) it falls back to the default pack. */
export function useThemePack(): ThemePackState {
  return useContext(Ctx) ?? { pack: DEFAULT_PACK, ready: true, mode: "dark", base: PACK_BASE, setPack: () => {}, setAccent: () => {} };
}

/**
 * Cover of an entry (own cover, then extracted medium, then the type tile of the active pack).
 * Returns a stable function so list views can call it per entry.
 */
export function useCoverOf(): (e: { cover: string | null | undefined; kind: string | null | undefined }) => ResolvedCover {
  const { pack, ready, mode, base } = useThemePack();
  return useCallback(
    (e) => {
      const r = resolveCover({ own: e.cover, type: e.kind, pack, mode, base });
      return !ready && r.source === "pack" ? { ...r, src: BLANK_IMG } : r;
    },
    [pack, ready, mode, base],
  );
}

/** Type tile of the active pack as an image URL, for an entry type without any medium. */
export function useTileOf(): (type: string | null | undefined) => string {
  const { pack, ready, mode, base } = useThemePack();
  return useCallback(
    (type) => (ready ? tileSources(pack, mode, coverTopicForType(type), base).src : BLANK_IMG),
    [pack, ready, mode, base],
  );
}
