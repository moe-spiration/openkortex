"use client";

import { t } from "@/i18n";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  revokeMcpToken as revokeMcpTokenAction,
  rotateMcpToken as rotateMcpTokenAction,
  updateUserSettings as updateUserSettingsAction,
  type SettingsResult,
} from "@/lib/api/settings-actions";
import {
  DEFAULT_LOCAL_PREFS,
  MOCK_USER_SETTINGS,
  type LocalPrefs,
  type UserSettingsUpdate,
} from "@/lib/mock/settings";
import { useShell } from "@/lib/shell/store";
import { isAbort, readApi } from "@/lib/api/read";
import { isLiveData } from "@/lib/workspace-data";
import {
  DEFAULT_APPEARANCE,
  applyAppearance,
  loadAppearance,
  resolveDensity,
  saveAppearance,
  type AppearancePrefs,
  type Density,
} from "./appearance";
import { probeGpuWhenIdle } from "./gpu";
import { checkUserSettingsPatch } from "./patch";
import { toClientSettings, type ClientUserSettings } from "./types";

/*
 * Settings state: the kortex.user_settings row plus device preferences.
 *
 * Live (KORTEX_DATA_SOURCE=supabase): the row is loaded with GET /api/read/settings (getUserSettings);
 * updateUserSettings applies a patch optimistically, saves it via lib/api/settings-actions.ts and
 * rolls back (with a toast) when the server refuses. Only whitelisted columns are writable
 * (lib/settings/patch.ts). The MCP token is generated server-side; the browser gets the full token
 * once (kept in memory only) and otherwise just the hint.
 *
 * Mock: everything lives in localStorage, as before (the MCP token is generated in the browser).
 * Device prefs (`local`) are localStorage in both modes.
 */

const KEY = "kortex.settings.v1";

interface Persisted {
  user: ClientUserSettings;
  local: LocalPrefs;
  /** Mock only: the full token (live never persists it). */
  mcpToken: string | null;
}

export interface McpTokenState {
  /** Full token: mock always, live only right after rotating (shown once). */
  token: string | null;
  /** Last 4 characters, or null when there is no token. */
  hint: string | null;
  createdAt: string | null;
}

interface SettingsState {
  user: ClientUserSettings;
  local: LocalPrefs;
  mcp: McpTokenState;
  live: boolean;
  /** Live: the row is still loading (the defaults are shown meanwhile). */
  loading: boolean;
  updateUserSettings: (patch: UserSettingsUpdate) => void;
  toggleConnector: (id: string) => void;
  setLocal: (key: keyof LocalPrefs, value: boolean) => void;
  /** Tactile Craft appearance device prefs (backdrop, density, reduced transparency); see ./appearance.ts. */
  appearance: AppearancePrefs;
  setAppearance: (patch: Partial<AppearancePrefs>) => void;
  /** Stores (or with null clears) the density the user picked in one view scope. */
  setScopeDensity: (scope: string, d: Density | null) => void;
  /** New bearer token for the MCP HTTP transport; resolves to the full token, or null on failure. */
  rotateMcpToken: () => Promise<string | null>;
  revokeMcpToken: () => Promise<boolean>;
  /** Forget the once-shown token in the UI (live: only the hint stays). */
  hideMcpToken: () => void;
}

const Ctx = createContext<SettingsState | null>(null);

const MOCK_USER = toClientSettings(MOCK_USER_SETTINGS);

function readStored(): Partial<Persisted> | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : null;
  } catch {
    return null;
  }
}

function load(): Persisted {
  const p = readStored();
  return {
    user: toClientSettings({ ...MOCK_USER, ...p?.user }),
    local: { ...DEFAULT_LOCAL_PREFS, ...p?.local },
    mcpToken: typeof p?.mcpToken === "string" ? p.mcpToken : null,
  };
}

/** 32 random bytes as base64url. Mock only: never leaves the browser. */
function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Server action call that never rejects (network errors become `{ ok: false }`). */
function safe<T>(p: Promise<SettingsResult<T>>): Promise<SettingsResult<T>> {
  return p.catch((err: unknown) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : t("Server not reachable"),
  }));
}

const mockMcp = (token: string | null): McpTokenState => ({
  token,
  hint: token ? token.slice(-4) : null,
  createdAt: null,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const live = isLiveData();
  const { showToast } = useShell();
  const [user, setUser] = useState<ClientUserSettings>(MOCK_USER);
  const [local, setLocalState] = useState<LocalPrefs>(DEFAULT_LOCAL_PREFS);
  const [mcp, setMcp] = useState<McpTokenState>(mockMcp(null));
  const [hydrated, setHydrated] = useState(false);
  const [appearance, setAppearanceState] = useState<AppearancePrefs>(DEFAULT_APPEARANCE);
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [loading, setLoading] = useState(live);
  const userRef = useRef(user);
  userRef.current = user;
  // Live: changes made while the row is still loading; they are kept when the row arrives (it would overwrite them).
  const loadingRef = useRef(live);
  const pendingRef = useRef<Partial<ClientUserSettings>>({});

  // Hydrate: device prefs always from localStorage; the row from there (mock) or the server (live).
  useEffect(() => {
    const stored = load();
    setLocalState(stored.local);
    setAppearanceState(loadAppearance());
    setAppearanceReady(true);
    setHydrated(true);
    if (!live) {
      setUser(stored.user);
      setMcp(mockMcp(stored.mcpToken));
      return;
    }
    let alive = true;
    // GET /api/read/settings (P7-5): not queued behind server actions; aborted on unmount.
    const ac = new AbortController();
    void readApi<SettingsResult<ClientUserSettings>>("settings", undefined, ac.signal).then((res) => {
      if (!alive) return;
      loadingRef.current = false;
      setLoading(false);
      if (!res.ok) {
        showToast(t("Settings not loaded: {error}", { error: res.error }));
        return;
      }
      setUser({ ...res.data, ...pendingRef.current });
      pendingRef.current = {};
      setMcp({
        token: null,
        hint: res.data.mcp_token_hint,
        createdAt: res.data.mcp_token_created_at,
      });
    }).catch((err: unknown) => {
      if (!alive || isAbort(err)) return;
      loadingRef.current = false;
      setLoading(false);
      showToast(t("Settings not loaded: {error}", { error: t("Server not reachable") }));
    });
    return () => {
      alive = false;
      ac.abort();
    };
  }, [live, showToast]);

  // Persist: mock keeps everything, live only the device prefs (other stored fields stay as they were).
  useEffect(() => {
    if (!hydrated) return;
    try {
      const next: Partial<Persisted> = live
        ? { ...readStored(), local }
        : { user, local, mcpToken: mcp.token };
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode: settings just don't persist */
    }
    // Device prefs that change the whole UI.
    const d = document.documentElement;
    d.dataset.motion = local.motion ? "reduced" : "full";
    d.dataset.heroes = local.heroes ? "on" : "off";
  }, [user, local, mcp.token, hydrated, live]);

  // Appearance: own key, applied to <html> (the pre-paint script did the first paint already).
  useEffect(() => {
    if (!appearanceReady) return;
    saveAppearance(appearance);
    applyAppearance(appearance);
  }, [appearance, appearanceReady]);
  // No GPU rasterisation on this device: glass turns solid (lib/settings/gpu.ts); probed once, in idle time.
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  useEffect(() => probeGpuWhenIdle(() => applyAppearance(appearanceRef.current)), []);
  const setAppearance = useCallback((patch: Partial<AppearancePrefs>) => setAppearanceState((a) => ({ ...a, ...patch })), []);
  const setScopeDensity = useCallback(
    (scope: string, d: Density | null) =>
      setAppearanceState((a) => {
        const next = { ...a.densityByScope };
        if (d) next[scope] = d;
        else delete next[scope];
        return { ...a, densityByScope: next };
      }),
    [],
  );

  const updateUserSettings = useCallback(
    (patch: UserSettingsUpdate) => {
      if (!live) {
        setUser(
          (u) => ({ ...u, ...patch, updated_at: new Date().toISOString() }) as ClientUserSettings,
        );
        return;
      }
      const check = checkUserSettingsPatch(patch);
      if (!check.ok) {
        showToast(t("Not saved: {error}", { error: check.error }));
        return;
      }
      const sent = check.patch as Partial<ClientUserSettings>;
      const keys = Object.keys(sent) as (keyof ClientUserSettings)[];
      if (!keys.length) return;
      // Optimistic: apply now, remember the previous values of exactly these columns.
      const before = Object.fromEntries(
        keys.map((k) => [k, userRef.current[k]]),
      ) as Partial<ClientUserSettings>;
      setUser((u) => ({ ...u, ...sent }));
      if (loadingRef.current) Object.assign(pendingRef.current, sent);
      void safe(updateUserSettingsAction(check.patch)).then((res) => {
        if (res.ok) {
          setUser((u) => ({ ...u, updated_at: res.data.updated_at }));
          return;
        }
        // Roll back only the columns nobody changed again in the meantime.
        setUser((u) => {
          const next: Record<string, unknown> = { ...u };
          for (const k of keys) if (Object.is(u[k], sent[k])) next[k] = before[k];
          return next as unknown as ClientUserSettings;
        });
        showToast(t("Not saved: {error}", { error: res.error }));
      });
    },
    [live, showToast],
  );

  const rotateMcpToken = useCallback(async (): Promise<string | null> => {
    if (!live) {
      const token = newToken();
      setMcp(mockMcp(token));
      return token;
    }
    const res = await safe(rotateMcpTokenAction());
    if (!res.ok) {
      showToast(t("Token not created: {error}", { error: res.error }));
      return null;
    }
    setMcp({ token: res.data.token, hint: res.data.hint, createdAt: res.data.createdAt });
    return res.data.token;
  }, [live, showToast]);

  const revokeMcpToken = useCallback(async (): Promise<boolean> => {
    if (!live) {
      setMcp(mockMcp(null));
      return true;
    }
    const res = await safe(revokeMcpTokenAction());
    if (!res.ok) {
      showToast(t("Token not revoked: {error}", { error: res.error }));
      return false;
    }
    setMcp({ token: null, hint: null, createdAt: null });
    return true;
  }, [live, showToast]);

  // Stable: the MCP section calls it on unmount.
  const hideMcpToken = useCallback(
    () => setMcp((m) => (live && m.token ? { ...m, token: null } : m)),
    [live],
  );

  const value = useMemo<SettingsState>(
    () => ({
      user,
      local,
      mcp,
      live,
      loading,
      updateUserSettings,
      toggleConnector: (id) => {
        const on = user.enabled_connectors ?? [];
        updateUserSettings({
          enabled_connectors: on.includes(id) ? on.filter((c) => c !== id) : [...on, id],
        });
      },
      setLocal: (key, v) => setLocalState((l) => ({ ...l, [key]: v })),
      appearance,
      setAppearance,
      setScopeDensity,
      rotateMcpToken,
      revokeMcpToken,
      hideMcpToken,
    }),
    [
      user,
      local,
      mcp,
      live,
      loading,
      updateUserSettings,
      appearance,
      setAppearance,
      setScopeDensity,
      rotateMcpToken,
      revokeMcpToken,
      hideMcpToken,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSettings must be used inside <SettingsProvider>");
  return s;
}

/**
 * Density of one view (Tactile Craft v2, decision 3). `scope` names the view ("spaces:all", "life", "inbox");
 * `fallback` is the view's own default (Life passes "komfort"), else the Standard-Dichte applies; an open drawer
 * forces "dicht". setDensity stores the user's choice for this scope, reset() forgets it.
 */
export function useDensity(
  scope: string,
  opts: { fallback?: Density; drawerOpen?: boolean } = {},
): { density: Density; chosen: Density | null; setDensity: (d: Density) => void; reset: () => void } {
  const { appearance, setScopeDensity } = useSettings();
  const chosen = appearance.densityByScope[scope] ?? null;
  const density = resolveDensity({ global: appearance.density, scoped: chosen ?? undefined, fallback: opts.fallback, drawerOpen: opts.drawerOpen });
  const setDensity = useCallback((d: Density) => setScopeDensity(scope, d), [scope, setScopeDensity]);
  const reset = useCallback(() => setScopeDensity(scope, null), [scope, setScopeDensity]);
  return { density, chosen, setDensity, reset };
}

/** Appearance prefs and their setter (Settings > Erscheinungsbild). */
export function useAppearance() {
  const { appearance, setAppearance } = useSettings();
  return { appearance, setAppearance };
}
