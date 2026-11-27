// Extension settings and the small persistent stores (mock inbox, outbox, restored highlights).
// All access goes through `KeyValueStore` so logic stays testable without the chrome.* APIs.

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export type ThemeSetting = "dark" | "light" | "auto";

/**
 * UI look: the calm "ruhe" look (default) or "vivid" (the former classic look), data-look like the web's
 * Einstellungen > Erscheinungsbild > Look. A stored "classic" from before 0.6.7 was the old default and reads as "ruhe".
 */
export type LookSetting = "ruhe" | "vivid";

/** Interface language: "auto" follows the browser language, "en" / "de" is the user's explicit choice. */
export type LanguageSetting = "auto" | "en" | "de";

/** Detail of the server's auto-summary (C1); sent as `summary_level` with clips and chats. */
export type SummaryLevel = "concise" | "detailed";

/**
 * The Kortex this build is preconfigured for (`WXT_KORTEX_DEFAULT_URL` at build time), or "" for a
 * build without one: the extension carries no server address of its own, the user enters theirs on
 * the options page (opened on install).
 */
export const DEFAULT_BASE_URL: string = String(import.meta.env.WXT_KORTEX_DEFAULT_URL ?? "").trim().replace(/\/+$/, "");

export interface ExtensionSettings {
  /**
   * `null` = automatic (default): mock while no API token is set, live as soon as one is.
   * `true`/`false` = the user chose explicitly in the options.
   */
  mockMode: boolean | null;
  /** e.g. https://kortex.example.com (no trailing path). */
  baseUrl: string;
  /** Personal Kortex API token `kx_…` (Bearer), created in Kortex under Settings. Kept in storage.local only, never synced. */
  token: string;
  theme: ThemeSetting;
  look: LookSetting;
  language: LanguageSetting;
  highlighterEnabled: boolean;
  chatExportEnabled: boolean;
  /** Folders offered by "Choose folder" in the clipper. */
  clipFolders: string[];
  /** Hashtags pre-selected in the clipper (without #). */
  defaultTags: string[];
  /** Pre-selected route: zero-setup auto-routing (default) or the first folder. */
  defaultRoute: "auto" | "manual";
  /** "Summary detail": concise (default) or detailed. */
  summaryLevel: SummaryLevel;
  /** "Autosave": a click on the toolbar button saves the page right away, without the form (C2). */
  autosave: boolean;
  /** Tab manager: an open tab dragged (or added) into a session is closed once it is saved there, like "Save & close". */
  closeOnDrop: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  mockMode: null,
  baseUrl: DEFAULT_BASE_URL,
  token: "",
  theme: "dark",
  look: "ruhe",
  language: "auto",
  highlighterEnabled: true,
  chatExportEnabled: true,
  clipFolders: ["30_Clippings", "10_Notes", "60_Documents"],
  defaultTags: [],
  defaultRoute: "auto",
  summaryLevel: "concise",
  autosave: false,
  closeOnDrop: true,
};

/** Whether captures stay local (mock) or go to the server. */
export const isMockMode = (s: Pick<ExtensionSettings, "mockMode" | "token">): boolean =>
  s.mockMode ?? !s.token.trim();

const SETTINGS_KEY = "settings";

export async function loadSettings(store: KeyValueStore): Promise<ExtensionSettings> {
  const saved = await store.get<Partial<ExtensionSettings>>(SETTINGS_KEY);
  const merged = { ...DEFAULT_SETTINGS, ...saved };
  merged.look = (merged.look as string) === "vivid" ? "vivid" : "ruhe";
  // An address cleared by hand (or saved empty by an older version) falls back to the build's Kortex, if it has one.
  return merged.baseUrl.trim() ? merged : { ...merged, baseUrl: DEFAULT_BASE_URL };
}

export async function saveSettings(store: KeyValueStore, patch: Partial<ExtensionSettings>) {
  const next = { ...(await loadSettings(store)), ...patch };
  await store.set(SETTINGS_KEY, next);
  return next;
}

/** Normalises user input for the base URL: trims, drops trailing slashes, rejects non-http(s). */
export function normalizeBaseUrl(input: string): string | null {
  const value = input.trim().replace(/\/+$/, "");
  if (!value) return "";
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) {
      return null;
    }
    return `${u.origin}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return null;
  }
}

// --- chrome.storage.local implementation -------------------------------------------------------

export const chromeStore: KeyValueStore = {
  async get<T>(key: string) {
    const res = await chrome.storage.local.get(key);
    return res[key] as T | undefined;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.local.remove(key);
  },
};

export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
    async remove(key) {
      data.delete(key);
    },
  };
}
