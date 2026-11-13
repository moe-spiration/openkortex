import { describe, expect, it } from "vitest";
import { applyHabitDefs, DEFAULT_HABITS, habitDefs, habitKey, HabitsSchema } from "./habits";
import { checkUserSettingsPatch } from "./patch";
import { relativeTime, vaultView, type SyncStatusRow } from "./sync-status";

const NOW = new Date("2026-10-27T10:00:00Z");
const row = (o: Partial<SyncStatusRow> = {}): SyncStatusRow => ({
  device_id: "pc.1234abcd",
  device_name: "PC",
  vault_path: "C:/Users/max/KortexVault",
  daemon_version: "0.0.0",
  state: "running",
  realtime: "connected",
  last_heartbeat_at: "2026-10-27T09:59:30Z",
  last_sync_at: "2026-10-27T09:18:00Z",
  last_success_at: "2026-10-27T09:40:00Z",
  last_error: null,
  last_error_at: null,
  pending_local: 0,
  pending_ingest: 2,
  items_tracked: 40,
  sync_requested_at: null,
  sync_handled_at: null,
  ...o,
});

describe("vaultView", () => {
  it("shows the newest device as online with path, last sync and pending work", () => {
    const v = vaultView([row({ device_id: "old", last_heartbeat_at: "2026-10-20T08:00:00Z" }), row()], NOW, "Europe/Berlin");
    expect(v).toMatchObject({ known: true, online: true, deviceId: "pc.1234abcd", vaultPath: "C:/Users/max/KortexVault", lastSync: "heute 10:40", pending: 2 });
    expect(v.pendingText).toBe("2 in KI-Anreicherung");
  });

  it("is offline after three missed beats or when stopped", () => {
    expect(vaultView([row({ last_heartbeat_at: "2026-10-27T09:56:00Z" })], NOW).online).toBe(false);
    expect(vaultView([row({ state: "stopped" })], NOW).online).toBe(false);
    expect(vaultView([], NOW)).toMatchObject({ known: false, online: false, lastSync: "–" });
  });

  it("tracks open sync requests and recent errors", () => {
    expect(vaultView([row({ sync_requested_at: "2026-10-27T09:59:00Z" })], NOW).requestOpen).toBe(true);
    expect(vaultView([row({ sync_requested_at: "2026-10-27T09:59:00Z", sync_handled_at: "2026-10-27T09:59:05Z" })], NOW).requestOpen).toBe(false);
    expect(vaultView([row({ last_error: "push: x", last_error_at: "2026-10-27T09:50:00Z" })], NOW).error).toBe("push: x");
    expect(vaultView([row({ last_error: "old", last_error_at: "2026-10-27T09:00:00Z" })], NOW).error).toBeNull();
  });

  it("formats relative times", () => {
    expect(relativeTime("2026-10-26T20:05:00Z", NOW, "Europe/Berlin")).toBe("gestern 21:05");
    expect(relativeTime(null, NOW)).toBe("–");
  });
});

describe("habits", () => {
  it("falls back to the defaults and validates the list", () => {
    expect(habitDefs(null)).toEqual(DEFAULT_HABITS);
    expect(habitDefs([{ key: "x" }])).toEqual(DEFAULT_HABITS);
    expect(HabitsSchema.safeParse([{ key: "a", label: "A" }, { key: "a", label: "B" }]).success).toBe(false);
    expect(HabitsSchema.safeParse(Array.from({ length: 13 }, (_, i) => ({ key: `h${i}`, label: "x" }))).success).toBe(false);
  });

  it("makes unique keys from labels", () => {
    expect(habitKey("Täglich 10.000 Schritte!", [])).toBe("taglich-10-000-schritte");
    expect(habitKey("Lesen", ["lesen", "lesen-2"])).toBe("lesen-3");
    expect(habitKey("💧", [])).toBe("habit");
  });

  it("keeps done-state by key in definition order", () => {
    const day = [
      { key: "mob", label: "Morning Mobility", done: true },
      { key: "carb", label: "Low-Carb", done: false },
    ];
    expect(applyHabitDefs(day, [{ key: "read", label: "Lesen" }, { key: "mob", label: "Mobility" }])).toEqual([
      { key: "read", label: "Lesen", done: false },
      { key: "mob", label: "Mobility", done: true },
    ]);
  });

  it("is writable through the settings patch, locale too", () => {
    expect(checkUserSettingsPatch({ habits: [{ key: "run", label: "Laufen" }], locale: "en" }).ok).toBe(true);
    expect(checkUserSettingsPatch({ locale: "fr" }).ok).toBe(false);
    expect(checkUserSettingsPatch({ habits: [{ key: "Bad Key", label: "x" }] }).ok).toBe(false);
  });
});

describe("dropzonePath", () => {
  it("keeps the vault's separator", async () => {
    const { dropzonePath } = await import("./sync-status");
    expect(dropzonePath("C:\\Users\\max\\KortexVault")).toBe("C:\\Users\\max\\KortexVault\\00_Inbox\\Dropzone");
    expect(dropzonePath("C:\\Users\\max\\KortexVault\\")).toBe("C:\\Users\\max\\KortexVault\\00_Inbox\\Dropzone");
    expect(dropzonePath("/home/max/KortexVault/")).toBe("/home/max/KortexVault/00_Inbox/Dropzone");
  });
});
