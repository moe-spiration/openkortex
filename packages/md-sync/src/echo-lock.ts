import { pathKey } from "./paths";

interface LockEntry {
  /** Checksum the daemon wrote; null = any content (e.g. a file the daemon moved itself). */
  hash: string | null;
  expires: number;
}

/**
 * Short-lived per-path locks for the daemon's own file operations, so the watcher events
 * they cause (add/change/unlink, ~400-600 ms later because of awaitWriteFinish) are not
 * mistaken for user edits. A write lock only matches if the file still has the content the
 * daemon wrote, so a real user edit inside the window is never swallowed.
 */
export class EchoLock {
  private writes = new Map<string, LockEntry>();
  private removals = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  lockWrite(rel: string, hash: string | null): void {
    this.writes.set(pathKey(rel), { hash, expires: this.now() + this.ttlMs });
  }

  lockRemoval(rel: string): void {
    this.removals.set(pathKey(rel), this.now() + this.ttlMs);
  }

  isWriteEcho(rel: string, hash: string | null): boolean {
    const entry = this.writes.get(pathKey(rel));
    if (!entry) return false;
    if (entry.expires < this.now()) {
      this.writes.delete(pathKey(rel));
      return false;
    }
    return entry.hash === null || entry.hash === hash;
  }

  isRemovalEcho(rel: string): boolean {
    const expires = this.removals.get(pathKey(rel));
    if (expires === undefined) return false;
    if (expires < this.now()) {
      this.removals.delete(pathKey(rel));
      return false;
    }
    return true;
  }

  prune(): void {
    const t = this.now();
    for (const [k, v] of this.writes) if (v.expires < t) this.writes.delete(k);
    for (const [k, v] of this.removals) if (v < t) this.removals.delete(k);
  }
}
