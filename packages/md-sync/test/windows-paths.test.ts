import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { plainWindowsPath, readConfig } from "../src/config";
import { Dropzone } from "../src/dropzone";
import { InMemoryDropzoneStore } from "../src/remote/dropzone-memory";
import { DROPZONE_FOLDER } from "../src/vault-layout";

const run = promisify(execFile);
const TOKEN = `kx_${"a".repeat(43)}`;
const win = process.platform === "win32";

// 0.6.0 device test: the desktop sidecar crashed at once with `EISDIR: lstat 'C:'` because the
// app handed Node a `\\?\C:\...` path; the user's vault sits in "OneDrive\My Files\Kortex Vault".
describe("Windows paths (desktop sidecar)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });
  const tempWithSpaces = async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kortex paths "));
    dirs.push(root);
    const dir = path.join(root, "OneDrive", "My Files", "Kortex Vault");
    await mkdir(dir, { recursive: true });
    return dir;
  };

  it("drops the extended-length prefix and keeps spaces", () => {
    expect(plainWindowsPath("\\\\?\\C:\\Users\\max\\OneDrive\\My Files\\Kortex Vault")).toBe(
      "C:\\Users\\max\\OneDrive\\My Files\\Kortex Vault",
    );
    expect(plainWindowsPath("\\\\?\\UNC\\nas\\share\\Vault")).toBe("\\\\nas\\share\\Vault");
    expect(plainWindowsPath("C:\\Users\\x\\Kortex Vault")).toBe("C:\\Users\\x\\Kortex Vault");
    expect(plainWindowsPath("/home/x/Kortex Vault")).toBe("/home/x/Kortex Vault");
    expect(plainWindowsPath("\\\\?\\Volume{1}\\x")).toBe("\\\\?\\Volume{1}\\x");
  });

  it.runIf(win)("readConfig turns a \\\\?\\ vault path with spaces into a plain one", () => {
    const cfg = readConfig({
      KORTEX_VAULT_PATH: "\\\\?\\C:\\Users\\max\\OneDrive\\My Files\\Kortex Vault",
      KORTEX_SYNC_TOKEN: TOKEN,
      KORTEX_API_URL: "https://kortex.example.com",
    });
    expect(cfg.vaultPath).toBe("C:\\Users\\max\\OneDrive\\My Files\\Kortex Vault");
  });

  it.runIf(win)("node starts a script from a plain path with spaces, not from its \\\\?\\ form", async () => {
    const dir = await tempWithSpaces();
    const script = path.join(dir, "md-sync.mjs");
    await writeFile(script, "console.log('ok ' + process.argv[1]);\n");
    const { stdout } = await run(process.execPath, [script], { cwd: dir });
    expect(stdout).toContain("My Files");
    // The cause of the 0.6.0 crash, kept as a check on our reading of it.
    const verbatim = await run(process.execPath, [`\\\\?\\${script}`], { cwd: dir }).then(
      () => "started",
      (e: { stderr?: string }) => e.stderr ?? "",
    );
    if (verbatim !== "started") expect(verbatim).toMatch(/EISDIR|lstat/);
  });

  it("the Dropzone in a vault path with spaces takes a dropped file", async () => {
    const vault = await tempWithSpaces();
    const store = new InMemoryDropzoneStore();
    const zone = await new Dropzone({ vaultPath: vault, store, stabilityMs: 100, retryDelayMs: 0 }).start();
    try {
      await writeFile(path.join(vault, DROPZONE_FOLDER, "Rechnung März 2026.pdf"), "%PDF-1.4 x");
      await vi.waitFor(() => expect(zone.stats.processed).toBe(1), { timeout: 10_000, interval: 50 });
      expect(store.items[0]).toMatchObject({ type: "pdf", file_name: "Rechnung März 2026.pdf" });
    } finally {
      await zone.stop();
    }
  });
});
