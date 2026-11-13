import path from "node:path";
import { readTextIfExists, writeFileAtomic } from "./fs-utils";
import { pathKey } from "./paths";
import { KORTEX_DIR } from "./vault-layout";

/** Last synchronised version of one item (the "base" for the 3-way comparison). */
export interface ItemSyncState {
  /** Vault-relative posix path of the file. */
  path: string;
  /** Checksum both sides agreed on at the last sync. */
  hash: string;
  /** `updated_at` of the remote row at the last sync (lets reconcile skip unchanged rows). */
  remoteUpdatedAt: string;
}

export interface FolderSyncState {
  path: string;
  system: boolean;
}

interface StateFile {
  version: 1;
  userId: string;
  items: Record<string, ItemSyncState>;
  folders: Record<string, FolderSyncState>;
}

export const STATE_FILE = `${KORTEX_DIR}/state.json`;

/**
 * Persistent sync state in `<vault>/.kortex/state.json`. It lives inside the vault on purpose:
 * pointing the daemon at a fresh folder starts a fresh sync instead of "deleting" everything.
 */
export class SyncState {
  private items = new Map<string, ItemSyncState>();
  private itemByPath = new Map<string, string>();
  private folders = new Map<string, FolderSyncState>();
  private folderByPath = new Map<string, string>();
  private dirty = false;

  private constructor(
    private readonly file: string,
    readonly userId: string,
  ) {}

  static async load(vaultPath: string, userId: string): Promise<SyncState> {
    const file = path.join(vaultPath, ...STATE_FILE.split("/"));
    const state = new SyncState(file, userId);
    const text = await readTextIfExists(file);
    if (text) {
      try {
        const data = JSON.parse(text) as StateFile;
        // A different account's state must not be used as the base for this one.
        if (data.version === 1 && data.userId === userId) {
          for (const [id, s] of Object.entries(data.items ?? {})) state.setItem(id, s);
          for (const [id, f] of Object.entries(data.folders ?? {})) state.setFolder(id, f);
        }
      } catch {
        // Corrupt state: start over. Reconcile falls back to the frontmatter checksums.
      }
    }
    state.dirty = false;
    return state;
  }

  // --- items ---
  getItem(id: string): ItemSyncState | undefined {
    return this.items.get(id);
  }

  setItem(id: string, s: ItemSyncState): void {
    const prev = this.items.get(id);
    if (prev && this.itemByPath.get(pathKey(prev.path)) === id) {
      this.itemByPath.delete(pathKey(prev.path));
    }
    this.items.set(id, { ...s });
    this.itemByPath.set(pathKey(s.path), id);
    this.dirty = true;
  }

  deleteItem(id: string): void {
    const prev = this.items.get(id);
    if (!prev) return;
    if (this.itemByPath.get(pathKey(prev.path)) === id) this.itemByPath.delete(pathKey(prev.path));
    this.items.delete(id);
    this.dirty = true;
  }

  itemIdAtPath(rel: string): string | undefined {
    return this.itemByPath.get(pathKey(rel));
  }

  itemIds(): string[] {
    return [...this.items.keys()];
  }

  // --- folders ---
  setFolder(id: string, f: FolderSyncState): void {
    const prev = this.folders.get(id);
    if (prev && this.folderByPath.get(pathKey(prev.path)) === id) {
      this.folderByPath.delete(pathKey(prev.path));
    }
    this.folders.set(id, { ...f });
    this.folderByPath.set(pathKey(f.path), id);
    this.dirty = true;
  }

  deleteFolder(id: string): void {
    const prev = this.folders.get(id);
    if (!prev) return;
    if (this.folderByPath.get(pathKey(prev.path)) === id) {
      this.folderByPath.delete(pathKey(prev.path));
    }
    this.folders.delete(id);
    this.dirty = true;
  }

  getFolder(id: string): FolderSyncState | undefined {
    return this.folders.get(id);
  }

  folderIdAtPath(rel: string): string | undefined {
    return this.folderByPath.get(pathKey(rel));
  }

  folderEntries(): [string, FolderSyncState][] {
    return [...this.folders.entries()];
  }

  replaceFolders(entries: [string, FolderSyncState][]): void {
    this.folders.clear();
    this.folderByPath.clear();
    for (const [id, f] of entries) this.setFolder(id, f);
    this.dirty = true;
  }

  async save(force = false): Promise<void> {
    if (!this.dirty && !force) return;
    this.dirty = false;
    const data: StateFile = {
      version: 1,
      userId: this.userId,
      items: Object.fromEntries(this.items),
      folders: Object.fromEntries(this.folders),
    };
    await writeFileAtomic(this.file, `${JSON.stringify(data, null, 2)}\n`);
  }
}
