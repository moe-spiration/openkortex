import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SyncEngine, type SyncEngineEvents, type SyncEngineOptions } from "../src/engine";
import { parseMarkdown } from "../src/frontmatter";
import { InMemoryRemoteStore } from "../src/remote/memory";

export const USER_ID = "11111111-2222-4333-8444-555555555555";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function makeTempVault(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "kortex-vault-"));
}

type Recorded = { [K in keyof SyncEngineEvents]: SyncEngineEvents[K][0][] };

export function recordEvents(engine: SyncEngine): Recorded {
  const names: (keyof SyncEngineEvents)[] = [
    "pulled",
    "pushed",
    "local-removed",
    "remote-removed",
    "conflict",
    "duplicate",
    "ai-memory",
    "local-write",
    "remote-status",
    "reconciled",
    "sync-error",
  ];
  const rec = {} as Record<string, unknown[]>;
  for (const name of names) {
    rec[name] = [];
    engine.on(name, ((e: unknown) => rec[name]?.push(e)) as never);
  }
  return rec as unknown as Recorded;
}

export interface Harness {
  vault: string;
  store: InMemoryRemoteStore;
  engine: SyncEngine;
  events: Recorded;
  abs(rel: string): string;
  read(rel: string): Promise<string>;
  readData(rel: string): Promise<Record<string, unknown>>;
  write(rel: string, text: string, mtime?: Date): Promise<void>;
  /** Let the in-memory "Realtime" deliver and the engine drain its queue. */
  settle(): Promise<void>;
  restart(extra?: Partial<SyncEngineOptions>): Promise<void>;
  cleanup(): Promise<void>;
}

export async function createHarness(
  extra: Partial<SyncEngineOptions> = {},
  existing?: { vault: string; store: InMemoryRemoteStore },
): Promise<Harness> {
  const vault = existing?.vault ?? (await makeTempVault());
  const store = existing?.store ?? new InMemoryRemoteStore(USER_ID);
  const makeEngine = (more: Partial<SyncEngineOptions> = {}) =>
    new SyncEngine({
      vaultPath: vault,
      remote: store,
      watch: false,
      reconcileIntervalMs: 0,
      deleteGraceMs: 30,
      ...extra,
      ...more,
    });

  const h: Harness = {
    vault,
    store,
    engine: makeEngine(),
    events: undefined as unknown as Recorded,
    abs: (rel) => path.join(vault, ...rel.split("/")),
    read: (rel) => readFile(h.abs(rel), "utf8"),
    readData: async (rel) => parseMarkdown(await h.read(rel)).data,
    async write(rel, text, mtime) {
      await mkdir(path.dirname(h.abs(rel)), { recursive: true });
      await writeFile(h.abs(rel), text, "utf8");
      if (mtime) await utimes(h.abs(rel), mtime, mtime);
    },
    async settle() {
      for (let i = 0; i < 3; i++) {
        await sleep(15);
        await h.engine.idle();
      }
    },
    async restart(more = {}) {
      await h.engine.stop();
      h.engine = makeEngine(more);
      h.events = recordEvents(h.engine);
      await h.engine.start();
      await h.settle();
    },
    async cleanup() {
      await h.engine.stop();
      await rm(vault, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
  h.events = recordEvents(h.engine);
  return h;
}

/** Hand-written note like a user would create in Obsidian. */
export const note = (body: string, fm: Record<string, string> = {}) => {
  const keys = Object.entries(fm);
  const head = keys.length ? `---\n${keys.map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n` : "";
  return `${head}${body}\n`;
};
