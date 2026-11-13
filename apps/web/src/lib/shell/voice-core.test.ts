import { describe, expect, it, vi } from "vitest";
import { createMicGate, createVoiceSession, type RecorderLike } from "./voice-core";

/** A fake microphone stream whose tracks report whether they were stopped. */
function fakeStream() {
  const track = { stopped: false, stop: vi.fn(() => void (track.stopped = true)) };
  return { track, getTracks: () => [track] };
}
type Fake = ReturnType<typeof fakeStream>;

/** getUserMedia that resolves only when the test says so. */
function deferredMic() {
  const calls: { resolve: (s: Fake) => void; reject: (e: unknown) => void }[] = [];
  const getUserMedia = vi.fn(
    () =>
      new Promise<Fake>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  return { getUserMedia, calls };
}

function fakeRecorder(): RecorderLike & { stop: ReturnType<typeof vi.fn> } {
  const rec: RecorderLike & { stop: ReturnType<typeof vi.fn> } = {
    state: "inactive",
    mimeType: "audio/webm",
    ondataavailable: null,
    onstop: null,
    start: () => void (rec.state = "recording"),
    stop: vi.fn(() => {
      rec.state = "inactive";
      rec.ondataavailable?.({ data: new Blob(["x".repeat(900)]) });
      rec.onstop?.(new Event("stop"));
    }),
  };
  return rec;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function session() {
  const mic = deferredMic();
  const recorders: ReturnType<typeof fakeRecorder>[] = [];
  const deps = {
    mime: "audio/webm",
    getUserMedia: mic.getUserMedia,
    createRecorder: vi.fn(() => {
      const r = fakeRecorder();
      recorders.push(r);
      return r;
    }),
    onStream: vi.fn(),
    onUnsupported: vi.fn(),
    onDenied: vi.fn(),
    onNothingRecorded: vi.fn(),
    onFinished: vi.fn(),
  };
  return { s: createVoiceSession<Fake>(deps), mic, deps, recorders };
}

describe("mic gate (N5 #2)", () => {
  it("stops a stream that arrives after close()", async () => {
    const mic = deferredMic();
    const gate = createMicGate(mic.getUserMedia);
    const onStream = vi.fn();
    gate.open(onStream);
    expect(gate.pending).toBe(true);
    gate.close();
    const late = fakeStream();
    mic.calls[0]!.resolve(late);
    await flush();
    expect(late.track.stopped).toBe(true);
    expect(onStream).not.toHaveBeenCalled();
    expect(gate.stream).toBeNull();
  });

  it("a second open() stops the first request's stream when it arrives", async () => {
    const mic = deferredMic();
    const gate = createMicGate(mic.getUserMedia);
    const onStream = vi.fn();
    gate.open(onStream);
    gate.open(onStream);
    const first = fakeStream();
    const second = fakeStream();
    mic.calls[1]!.resolve(second);
    mic.calls[0]!.resolve(first);
    await flush();
    expect(first.track.stopped).toBe(true);
    expect(second.track.stopped).toBe(false);
    expect(onStream).toHaveBeenCalledTimes(1);
    expect(gate.stream).toBe(second);
  });

  it("a second open() stops an already open stream", async () => {
    const mic = deferredMic();
    const gate = createMicGate(mic.getUserMedia);
    gate.open(() => undefined);
    const first = fakeStream();
    mic.calls[0]!.resolve(first);
    await flush();
    gate.open(() => undefined);
    expect(first.track.stopped).toBe(true);
  });

  it("ignores a late rejection of a cancelled request", async () => {
    const mic = deferredMic();
    const gate = createMicGate(mic.getUserMedia);
    const onError = vi.fn();
    gate.open(() => undefined, onError);
    gate.close();
    mic.calls[0]!.reject(new Error("denied"));
    await flush();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("voice session (N5 #2)", () => {
  it("stop before getUserMedia resolves: the stream is stopped on arrival, nothing is recorded", async () => {
    const { s, mic, deps } = session();
    s.start();
    s.stop(true);
    expect(deps.onNothingRecorded).toHaveBeenCalledWith(true);
    const late = fakeStream();
    mic.calls[0]!.resolve(late);
    await flush();
    expect(late.track.stopped).toBe(true);
    expect(deps.createRecorder).not.toHaveBeenCalled();
    expect(deps.onStream).not.toHaveBeenCalledWith(late);
    expect(s.active).toBe(false);
  });

  it("double start: the first stream never stays open", async () => {
    const { s, mic, deps, recorders } = session();
    s.start();
    s.start();
    const first = fakeStream();
    const second = fakeStream();
    mic.calls[0]!.resolve(first);
    mic.calls[1]!.resolve(second);
    await flush();
    expect(first.track.stopped).toBe(true);
    expect(second.track.stopped).toBe(false);
    expect(recorders).toHaveLength(1);
    expect(deps.onStream).toHaveBeenLastCalledWith(second);
  });

  it("start while recording ends the running recorder without delivering it", async () => {
    const { s, mic, deps, recorders } = session();
    s.start();
    const first = fakeStream();
    mic.calls[0]!.resolve(first);
    await flush();
    s.start();
    expect(first.track.stopped).toBe(true);
    expect(recorders[0]!.stop).toHaveBeenCalled();
    expect(deps.onFinished).not.toHaveBeenCalled();
  });

  it("unmount while pending: the stream is stopped on arrival", async () => {
    const { s, mic, deps } = session();
    s.start();
    s.dispose();
    const late = fakeStream();
    mic.calls[0]!.resolve(late);
    await flush();
    expect(late.track.stopped).toBe(true);
    expect(deps.createRecorder).not.toHaveBeenCalled();
  });

  it("unmount while recording: recorder stopped, stream released, nothing delivered", async () => {
    const { s, mic, deps, recorders } = session();
    s.start();
    const st = fakeStream();
    mic.calls[0]!.resolve(st);
    await flush();
    s.dispose();
    expect(st.track.stopped).toBe(true);
    expect(recorders[0]!.stop).toHaveBeenCalled();
    expect(deps.onFinished).not.toHaveBeenCalled();
    expect(deps.onStream).toHaveBeenLastCalledWith(null);
  });

  it("normal recording: delivers the chunks and releases the microphone", async () => {
    const { s, mic, deps } = session();
    s.start();
    const st = fakeStream();
    mic.calls[0]!.resolve(st);
    await flush();
    expect(deps.onStream).toHaveBeenCalledWith(st);
    s.stop(true);
    expect(st.track.stopped).toBe(true);
    expect(deps.onFinished).toHaveBeenCalledTimes(1);
    const [chunks, mime, save] = deps.onFinished.mock.calls[0] as unknown as [
      Blob[],
      string,
      boolean,
    ];
    expect(chunks).toHaveLength(1);
    expect(mime).toBe("audio/webm");
    expect(save).toBe(true);
  });

  it("denied microphone ends the recording state; unsupported browser never asks", async () => {
    const { s, mic, deps } = session();
    s.start();
    mic.calls[0]!.reject(new Error("NotAllowedError"));
    await flush();
    expect(deps.onDenied).toHaveBeenCalledTimes(1);

    const none = createVoiceSession<Fake>({ ...deps, mime: undefined });
    none.start();
    expect(deps.onUnsupported).toHaveBeenCalledTimes(1);
    expect(mic.getUserMedia).toHaveBeenCalledTimes(1);
  });
});
