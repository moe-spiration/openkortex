import { watch, type FSWatcher } from "chokidar";
import { isIgnoredRel, isMarkdownPath, toRel } from "./paths";

export interface VaultWatchHandlers {
  file(rel: string): void;
  unlink(rel: string): void;
  addDir(rel: string): void;
  unlinkDir(rel: string): void;
  error(error: unknown): void;
}

export interface VaultWatcherOptions {
  usePolling?: boolean;
  /** Spec 7.1: wait until a file has been stable for 400 ms before reporting it. */
  stabilityThreshold?: number;
  pollInterval?: number;
}

/**
 * chokidar watcher for `<vault>/**\/*.md` plus directories (for sub-folder detection).
 * chokidar >= 4 has no glob support, so the `**\/*.md` filter is the `ignored` function.
 */
export async function watchVault(
  vaultPath: string,
  handlers: VaultWatchHandlers,
  options: VaultWatcherOptions = {},
): Promise<FSWatcher> {
  const rel = (abs: string) => toRel(vaultPath, abs);
  const watcher = watch(vaultPath, {
    ignoreInitial: true, // the startup reconcile scans the vault itself
    persistent: true,
    usePolling: options.usePolling ?? false,
    awaitWriteFinish: {
      stabilityThreshold: options.stabilityThreshold ?? 400,
      pollInterval: options.pollInterval ?? 100,
    },
    ignored: (absPath, stats) => {
      const r = rel(absPath);
      if (!r || r.startsWith("..")) return false;
      if (isIgnoredRel(r)) return true;
      return stats?.isFile() === true && !isMarkdownPath(r);
    },
  });

  watcher
    .on("add", (p) => isMarkdownPath(p) && handlers.file(rel(p)))
    .on("change", (p) => isMarkdownPath(p) && handlers.file(rel(p)))
    .on("unlink", (p) => isMarkdownPath(p) && handlers.unlink(rel(p)))
    .on("addDir", (p) => {
      const r = rel(p);
      if (r) handlers.addDir(r);
    })
    .on("unlinkDir", (p) => {
      const r = rel(p);
      if (r) handlers.unlinkDir(r);
    })
    .on("error", (e) => handlers.error(e));

  await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
  return watcher;
}
