import { EventEmitter } from "node:events";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { UsageLedger } from "@kortex/ai-core";
import { fileHash } from "@kortex/db";
import { DEFAULT_DROPZONE_EXTENSIONS } from "./config";
import { exists, renameWithRetry } from "./fs-utils";
import { silentLogger, type Logger } from "./logger";
import { DropzonePostponeError, mimeForUpload, type DropzoneStore } from "./remote/dropzone-store";
import { DROPZONE_FAILED_DIR, DROPZONE_FOLDER, DROPZONE_PROCESSED_DIR } from "./vault-layout";
import { toAbs } from "./paths";

/*
 * Dropzone (S9): every non-Markdown file dropped into <vault>/00_Inbox/Dropzone/ is handed to
 * Kortex once it is stable on disk (chokidar awaitWriteFinish): bytes -> Storage + inbox item +
 * ingest job (see remote/dropzone-store.ts); OCR, transcript and the organizer run in the
 * pipeline afterwards. Handled files are MOVED (never deleted):
 *   ok / duplicate -> .processed/YYYY-MM-DD/<name>
 *   error          -> .failed/<name> + <name>.error.txt
 */

export interface DropzoneOptions {
  vaultPath: string;
  store: DropzoneStore;
  /** Allowed extensions (lower case, no dot). Default: DEFAULT_DROPZONE_EXTENSIONS. */
  extensions?: readonly string[];
  /** Larger files go to `.failed`. Default 50 MiB (same cap as POST /api/ingest). */
  maxBytes?: number;
  /** Daily AI budget gate: exceeded = files stay where they are and are retried later. */
  ledger?: UsageLedger;
  budgetRetryMs?: number;
  /** Tries per file for hand-over errors before it goes to `.failed`. Default 3. */
  attempts?: number;
  retryDelayMs?: number;
  /** Quiet period before a file counts as written (awaitWriteFinish). Default 1500 ms. */
  stabilityMs?: number;
  usePolling?: boolean;
  logger?: Logger;
  now?: () => Date;
}

export interface DropzoneStats {
  processed: number;
  duplicates: number;
  failed: number;
  pending: number;
}

export interface DropzoneEvents {
  handled: [{ rel: string; outcome: "created" | "duplicate" | "failed"; itemId?: string; error?: string }];
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
/** Partial downloads, office lock files, OS metadata: never a drop. */
const TRANSIENT = /(^~\$|\.(tmp|crdownload|part|partial|download|opdownload|swp)$|^(thumbs\.db|desktop\.ini)$)/i;
const MARKDOWN = /\.(md|markdown)$/i;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = (d: Date) => d.toISOString().slice(0, 10);

export class Dropzone extends EventEmitter<DropzoneEvents> {
  readonly dir: string;
  private readonly log: Logger;
  private readonly now: () => Date;
  private readonly extensions: ReadonlySet<string>;
  private watcher: FSWatcher | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly seen = new Set<string>();
  private readonly postponed = new Set<string>();
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private stopped = false;
  private count = { processed: 0, duplicates: 0, failed: 0 };

  constructor(private readonly o: DropzoneOptions) {
    super();
    this.dir = toAbs(o.vaultPath, DROPZONE_FOLDER);
    this.log = o.logger ?? silentLogger;
    this.now = o.now ?? (() => new Date());
    this.extensions = new Set(
      (o.extensions ?? DEFAULT_DROPZONE_EXTENSIONS).map((e) => e.replace(/^\./, "").toLowerCase()),
    );
  }

  get stats(): DropzoneStats {
    return { ...this.count, pending: this.pending };
  }

  /** Creates the folder if needed, then watches it; files already lying there are picked up too. */
  async start(): Promise<this> {
    await mkdir(this.dir, { recursive: true });
    const w = watch(this.dir, {
      ignoreInitial: false,
      persistent: true,
      depth: 5,
      usePolling: this.o.usePolling ?? false,
      awaitWriteFinish: { stabilityThreshold: this.o.stabilityMs ?? 1500, pollInterval: 100 },
      ignored: (abs) => path.relative(this.dir, abs).split(path.sep).some((s) => s.startsWith(".")),
    });
    w.on("add", (abs) => this.enqueue(abs));
    w.on("change", (abs) => this.enqueue(abs));
    w.on("error", (e) => this.log.warn("dropzone watcher error", { error: errText(e) }));
    this.watcher = w;
    await new Promise<void>((resolve) => w.once("ready", () => resolve()));
    this.log.info("dropzone watching", { dir: this.dir });
    return this;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    await this.watcher?.close();
    await this.idle();
  }

  /** Resolves once every queued file has been handled (tests). */
  async idle(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.tail;
      await current;
    } while (current !== this.tail);
  }

  private enqueue(abs: string): void {
    const name = path.basename(abs);
    if (this.stopped || MARKDOWN.test(name) || TRANSIENT.test(name) || this.seen.has(abs)) return;
    this.seen.add(abs);
    this.pending++;
    this.tail = this.tail.then(async () => {
      try {
        await this.handle(abs);
      } catch (error) {
        this.log.error("dropzone file crashed", { file: abs, error: errText(error) });
      } finally {
        this.seen.delete(abs);
        this.pending--;
      }
    });
  }

  private async handle(abs: string): Promise<void> {
    const rel = path.relative(this.dir, abs).split(path.sep).join("/");
    if (!(await exists(abs))) return; // moved or removed meanwhile
    try {
      const budget = await this.o.ledger?.status();
      if (budget?.exceeded) {
        this.log.warn("dropzone postponed: daily AI budget reached", { file: rel });
        this.scheduleRescan(abs);
        return;
      }
      const ext = path.extname(abs).slice(1).toLowerCase();
      if (!this.extensions.has(ext)) throw new Error(`file type ".${ext}" is not allowed in the dropzone`);
      const size = (await stat(abs)).size;
      const max = this.o.maxBytes ?? DEFAULT_MAX_BYTES;
      if (size > max) throw new Error(`file is ${size} bytes, larger than the limit of ${max} bytes`);
      if (size === 0) throw new Error("file is empty");

      const bytes = new Uint8Array(await readFile(abs));
      const hash = await fileHash(bytes);
      const name = path.basename(abs);
      const result = await this.submitWithRetry({ name, mimeType: mimeForUpload(name), bytes, hash });
      await this.archive(abs, DROPZONE_PROCESSED_DIR, day(this.now()));
      if (result.status === "created") this.count.processed++;
      else this.count.duplicates++;
      this.log.info(`dropzone ${result.status}`, { file: rel, item: result.itemId });
      this.emit("handled", { rel, outcome: result.status, itemId: result.itemId });
    } catch (error) {
      if (error instanceof DropzonePostponeError) {
        this.log.warn("dropzone postponed", { file: rel, reason: errText(error) });
        this.scheduleRescan(abs);
        return;
      }
      const message = errText(error);
      this.log.warn("dropzone file failed", { file: rel, error: message });
      try {
        const moved = await this.archive(abs, DROPZONE_FAILED_DIR);
        await writeFile(`${moved}.error.txt`, `${this.now().toISOString()}\n${message}\n`, "utf8");
      } catch (moveError) {
        this.log.error("dropzone could not move failed file", { file: rel, error: errText(moveError) });
      }
      this.count.failed++;
      this.emit("handled", { rel, outcome: "failed", error: message });
    }
  }

  private async submitWithRetry(file: Parameters<DropzoneStore["submit"]>[0]) {
    const attempts = Math.max(1, this.o.attempts ?? 3);
    for (let i = 1; ; i++) {
      try {
        return await this.o.store.submit(file);
      } catch (error) {
        if (i >= attempts || error instanceof DropzonePostponeError) throw error;
        this.log.warn("dropzone hand-over failed, retrying", { file: file.name, attempt: i, error: errText(error) });
        await sleep(this.o.retryDelayMs ?? 2000);
      }
    }
  }

  /** Moves into `<dropzone>/<dir>[/<sub>]/`, never overwriting. Returns the new absolute path. */
  private async archive(abs: string, dir: string, sub?: string): Promise<string> {
    const targetDir = sub ? path.join(this.dir, dir, sub) : path.join(this.dir, dir);
    await mkdir(targetDir, { recursive: true });
    const ext = path.extname(abs);
    const stem = path.basename(abs, ext);
    let target = path.join(targetDir, `${stem}${ext}`);
    for (let n = 1; await exists(target); n++) target = path.join(targetDir, `${stem} (${n})${ext}`);
    await renameWithRetry(abs, target);
    return target;
  }

  private scheduleRescan(abs: string): void {
    this.postponed.add(abs);
    if (this.retryTimer || this.stopped) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      const files = [...this.postponed];
      this.postponed.clear();
      for (const f of files) this.enqueue(f);
    }, this.o.budgetRetryMs ?? 60 * 60_000);
  }
}
