import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDropzoneConfig } from "../src/config";
import { Dropzone } from "../src/dropzone";
import { exists } from "../src/fs-utils";
import { InMemoryDropzoneStore } from "../src/remote/dropzone-memory";
import { DROPZONE_FOLDER } from "../src/vault-layout";
import { makeTempVault } from "./helpers";

// Real chokidar on a temp vault, in-memory remote, no AI calls.
describe("dropzone", () => {
  let vault: string;
  let store: InMemoryDropzoneStore;
  let zone: Dropzone;
  const wait = { timeout: 10_000, interval: 50 };
  const drop = (rel: string) => path.join(vault, DROPZONE_FOLDER, rel);
  const today = new Date().toISOString().slice(0, 10);

  const start = async (extra: Partial<ConstructorParameters<typeof Dropzone>[0]> = {}) => {
    zone = await new Dropzone({
      vaultPath: vault,
      store,
      stabilityMs: 100,
      retryDelayMs: 0,
      ...extra,
    }).start();
    return zone;
  };

  beforeEach(async () => {
    vault = await makeTempVault();
    store = new InMemoryDropzoneStore();
  });
  afterEach(async () => {
    await zone?.stop();
    await rm(vault, { recursive: true, force: true });
  });

  it("creates the folder and turns a dropped file into one item, archived under .processed", async () => {
    await start();
    expect(await exists(drop(""))).toBe(true);
    await writeFile(drop("paper.pdf"), "%PDF-1.4 hello");
    await vi.waitFor(() => expect(zone.stats.processed).toBe(1), wait);
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({ type: "pdf", title: "paper", file_name: "paper.pdf" });
    expect(store.items[0]?.content_hash).toMatch(/^file:[0-9a-f]{64}$/);
    expect(await exists(drop("paper.pdf"))).toBe(false);
    expect(await readFile(drop(`.processed/${today}/paper.pdf`), "utf8")).toBe("%PDF-1.4 hello");
  });

  it("the same bytes twice give one item; the duplicate is archived too", async () => {
    await start();
    await writeFile(drop("a.png"), "same-bytes");
    await vi.waitFor(() => expect(zone.stats.processed).toBe(1), wait);
    await writeFile(drop("copy of a.png"), "same-bytes");
    await vi.waitFor(() => expect(zone.stats.duplicates).toBe(1), wait);
    expect(store.items).toHaveLength(1);
    expect(await exists(drop("copy of a.png"))).toBe(false);
    expect((await readdir(drop(`.processed/${today}`))).sort()).toEqual(["a.png", "copy of a.png"]);
  });

  it("picks up files that were dropped while the daemon was off", async () => {
    await mkdir(drop(""), { recursive: true });
    await writeFile(drop("old.epub"), "epub bytes");
    await start();
    await vi.waitFor(() => expect(zone.stats.processed).toBe(1), wait);
    expect(store.items[0]?.type).toBe("epub");
  });

  it("retries a flaky hand-over and succeeds", async () => {
    store.failNext = 2;
    await start();
    await writeFile(drop("flaky.jpg"), "jpeg");
    await vi.waitFor(() => expect(zone.stats.processed).toBe(1), wait);
    expect(store.calls).toBe(3);
    expect(zone.stats.failed).toBe(0);
  });

  it("moves a file to .failed with an .error.txt when the hand-over keeps failing", async () => {
    store.failNext = 99;
    await start({ attempts: 2 });
    await writeFile(drop("broken.pdf"), "x-bytes");
    await vi.waitFor(() => expect(zone.stats.failed).toBe(1), wait);
    expect(store.items).toHaveLength(0);
    expect(await exists(drop("broken.pdf"))).toBe(false);
    expect(await readFile(drop(".failed/broken.pdf"), "utf8")).toBe("x-bytes");
    expect(await readFile(drop(".failed/broken.pdf.error.txt"), "utf8")).toContain("remote unavailable");
  });

  it("refuses disallowed types and oversize files into .failed (never deletes)", async () => {
    await start({ extensions: ["pdf"], maxBytes: 10 });
    await writeFile(drop("tool.exe"), "binary");
    await writeFile(drop("big.pdf"), "0123456789ABCDEF");
    await vi.waitFor(() => expect(zone.stats.failed).toBe(2), wait);
    expect(store.calls).toBe(0);
    expect(await readFile(drop(".failed/tool.exe.error.txt"), "utf8")).toContain("not allowed");
    expect(await readFile(drop(".failed/big.pdf.error.txt"), "utf8")).toContain("larger than the limit");
    expect(await exists(drop(".failed/big.pdf"))).toBe(true);
  });

  it("leaves Markdown and temporary files alone", async () => {
    await start();
    await writeFile(drop("note.md"), "# a note\n");
    await writeFile(drop("download.crdownload"), "partial");
    await new Promise((r) => setTimeout(r, 800));
    expect(store.calls).toBe(0);
    expect(await exists(drop("note.md"))).toBe(true);
    expect(await exists(drop("download.crdownload"))).toBe(true);
  });

  it("holds files back while the daily AI budget is used up", async () => {
    let exceeded = true;
    const ledger = {
      status: async () => ({ exceeded }) as never,
      record: async () => {},
    };
    await start({ ledger, budgetRetryMs: 300 });
    await writeFile(drop("later.pdf"), "pdf bytes");
    await new Promise((r) => setTimeout(r, 600));
    expect(store.calls).toBe(0);
    expect(await exists(drop("later.pdf"))).toBe(true);
    exceeded = false;
    await vi.waitFor(() => expect(zone.stats.processed).toBe(1), wait);
  });

  it("keeps a file in place when the store says 'later' (offline, budget, token), never .failed", async () => {
    const { DropzonePostponeError } = await import("../src/remote/dropzone-store");
    let later = true;
    let calls = 0;
    const flaky = {
      submit: async (f: Parameters<InMemoryDropzoneStore["submit"]>[0]) => {
        calls++;
        if (later) throw new DropzonePostponeError("HTTP 429: Tagesbudget erreicht");
        return store.submit(f);
      },
    };
    await start({ store: flaky, budgetRetryMs: 300 });
    await writeFile(drop("offline.pdf"), "pdf bytes");
    await vi.waitFor(() => expect(calls).toBe(1), wait); // no retry storm, one call
    expect(await exists(drop("offline.pdf"))).toBe(true);
    expect(await exists(drop(".failed/offline.pdf"))).toBe(false);
    later = false;
    await vi.waitFor(() => expect(zone.stats.processed).toBe(1), wait);
    expect(zone.stats.failed).toBe(0);
  });
});

describe("readDropzoneConfig", () => {
  it("has sane defaults and can be configured", () => {
    const d = readDropzoneConfig({});
    expect(d).toMatchObject({ enabled: true, maxBytes: 50 * 1024 * 1024 });
    expect(d.extensions).toContain("pdf");
    expect(d.extensions).toContain("eml");
    const c = readDropzoneConfig({
      KORTEX_SYNC_DROPZONE_MAX_MB: "2",
      KORTEX_SYNC_DROPZONE_TYPES: ".PDF, mp3,md",
    });
    expect(c.maxBytes).toBe(2 * 1024 * 1024);
    expect(c.extensions).toEqual(["pdf", "mp3"]);
    expect(readDropzoneConfig({ KORTEX_SYNC_DROPZONE: "0" }).enabled).toBe(false);
  });
});
