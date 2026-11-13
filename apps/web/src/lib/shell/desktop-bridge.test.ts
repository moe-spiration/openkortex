import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A fake Windows main window: Tauri internals plus window events. */
function fakeWindow(answers: Record<string, unknown>) {
  const target = new EventTarget();
  const invoke = vi.fn(async (cmd: string) => {
    if (!(cmd in answers)) throw new Error(`${cmd} not allowed`);
    return answers[cmd];
  });
  const w = Object.assign(target, { __TAURI_INTERNALS__: { invoke } });
  vi.stubGlobal("window", w);
  return { w, invoke };
}

const load = () => import("./desktop-bridge");
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("desktop bridge (Orbit-Bar ↔ Windows app)", () => {
  it("checks the core's events", async () => {
    const { parseDesktopEvent } = await load();
    expect(parseDesktopEvent({ type: "meeting", recording: true, elapsed: 12 })).toEqual({
      type: "meeting",
      recording: true,
      elapsed: 12,
    });
    expect(
      parseDesktopEvent({ type: "meeting", recording: false, elapsed: 3, uploading: true }),
    ).toMatchObject({ uploading: true });
    expect(parseDesktopEvent({ type: "stop-web-recording" })).toEqual({
      type: "stop-web-recording",
    });
    expect(parseDesktopEvent({ type: "meeting" })).toBeNull();
    expect(parseDesktopEvent({ type: "rm -rf" })).toBeNull();
    expect(parseDesktopEvent(null)).toBeNull();
  });

  it("derives the start time from the core's elapsed seconds", async () => {
    const { meetingFrom } = await load();
    expect(meetingFrom(true, 30, 100_000)).toEqual({ recording: true, startedAt: 70_000 });
    expect(meetingFrom(false, 30, 100_000)).toEqual({ recording: false, startedAt: null });
  });

  it("does nothing in a browser: the web keeps its own microphone recording", async () => {
    vi.stubGlobal("window", new EventTarget());
    const b = await load();
    b.initDesktopBridge()();
    expect(b.desktopRecorderAvailable()).toBe(false);
    b.reportWebRecording(true);
    await expect(b.startDesktopMeeting()).rejects.toThrow();
  });

  it("stays off with a desktop app older than the bridge", async () => {
    fakeWindow({});
    const b = await load();
    const release = b.initDesktopBridge();
    await flush();
    expect(b.desktopRecorderAvailable()).toBe(false);
    release();
  });

  it("starts the native meeting and follows the core's meeting events", async () => {
    const { w, invoke } = fakeWindow({
      main_meeting_state: { recording: false, elapsed: 0 },
      main_start_meeting: { recording: true, elapsed: 0 },
      main_stop_meeting: { uploading: true },
    });
    const b = await load();
    const release = b.initDesktopBridge();
    await flush();
    expect(b.desktopRecorderAvailable()).toBe(true);
    await b.startDesktopMeeting();
    expect(invoke).toHaveBeenCalledWith("main_start_meeting");
    expect(b.desktopMeeting().recording).toBe(true);
    // Stopped elsewhere (HUD pill, tray, auto-stop): the Orbit-Bar follows.
    w.dispatchEvent(
      Object.assign(new Event("kortex:desktop"), {
        detail: { type: "meeting", recording: false, elapsed: 61 },
      }),
    );
    expect(b.desktopMeeting()).toMatchObject({ recording: false, startedAt: null });
    expect(await b.stopDesktopMeeting()).toEqual({ uploading: true });
    release();
  });

  it("reports the web recording once per change and passes the pill's stop on", async () => {
    const { w, invoke } = fakeWindow({
      main_meeting_state: { recording: false, elapsed: 0 },
      main_web_recording: null,
    });
    const b = await load();
    const release = b.initDesktopBridge();
    b.reportWebRecording(true);
    b.reportWebRecording(true);
    b.reportWebRecording(false);
    expect(invoke.mock.calls.filter((c) => c[0] === "main_web_recording")).toEqual([
      ["main_web_recording", { active: true }],
      ["main_web_recording", { active: false }],
    ]);
    const seen = vi.fn();
    const off = b.onDesktopEvent(seen);
    w.dispatchEvent(
      Object.assign(new Event("kortex:desktop"), { detail: { type: "stop-web-recording" } }),
    );
    expect(seen).toHaveBeenCalledWith({ type: "stop-web-recording" });
    off();
    release();
  });
});
