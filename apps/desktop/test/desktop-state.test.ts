import { describe, expect, it } from "vitest";
import { createMockBridge, MOCK_VAULT } from "@/bridge/mock";
import { trayStatus } from "@/data";
import { DEFAULT_DEVICE, devicesFrom } from "@/state/desktop";
import { meetingStatus } from "@/state/meeting";

const EMPTY = { mic: 0, out: 0, mics: [DEFAULT_DEVICE], outs: [DEFAULT_DEVICE] };

describe("audio devices (Audio-Setup)", () => {
  it("puts the Windows default first and selects nothing else without a remembered choice", () => {
    const s = devicesFrom(EMPTY, { inputs: ["Mikrofon A", "Headset"], outputs: ["Lautsprecher"] });
    expect(s.mics).toEqual([DEFAULT_DEVICE, "Mikrofon A", "Headset"]);
    expect(s.outs).toEqual([DEFAULT_DEVICE, "Lautsprecher"]);
    expect([s.mic, s.out]).toEqual([0, 0]);
  });

  it("selects the remembered devices and keeps an unplugged one visible", () => {
    const s = devicesFrom(EMPTY, { inputs: ["Mikrofon A", "Headset"], outputs: ["Lautsprecher"], input: "Headset", output: "USB-Dock" });
    expect(s.mics[s.mic]).toBe("Headset");
    expect(s.outs).toEqual([DEFAULT_DEVICE, "Lautsprecher", "USB-Dock"]);
    expect(s.outs[s.out]).toBe("USB-Dock");
  });

  it("the mock core remembers the choice like desktop.json does", async () => {
    const b = createMockBridge();
    await b.invoke("select_audio_device", { kind: "input", name: "Headset-Mikrofon (Jabra Evolve2)" });
    expect((await b.invoke("list_audio_devices")).input).toBe("Headset-Mikrofon (Jabra Evolve2)");
    await b.invoke("select_audio_device", { kind: "input", name: "" });
    expect((await b.invoke("list_audio_devices")).input).toBeNull();
    b.dispose();
  });
});

describe("settings shared across windows", () => {
  it("broadcasts stealth so every window shows the core's state, and reports autostart", async () => {
    const b = createMockBridge();
    const seen: boolean[] = [];
    b.listen("settings:stealth", ({ enabled }) => seen.push(enabled));
    expect((await b.invoke("get_meeting_state")).stealth).toBe(true);
    await b.invoke("set_stealth", { enabled: false });
    expect(seen).toEqual([false]);
    expect((await b.invoke("get_meeting_state")).stealth).toBe(false);
    expect(await b.invoke("get_autostart")).toBe(false);
    expect(await b.invoke("set_autostart", { enabled: true })).toBe(true);
    expect(await b.invoke("get_autostart")).toBe(true);
    b.dispose();
  });
});

describe("Meeting-Center and tray texts", () => {
  it("says what happens with the meeting, depending on account and session", () => {
    expect(meetingStatus(false, false, "none", null)).toMatch(/lokal/);
    expect(meetingStatus(true, false, "none", null)).toMatch(/20_Meetings/);
    expect(meetingStatus(true, true, "connecting", null)).toMatch(/Verbindet/);
    expect(meetingStatus(true, true, "offline", null)).toMatch(/nach dem Meeting/);
    expect(meetingStatus(true, true, "live", "Deepgram nicht erreichbar, weiter über Dein Kortex-Routing")).toMatch(/Kortex-Routing/);
  });

  it("shows the real state in the tray header instead of a fixed text", () => {
    expect(trayStatus({ connected: false, live: false, clock: "00:00", session: "none" })).toMatch(/Kein Konto/);
    expect(trayStatus({ connected: true, live: false, clock: "00:00", session: "none" })).toBe("Konto verbunden · bereit");
    expect(trayStatus({ connected: true, live: true, clock: "12:04", session: "live" })).toBe("Aufnahme läuft · 12:04 · Live-Sync");
  });

  it("lists the latest meetings from the vault (launcher_search type meeting)", async () => {
    const b = createMockBridge();
    const r = await b.invoke("launcher_search", { q: "", kind: "meeting", limit: 8 });
    expect(r.results.map((h) => h.type)).toEqual(MOCK_VAULT.filter((h) => h.type === "meeting").map(() => "meeting"));
    expect(r.results.length).toBeGreaterThan(0);
    b.dispose();
  });
});
