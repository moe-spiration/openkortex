import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_PACK, parsePack, type ModeId, type PackId } from "@kortex/theme-packs";
import { loadThemeSettings, saveThemeSettings } from "../api/themeSettings";
import { useData } from "../state/Data";
import { useApp } from "../state/AppState";
import { useTheme } from "./ThemeProvider";
import { isAccentValue } from "./tokens";

/*
 * Theme pack of the app (spec 9): the chosen pack, kept on the device (AsyncStorage) and, when signed in, in
 * kortex.user_settings (theme_pack, accent) so it follows the user between devices. The accent colour is handled
 * here too: AppState holds it in memory, this provider persists it and syncs it. Server value wins once per sign-in.
 */

const PACK_KEY = "kortex.themepack";
const ACCENT_KEY = "kortex.accent";

interface PackState {
  pack: PackId;
  /** False until the stored choice is read; pack images are not drawn before (no wrong pack flashes). */
  ready: boolean;
  mode: ModeId;
  setPack: (p: PackId) => void;
}

const Ctx = createContext<PackState>({ pack: DEFAULT_PACK, ready: true, mode: "dark", setPack: () => {} });

export function PackProvider({ children }: { children: ReactNode }) {
  const th = useTheme();
  const app = useApp();
  const { auth } = useData();
  const [pack, setPackState] = useState<PackId>(DEFAULT_PACK);
  const [ready, setReady] = useState(false);
  const live = auth === "live";

  // Device values first.
  const setAccent = app.setAccent;
  const lastAccent = useRef(app.accent);
  useEffect(() => {
    let alive = true;
    void Promise.all([AsyncStorage.getItem(PACK_KEY), AsyncStorage.getItem(ACCENT_KEY)])
      .then(([p, a]) => {
        if (!alive) return;
        if (p) setPackState(parsePack(p));
        if (isAccentValue(a)) {
          lastAccent.current = a;
          setAccent(a);
        }
      })
      .catch(() => undefined)
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [setAccent]);

  // Signed in: the server row wins once.
  const synced = useRef(false);
  useEffect(() => {
    if (!live) {
      synced.current = false;
      return;
    }
    if (!ready || synced.current) return;
    synced.current = true;
    void loadThemeSettings().then((s) => {
      if (!s) return;
      setPackState(s.pack);
      void AsyncStorage.setItem(PACK_KEY, s.pack).catch(() => undefined);
      if (s.accent === null) {
        // Nothing stored yet: the accent of this device becomes the stored one.
        void saveThemeSettings({ accent: lastAccent.current });
      } else if (isAccentValue(s.accent)) {
        lastAccent.current = s.accent;
        setAccent(s.accent);
        void AsyncStorage.setItem(ACCENT_KEY, s.accent).catch(() => undefined);
      }
    });
  }, [live, ready, setAccent]);

  // Accent changed in the UI: remember it and, when signed in, save it.
  useEffect(() => {
    if (!ready || app.accent === lastAccent.current) return;
    lastAccent.current = app.accent;
    void AsyncStorage.setItem(ACCENT_KEY, app.accent).catch(() => undefined);
    if (live) void saveThemeSettings({ accent: app.accent });
  }, [app.accent, ready, live]);

  const setPack = useCallback(
    (p: PackId) => {
      setPackState(p);
      void AsyncStorage.setItem(PACK_KEY, p).catch(() => undefined);
      if (live) void saveThemeSettings({ theme_pack: p });
    },
    [live],
  );

  const value = useMemo<PackState>(() => ({ pack, ready, mode: th.name, setPack }), [pack, ready, th.name, setPack]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePack = (): PackState => useContext(Ctx);
