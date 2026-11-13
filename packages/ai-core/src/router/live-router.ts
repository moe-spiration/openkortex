import type { AiTask } from "@kortex/db";
import {
  createUserModelRouter,
  type UserModelRouter,
  type UserModelRouterOptions,
} from "./user-router";
import type { LanguageTask, ModelRouter } from "./model-router";

// Long-running processes (md-sync, MCP server) keep one router for hours. This wrapper keeps it
// current: a change signal (Realtime on kortex.user_settings) or the periodic catalog refresh marks
// it stale, and the next use rebuilds it. Callers hold `models`, a stable proxy that always
// delegates to the newest router, so pipelines built once never need rewiring.

export interface LiveUserModelRouterOptions extends UserModelRouterOptions {
  /**
   * Change feed for the user's settings (routing, embedding lock). Gets a callback, returns an
   * unsubscribe function. Without it only the periodic refresh applies.
   */
  subscribe?: (onChange: () => void) => (() => void | Promise<void>) | void;
  /** Periodic rebuild that also reloads the model catalog (default 6 h; 0 turns it off). */
  refreshIntervalMs?: number;
  /** Called after each successful rebuild (logs). */
  onRebuild?: (user: UserModelRouter, reason: string) => void;
  /** A rebuild failed; the previous router stays in use. */
  onError?: (error: unknown, reason: string) => void;
  /** Timers (tests). */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export interface LiveUserModelRouter {
  /** Stable router: every call goes to the newest build. */
  readonly models: ModelRouter;
  /** The newest build (routing, lock, catalog). */
  current(): UserModelRouter;
  /** Rebuilds first if something changed since the last build. Await before a unit of work. */
  ensureFresh(): Promise<UserModelRouter>;
  /** Marks the router stale and starts a background rebuild. */
  invalidate(reason?: string): void;
  /** Stops the feed and the timer. */
  close(): Promise<void>;
}

export const DEFAULT_ROUTER_REFRESH_MS = 6 * 60 * 60_000;

export async function createLiveUserModelRouter(
  opts: LiveUserModelRouterOptions,
): Promise<LiveUserModelRouter> {
  // A caller-held catalog would never change: rebuilds always reload it.
  const { catalog: initialCatalog, subscribe, onRebuild, onError, ...base } = opts;
  let current = await createUserModelRouter(
    initialCatalog ? { ...base, catalog: initialCatalog } : base,
  );
  let dirty: string | null = null;
  let inflight: Promise<UserModelRouter> | null = null;

  const rebuild = (): Promise<UserModelRouter> => {
    if (inflight) return inflight;
    const reason = dirty ?? "refresh";
    dirty = null;
    inflight = createUserModelRouter(base)
      .then((next) => {
        current = next;
        onRebuild?.(next, reason);
        return next;
      })
      .catch((error: unknown) => {
        onError?.(error, reason);
        return current;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const invalidate = (reason = "change") => {
    dirty = reason;
    void rebuild().then(() => {
      // A change that arrived during the rebuild needs one more pass.
      if (dirty) void rebuild();
    });
  };

  const models: ModelRouter = {
    get modelIds() {
      return current.models.modelIds;
    },
    fast: () => current.models.fast(),
    chat: () => current.models.chat(),
    vision: () => current.models.vision(),
    embedding: () => current.models.embedding(),
    forTask: (task: LanguageTask) =>
      current.models.forTask ? current.models.forTask(task) : current.models.chat(),
    route: (task: AiTask) => {
      if (!current.models.route) throw new Error("router has no route()");
      return current.models.route(task);
    },
    transcriber: () => current.models.transcriber?.(),
    documentParser: () => current.models.documentParser?.(),
  };

  const unsubscribe = subscribe?.(() => invalidate("settings changed")) ?? undefined;
  const every = opts.refreshIntervalMs ?? DEFAULT_ROUTER_REFRESH_MS;
  const setI = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearI = opts.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const timer = every > 0 ? setI(() => invalidate("catalog refresh"), every) : null;
  if (timer && typeof (timer as { unref?: () => void }).unref === "function")
    (timer as { unref: () => void }).unref();

  return {
    models,
    current: () => current,
    async ensureFresh() {
      if (inflight) await inflight;
      if (dirty) return rebuild();
      return current;
    },
    invalidate,
    async close() {
      if (timer) clearI(timer);
      await unsubscribe?.();
    },
  };
}
