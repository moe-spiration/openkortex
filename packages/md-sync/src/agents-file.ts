import { renderAgentsDocument, type FolderCount } from "@kortex/mcp-server/agents-guide";
import type { SyncEngine } from "./engine";
import { readTextIfExists, scanVault, writeFileAtomic } from "./fs-utils";
import type { Logger } from "./logger";
import { dirnameRel, toAbs, VAULT_AGENTS_FILE } from "./paths";

export interface VaultAgentsFileOptions {
  engine: Pick<SyncEngine, "vaultPath" | "on" | "off">;
  logger?: Logger;
  /** Quiet time after the last sync activity before the file is rewritten. Default 30 s. */
  debounceMs?: number;
}

const ACTIVITY_EVENTS = [
  "reconciled",
  "pushed",
  "pulled",
  "local-removed",
  "remote-removed",
] as const;

/** Folder counts of the vault on disk: every folder, with its direct markdown files. */
export async function scanFolderCounts(vaultPath: string): Promise<FolderCount[]> {
  const scan = await scanVault(vaultPath);
  const counts = new Map<string, number>(scan.dirs.map((d) => [d, 0]));
  for (const file of scan.files) {
    const dir = dirnameRel(file);
    if (dir) counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts].map(([folder_path, items]) => ({ folder_path, items }));
}

/** The vault's `agents.md`: the agents guide plus the folder index of this vault. */
export async function renderVaultAgentsFile(vaultPath: string): Promise<string> {
  return renderAgentsDocument(await scanFolderCounts(vaultPath), {
    indexTitle: "Folder index (this vault)",
  });
}

/**
 * Keeps `<vault>/agents.md` current: written on start and again after sync activity has been
 * quiet for `debounceMs`. Only written when the content changed (no timestamp in it), so an open
 * editor or a git-tracked vault sees no churn. The file itself is ignored by the sync.
 */
export class VaultAgentsFile {
  private readonly debounceMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly onActivity = () => this.schedule();

  constructor(private readonly opts: VaultAgentsFileOptions) {
    this.debounceMs = opts.debounceMs ?? 30_000;
  }

  async start(): Promise<this> {
    for (const e of ACTIVITY_EVENTS) this.opts.engine.on(e, this.onActivity);
    await this.refresh();
    return this;
  }

  async stop(): Promise<void> {
    for (const e of ACTIVITY_EVENTS) this.opts.engine.off(e, this.onActivity);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  /** Rewrites the file if its content changed. Returns true when it wrote. Never throws. */
  async refresh(): Promise<boolean> {
    const run = (this.running ?? Promise.resolve()).then(() => this.write());
    this.running = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async write(): Promise<boolean> {
    const { vaultPath } = this.opts.engine;
    try {
      const abs = toAbs(vaultPath, VAULT_AGENTS_FILE);
      const next = await renderVaultAgentsFile(vaultPath);
      if ((await readTextIfExists(abs)) === next) return false;
      await writeFileAtomic(abs, next);
      this.opts.logger?.debug("agents.md updated", { path: abs });
      return true;
    } catch (error) {
      this.opts.logger?.warn("agents.md update failed", { error: String(error) });
      return false;
    }
  }
}
