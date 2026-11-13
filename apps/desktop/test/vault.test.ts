import { describe, expect, it } from "vitest";
import { createMockBridge } from "@/bridge/mock";
import type { VaultStatus } from "@/bridge/contract";
import { chipOf, detailOf, folderNote, hintOf, since } from "@/windows/VaultSettings";

const NOW = new Date("2026-11-03T14:00:00Z");
const base = (over: Partial<VaultStatus> = {}): VaultStatus => ({
  state: "running",
  vault_path: "C:\\Users\\Du\\KortexVault",
  dropzone_path: "C:\\Users\\Du\\KortexVault\\00_Inbox\\Dropzone",
  default_path: "C:\\Users\\Du\\KortexVault",
  setup_done: true,
  enabled: true,
  realtime: "connected",
  last_sync_at: "2026-11-03T13:55:00Z",
  last_success_at: "2026-11-03T13:55:00Z",
  last_error: null,
  pending_local: 0,
  items_tracked: 128,
  dropzone: { processed: 0, duplicates: 0, failed: 0, pending: 0 },
  message: null,
  version: "0.6.0",
  at: "2026-11-03T13:59:00Z",
  log_line: null,
  ...over,
});

describe("vault status texts (Einstellungen → Vault-Ordner)", () => {
  it("shows the real state, never a fixed 'Synchron'", () => {
    expect(chipOf(base()).text).toBe("Synchron");
    expect(chipOf(base({ last_error: "push x.md: 500" })).text).toBe("Mit Fehlern");
    expect(chipOf(base({ realtime: "disconnected" })).text).toBe("Offline, wartet");
    expect(chipOf(base({ state: "starting" })).busy).toBe(true);
    expect(chipOf(base({ state: "setup" })).text).toBe("Nicht eingerichtet");
    expect(chipOf(base({ state: "no_sync_token" })).text).toBe("Nicht verbunden");
    expect(chipOf(base({ state: "error" })).text).toBe("Fehler");
    expect(chipOf(base({ state: "off" })).text).toBe("Aus");
  });

  it("explains the last sync or why it does not run", () => {
    expect(detailOf(base(), NOW)).toBe("Letzter Sync vor 5 Min. · 128 Dateien");
    expect(detailOf(base({ pending_local: 51 }), NOW)).toContain("51 Löschungen zurückgehalten");
    expect(detailOf(base({ state: "error", message: "Der Server kennt den Vault-Sync noch nicht" }), NOW)).toContain("Server");
    expect(detailOf(base({ state: "off" }), NOW)).toContain("ausgeschaltet");
  });

  it("explains a crash with its log line in plain words", () => {
    const crash = base({ state: "error", message: "md-sync beendet (Code 1). Neuer Versuch in 15 s.", log_line: "Error: EISDIR: illegal operation on a directory, lstat 'C:'" });
    expect(hintOf(crash)).toMatch(/Installation/);
    expect(hintOf(base({ state: "error", log_line: "Error: EBUSY: resource busy or locked, rename 'x.md'" }))).toMatch(/OneDrive|gesperrt/);
    expect(hintOf(base({ state: "error", log_line: "TypeError: fetch failed" }))).toMatch(/Server nicht erreichbar/);
    expect(hintOf(base({ state: "error", log_line: "something else" }))).toBeNull();
    expect(hintOf(base({ log_line: "Error: EISDIR" }))).toBeNull(); // only for errors
  });

  it("relative times", () => {
    expect(since(null, NOW)).toBe("–");
    expect(since("2026-11-03T13:59:40Z", NOW)).toBe("gerade eben");
    expect(since("2026-11-03T13:20:00Z", NOW)).toBe("vor 40 Min.");
    expect(since("2026-11-03T08:00:00Z", NOW)).toMatch(/^heute \d\d:\d\d$/);
  });

  it("says what a picked folder means before anything happens", () => {
    const c = { path: "D:\\Notizen", exists: true, empty: false, kortex_vault: false, entries: 14, md_at_root: 3, refused: null, needs_confirm: true };
    expect(folderNote(c)).toMatch(/14 Einträge.*3 Markdown-Dateien.*Gelöscht wird nichts/);
    expect(folderNote({ ...c, md_at_root: 1 })).toMatch(/1 Markdown-Datei aus/);
    expect(folderNote({ ...c, kortex_vault: true, needs_confirm: false })).toMatch(/Vorhandener Kortex-Vault/);
    expect(folderNote({ ...c, exists: false, empty: true, entries: 0, needs_confirm: false })).toMatch(/Neuer Ordner/);
    expect(folderNote({ ...c, refused: "Ein ganzes Laufwerk kann kein Vault sein." })).toMatch(/Laufwerk/);
  });
});

describe("vault sync in the mock core (browser preview)", () => {
  it("first run → folder chosen → running, with events", async () => {
    const b = createMockBridge();
    const seen: string[] = [];
    b.listen("vault:status", (s) => seen.push(s.state));
    const s0 = await b.invoke("vault_status");
    expect(s0.state).toBe("setup");
    expect(s0.default_path).toMatch(/KortexVault$/);
    const s1 = await b.invoke("vault_set_folder", { path: s0.default_path, confirm: false });
    expect(s1.state).toBe("starting");
    expect(s1.dropzone_path).toMatch(/00_Inbox\\Dropzone$/);
    await new Promise((r) => setTimeout(r, 800));
    expect((await b.invoke("vault_status")).state).toBe("running");
    expect(seen).toContain("running");
    expect((await b.invoke("vault_set_enabled", { enabled: false })).state).toBe("off");
    b.dispose();
  });

  it("a foreign non-empty folder needs confirm, a drive root is refused", async () => {
    const b = createMockBridge();
    const picked = await b.invoke("vault_pick_folder");
    expect(picked?.needs_confirm).toBe(true);
    await expect(b.invoke("vault_set_folder", { path: picked!.path, confirm: false })).rejects.toMatch(/not empty/);
    expect((await b.invoke("vault_set_folder", { path: picked!.path, confirm: true })).vault_path).toBe(picked!.path);
    await expect(b.invoke("vault_set_folder", { path: "C:\\", confirm: true })).rejects.toMatch(/whole drive/);
    b.dispose();
  });
});
