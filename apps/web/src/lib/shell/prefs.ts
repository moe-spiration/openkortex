import { accentFill, accentPair } from "./accent";
import { APPEARANCE_KEY, FONT_SCALES } from "@/lib/settings/appearance";
import { GPU_KEY } from "@/lib/settings/gpu";
import { MOTION_PREPAINT } from "@/lib/settings/motion";
import type { IconId } from "@/components/shell/icons";
import { VAULT_OPEN_DEFAULT } from "@/lib/workspace-data";
import { HOME_TAB_KEY, isDocTabKey } from "./routes";

/* Shell preferences persisted to localStorage (theme, accent, rail, sidebar, groups, tabs). The chat model is the ADR-06 chat_reasoning route, not a pref. */

// v2: the reader tab moved from /vault/... to /reader/n3.
export const PREFS_KEY = "kortex.shell.v2";

export type Theme = "dark" | "light";
export type SectionId = "life" | "spaces" | "objects" | "vault" | "tags";
/** View menu of the sidebar's Bibliothek (variant A2): which tree it shows. */
// "folders" is the Vault view (label "Vault"); the id stays so stored prefs keep working. "tags" was a lens until
// 2026-11-10 and is now its own sidebar section: a stored "tags" falls back to the default lens.
export type LibLens = "types" | "objects" | "folders";
export const LIB_LENSES: LibLens[] = ["types", "objects", "folders"];

export interface Tab {
  key: string;
  label: string;
  icon: IconId;
  href: string;
}

export interface ShellPrefs {
  /** Resolved theme. With followSystem it tracks prefers-color-scheme. */
  theme: Theme;
  /** Settings > Erscheinungsbild > Theme "System". Off by default (the theme the user picked stays). */
  followSystem: boolean;
  /** Tactile Craft: the sidebar is hidden completely (titlebar toggle, Ctrl+\). Separate from the icon rail. */
  sidebarClosed: boolean;
  accent: string;
  rail: boolean;
  /** Collapsible sidebar groups; true = expanded. Remembered per browser (decision Q6: localStorage, no DB sync). */
  sections: Record<SectionId, boolean>;
  /** Version of the group defaults the stored `sections` were last migrated to (see SECTIONS_VERSION). */
  sectionsVersion?: number;
  /** Expanded folders in the Vault Explorer tree. */
  tree: Record<string, boolean>;
  tabs: Tab[];
  /** Bibliothek view: Typen, Objekte or Vault. */
  libLens: LibLens;
  /** Order of the sidebar favourites (item ids); favourites not listed follow in their loaded order. */
  favOrder: string[];
}

const HOME_TAB: Tab = { key: HOME_TAB_KEY, label: "Home", icon: "home", href: "/home" };

/** V2-03b: the strip holds documents only, behind the icon-only Home tab. */
export const DEFAULT_TABS: Tab[] = [HOME_TAB];

/**
 * Migrates stored tabs: drops the old fixed navigation tabs (Auto-Spaces, Tasks & Digest, 2D Graph, any view tab)
 * and keeps the user's documents in their order, with Home pinned first.
 */
export function migrateTabs(tabs: Tab[]): Tab[] {
  const docs = tabs.filter((t) => t && typeof t.key === "string" && isDocTabKey(t.key));
  return [HOME_TAB, ...docs];
}

export const DEFAULT_PREFS: ShellPrefs = {
  theme: "dark",
  followSystem: false,
  sidebarClosed: false,
  accent: "indigo",
  rail: false,
  // W4: Life and Spaces open; Objects und Hubs and Hashtags start collapsed. The Vault Explorer is a footer
  // popover now (its tree folders stay in `tree`).
  // A2: Life sits collapsed at the bottom of the sidebar; the Bibliothek groups (spaces, objects) stay as they were.
  sections: { life: true, spaces: true, objects: false, vault: false, tags: false },
  sectionsVersion: 3,
  tree: VAULT_OPEN_DEFAULT,
  tabs: DEFAULT_TABS,
  libLens: "types",
  favOrder: [],
};

/**
 * 2: W4 (UI spec 2026-10-25) — Objects und Hubs and Hashtags start collapsed. Stored prefs from before
 * had them open only because that was the old default, so they are collapsed once; after that the
 * user's own choice is kept.
 */
export const SECTIONS_VERSION = 4;

export function migrateSections(
  stored: Partial<Record<SectionId, boolean>> | undefined,
  version: number | undefined,
): Record<SectionId, boolean> {
  const merged = { ...DEFAULT_PREFS.sections, ...stored };
  let out = merged;
  if ((version ?? 1) < 2) out = { ...out, objects: false, tags: false };
  // 3: A2 sidebar — Life moved to the bottom dock and starts collapsed once.
  if ((version ?? 1) < 3) out = { ...out, life: false };
  // 4 (2026-11-07): the Life dock is open by default, with its toggle on top.
  if ((version ?? 1) < 4) out = { ...out, life: true };
  return out;
}

export function loadPrefs(): ShellPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<ShellPrefs>;
    return {
      ...DEFAULT_PREFS,
      ...p,
      sections: migrateSections(p.sections, p.sectionsVersion),
      sectionsVersion: SECTIONS_VERSION,
      tree: { ...DEFAULT_PREFS.tree, ...p.tree },
      tabs: Array.isArray(p.tabs) ? migrateTabs(p.tabs) : DEFAULT_PREFS.tabs,
      libLens: LIB_LENSES.includes(p.libLens as LibLens)
        ? (p.libLens as LibLens)
        : DEFAULT_PREFS.libLens,
      favOrder: Array.isArray(p.favOrder)
        ? p.favOrder.filter((x): x is string => typeof x === "string").slice(0, 200)
        : [],
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: ShellPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode or quota: preferences just don't persist */
  }
}

/** System colour scheme (dark when unknown). */
export function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Writes theme, rail, sidebar state and accent onto <html> so CSS reacts before React hydrates. */
export function applyDocumentPrefs(
  p: Pick<ShellPrefs, "theme" | "rail" | "accent"> & Partial<Pick<ShellPrefs, "sidebarClosed">>,
) {
  const d = document.documentElement;
  d.dataset.theme = p.theme;
  d.dataset.rail = String(p.rail);
  d.dataset.sb = p.sidebarClosed ? "closed" : "open";
  const [hex, solid] = accentPair(p.accent);
  d.style.setProperty("--kx-accent", hex);
  d.style.setProperty("--kx-accent-solid", solid);
  const [fill, on] = accentFill(hex);
  d.style.setProperty("--kx-accent-fill", fill);
  d.style.setProperty("--kx-on-accent", on);
}

/**
 * Inline <head> script: applies persisted prefs before first paint (no theme, sidebar, accent or backdrop flash).
 * Shell prefs (theme incl. "System", rail, sidebar, accent, --kx-accent-fill, --kx-on-accent) and the appearance prefs of
 * lib/settings/appearance.ts (data-backdrop, data-density, data-glass, data-look, --kx-fs; glass also solid on a stored software-render probe,
 * lib/settings/gpu.ts).
 */
export const PREPAINT_SCRIPT = `(function(){try{var accentPair=${accentPair.toString()};var accentFill=${accentFill.toString()};var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  PREFS_KEY,
)})||"{}");var d=document.documentElement;var t=p.theme;if(p.followSystem){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}if(t)d.dataset.theme=t;d.dataset.rail=String(!!p.rail);d.dataset.sb=p.sidebarClosed?"closed":"open";var a=accentPair(p.accent);d.style.setProperty("--kx-accent",a[0]);d.style.setProperty("--kx-accent-solid",a[1]);var f=accentFill(a[0]);d.style.setProperty("--kx-accent-fill",f[0]);d.style.setProperty("--kx-on-accent",f[1]);var ap=JSON.parse(localStorage.getItem(${JSON.stringify(
  APPEARANCE_KEY,
)})||"{}");var g=ap.reduceTransparency===true;d.dataset.backdrop=!g&&ap.backdrop==="pack"?"pack":"glow";d.dataset.density=ap.density==="komfort"||ap.density==="dicht"?ap.density:"kompakt";var sr=false;try{sr=localStorage.getItem(${JSON.stringify(GPU_KEY)})==="soft";}catch(e){}d.dataset.glass=g||sr?"solid":"on";var fs=ap.fontScale;if(${JSON.stringify(FONT_SCALES)}.indexOf(fs)>=0)d.style.setProperty("--kx-fs",String(fs));d.dataset.look=ap.look==="vivid"?"vivid":"ruhe";if(typeof ap.baseHue==="number")d.style.setProperty("--ruhe-h",String(ap.baseHue));if(typeof ap.tint==="number")d.style.setProperty("--ruhe-c",String(ap.tint));if(ap.contrast==="soft"||ap.contrast==="high")d.dataset.contrast=ap.contrast;${MOTION_PREPAINT}}catch(e){}})();`;
