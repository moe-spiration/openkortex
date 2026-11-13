import { t } from "./i18n";
import { mkdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

/*
 * One md-sync per vault: `<vault>/.kortex/daemon.lock` holds { pid, host, started_at }. The desktop
 * sidecar and a CLI / pm2 daemon on the same folder would otherwise fight over every file. A lock
 * of a dead process (same host) or one not refreshed for STALE_MS (any host) is taken over.
 */

export const STALE_MS = 3 * 60_000;
const REFRESH_MS = 60_000;

export class VaultLockedError extends Error {
  override name = "VaultLockedError";
}

interface LockBody {
  pid: number;
  host: string;
  started_at: string;
}

export interface VaultLock {
  readonly file: string;
  release(): void;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function acquireVaultLock(
  vaultPath: string,
  host: string,
  opts: { pid?: number; now?: () => number; isAlive?: (pid: number) => boolean } = {},
): VaultLock {
  const pid = opts.pid ?? process.pid;
  const now = opts.now ?? Date.now;
  const isAlive = opts.isAlive ?? alive;
  const dir = path.join(vaultPath, ".kortex");
  const file = path.join(dir, "daemon.lock");
  mkdirSync(dir, { recursive: true });
  try {
    const held = JSON.parse(readFileSync(file, "utf8")) as Partial<LockBody>;
    const age = now() - statSync(file).mtimeMs;
    const sameHost = held.host === host;
    // A running daemon refreshes the lock every minute, so a stale one is dead even when its PID
    // is alive again: Windows reuses PIDs, and a killed sidecar leaves its lock behind.
    const busy = held.pid !== pid && age < STALE_MS && (!sameHost || (typeof held.pid === "number" && isAlive(held.pid)));
    if (busy)
      throw new VaultLockedError(
        t("An md-sync is already running on this vault ({where}). Stop the other one first.", {
          where: sameHost ? `PID ${held.pid}` : t("on {host}", { host: String(held.host) }),
        }),
      );
  } catch (error) {
    if (error instanceof VaultLockedError) throw error;
    // No lock, or an unreadable one: take it.
  }
  const body: LockBody = { pid, host, started_at: new Date(now()).toISOString() };
  writeFileSync(file, JSON.stringify(body));
  const timer = setInterval(() => {
    try {
      const t = new Date(now());
      utimesSync(file, t, t);
    } catch {
      // Vault gone or unplugged: the engine reports that.
    }
  }, REFRESH_MS);
  timer.unref();
  return {
    file,
    release() {
      clearInterval(timer);
      try {
        const held = JSON.parse(readFileSync(file, "utf8")) as Partial<LockBody>;
        if (held.pid === pid && held.host === host) unlinkSync(file);
      } catch {
        // already gone
      }
    },
  };
}
