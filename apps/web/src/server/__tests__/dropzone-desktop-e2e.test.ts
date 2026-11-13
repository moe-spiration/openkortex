import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateToken, hashToken } from "../auth/api-tokens/secret";
import { createIngestHandlers } from "../ingest/handler";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, NOW, seedFolders, setup, USER_ID } from "./helpers";

/*
 * Dropzone of the Windows app from end to end (0.6.0 device test: "Dropzone-Sync funktioniert
 * nicht"): a file dropped into <vault>/00_Inbox/Dropzone is picked up by md-sync's real Dropzone
 * (chokidar on disk), sent by its ApiDropzoneStore with the user's kx_ token as multipart to THIS
 * web handler of POST /api/ingest, and ends as the user's knowledge item; the file is archived
 * under .processed and the counters feed the status line the desktop parses.
 * The vault lies in a path with spaces like the user's "OneDrive\00 My OS\10 KortexVault".
 * md-sync is loaded by path (it is no dependency of the web app).
 */
const MD_SYNC = (f: string) => fileURLToPath(new URL(`../../../../../packages/md-sync/src/${f}`, import.meta.url));
interface DropzoneLike {
  stats: { processed: number; duplicates: number; failed: number; pending: number };
  start(): Promise<DropzoneLike>;
  stop(): Promise<void>;
}
type DropzoneCtor = new (o: Record<string, unknown>) => DropzoneLike;
type StoreCtor = new (apiUrl: string, token: string, fetchFn: typeof fetch) => unknown;
const load = async () => {
  const { Dropzone } = (await import(/* @vite-ignore */ MD_SYNC("dropzone.ts"))) as { Dropzone: DropzoneCtor };
  const { ApiDropzoneStore } = (await import(/* @vite-ignore */ MD_SYNC("remote/api-dropzone-store.ts"))) as { ApiDropzoneStore: StoreCtor };
  const { statusLine } = (await import(/* @vite-ignore */ MD_SYNC("status-line.ts"))) as { statusLine: (k: string, p: Record<string, unknown>) => string };
  return { Dropzone, ApiDropzoneStore, statusLine };
};

describe("desktop Dropzone → POST /api/ingest → knowledge item", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });

  it("turns a dropped file into one inbox item of the token owner; a second copy is a duplicate", async () => {
    const { Dropzone, ApiDropzoneStore, statusLine } = await load();
    const db = new FakeSupabase();
    seedFolders(db);
    const vision = mockModel([{ title_hint: "Rechnung", image_kind: "document", ocr_text: "Rechnung März", description_md: "- Rechnung", todos: [] }]);
    const s = setup({ db, models: mockRouter({ fast: mockModel([]), vision }) });
    const h = createIngestHandlers(() => s.deps);
    // The token "Mit Windows-App verbinden" creates (scopes ingest + sync).
    const token = generateToken();
    db.rows("api_tokens").push({
      id: "tok-1", user_id: USER_ID, name: "Windows-App (PC)", token_hash: hashToken(token), token_prefix: token.slice(0, 11),
      scopes: ["ingest", "sync"], created_at: NOW.toISOString(), last_used_at: null, expires_at: null, revoked_at: null,
    });
    // ApiDropzoneStore's fetch goes straight into the route handler.
    const seen: { auth: string | null; type: string | null }[] = [];
    const fetchIntoRoute = (async (url: string | URL | Request, init?: RequestInit) => {
      const req = new Request(url, init);
      seen.push({ auth: req.headers.get("authorization"), type: req.headers.get("content-type") });
      return h.POST(req);
    }) as typeof fetch;

    const root = await mkdtemp(path.join(tmpdir(), "kx dz e2e "));
    dirs.push(root);
    const vault = path.join(root, "OneDrive", "00 My OS", "10 KortexVault");
    await mkdir(vault, { recursive: true });
    const zone = await new Dropzone({
      vaultPath: vault,
      store: new ApiDropzoneStore("https://kortex.test", token, fetchIntoRoute),
      stabilityMs: 100,
      retryDelayMs: 0,
    }).start();
    try {
      const dir = path.join(vault, "00_Inbox", "Dropzone");
      const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
      await writeFile(path.join(dir, "Rechnung März 2026.png"), png);
      await vi.waitFor(() => expect(zone.stats.processed).toBe(1), { timeout: 15_000, interval: 50 });

      expect(seen[0]?.auth).toBe(`Bearer ${token}`);
      expect(seen[0]?.type).toMatch(/^multipart\/form-data/);
      const items = db.rows("knowledge_items");
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ user_id: USER_ID, type: "image", file_size_bytes: png.length });
      await s.drain();
      expect(s.errors).toEqual([]);
      expect([...db.storage.keys()]).toEqual([`kortex-media/${USER_ID}/${items[0]!.id as string}.png`]);
      expect(db.rows("knowledge_items")[0]!.status).toBe("inbox"); // lands in the Inbox, not as an error
      // The file left the Dropzone and lies under .processed/<day>/ (never deleted).
      expect(await readdir(dir)).toEqual([".processed"]);
      const day = new Date().toISOString().slice(0, 10);
      expect(await readdir(path.join(dir, ".processed", day))).toEqual(["Rechnung März 2026.png"]);

      // Same bytes again: the server dedups, md-sync counts a duplicate, still one item.
      await writeFile(path.join(dir, "Kopie.png"), png);
      await vi.waitFor(() => expect(zone.stats.duplicates).toBe(1), { timeout: 15_000, interval: 50 });
      expect(db.rows("knowledge_items")).toHaveLength(1);

      // The counters reach the desktop as a status line (vault.rs parse_line/apply_status).
      const line = statusLine("status", { state: "running", stats: { dropzone_processed: zone.stats.processed, dropzone_duplicates: zone.stats.duplicates } });
      expect(line).toMatch(/^@@kortex-status \{.*"dropzone_processed":1.*"dropzone_duplicates":1/);
    } finally {
      await zone.stop();
    }
  }, 60_000);
});
