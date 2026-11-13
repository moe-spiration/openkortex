import { useSyncExternalStore } from "react";
import type { EditorAiRequest } from "./ai";

export interface WikiLinkTarget {
  id: string;
  title: string;
  path?: string;
  /** Type label (Person, Projekt, Buch, ...) for the @ menu hint. */
  typeLabel?: string;
}

/** Host callbacks and data the custom blocks/menus need, kept per editor instance. */
export interface EditorBridgeState {
  wikiTargets: WikiLinkTarget[];
  onOpenWikiLink?: (target: { id?: string; title: string }) => void;
  onAiSummary?: () => string | Promise<string>;
  onCreateSubpage?: (title: string) => WikiLinkTarget | Promise<WikiLinkTarget>;
  /** KI actions on the selection (toolbar "KI", slash "Fortsetzen"): returns the answer as Markdown. */
  onAiAction?: (request: EditorAiRequest) => string | Promise<string>;
  /** "Frage dazu stellen": the host opens the copilot with the selected text. */
  onAiAsk?: (selection: string) => void;
  /** Slash "Daily Note": returns today's daily note (10_Notes/Daily/<date>.md), created when missing. */
  onDailyNote?: () => WikiLinkTarget | Promise<WikiLinkTarget>;
}

class BridgeStore {
  private state: EditorBridgeState = { wikiTargets: [] };
  private listeners = new Set<() => void>();

  get = (): EditorBridgeState => this.state;

  set(next: EditorBridgeState) {
    const s = this.state;
    if (
      s.wikiTargets === next.wikiTargets &&
      s.onOpenWikiLink === next.onOpenWikiLink &&
      s.onAiSummary === next.onAiSummary &&
      s.onCreateSubpage === next.onCreateSubpage &&
      s.onAiAction === next.onAiAction &&
      s.onAiAsk === next.onAiAsk &&
      s.onDailyNote === next.onDailyNote
    ) {
      return;
    }
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

// Node views render through portals, so a WeakMap keyed by the editor is more robust than context.
const stores = new WeakMap<object, BridgeStore>();

export function getBridge(editor: object): BridgeStore {
  let store = stores.get(editor);
  if (!store) {
    store = new BridgeStore();
    stores.set(editor, store);
  }
  return store;
}

export function useBridge(editor: object): EditorBridgeState {
  const store = getBridge(editor);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Resolves a wiki target title against the host's targets (case-insensitive, also by path). */
export function resolveWikiTarget(
  targets: readonly WikiLinkTarget[],
  title: string,
): WikiLinkTarget | undefined {
  const t = title.split("#")[0]!.trim().toLowerCase();
  return targets.find(
    (x) =>
      x.title.toLowerCase() === t ||
      x.path?.toLowerCase().replace(/\.md$/, "") === t ||
      x.path?.toLowerCase().replace(/\.md$/, "").endsWith(`/${t}`),
  );
}

export function openWikiLink(state: EditorBridgeState, title: string) {
  const hit = resolveWikiTarget(state.wikiTargets, title);
  state.onOpenWikiLink?.(hit ? { id: hit.id, title: hit.title } : { title });
}
