/*
 * Microphone lifecycle of the Orbit-Bar (N5 #2), free of React so it can be unit-tested.
 *
 * getUserMedia resolves late (permission prompt, device start). Every request carries a generation
 * token; a stop, a second start or an unmount before it resolves bumps the generation, and a stream
 * that arrives for an old generation is stopped at once. So the microphone never stays open behind
 * a recording the user already ended.
 */

export interface MicTrack {
  stop: () => void;
}
export interface MicStream {
  getTracks: () => MicTrack[];
}

export const stopStream = (s: MicStream | null | undefined) =>
  s?.getTracks().forEach((t) => t.stop());

/** One microphone request at a time; late streams of cancelled requests are stopped. */
export function createMicGate<S extends MicStream>(getUserMedia: () => Promise<S>) {
  let gen = 0;
  let pending = false;
  let stream: S | null = null;

  /** Drops the open stream and any request still in flight. */
  const close = () => {
    gen++;
    pending = false;
    stopStream(stream);
    stream = null;
  };

  return {
    /** Opens the microphone; an earlier request or stream is closed first. */
    open(onStream: (s: S) => void, onError?: () => void): void {
      close();
      const my = gen;
      pending = true;
      getUserMedia().then(
        (s) => {
          if (my !== gen) {
            stopStream(s); // stopped, restarted or unmounted meanwhile
            return;
          }
          pending = false;
          stream = s;
          onStream(s);
        },
        () => {
          if (my !== gen) return;
          pending = false;
          onError?.();
        },
      );
    },
    close,
    get pending() {
      return pending;
    },
    get stream() {
      return stream;
    },
  };
}

/** The parts of MediaRecorder the session uses. */
export interface RecorderLike {
  state: "inactive" | "recording" | "paused";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: ((e: Event) => void) | null;
  start: (timeslice?: number) => void;
  stop: () => void;
}

export interface VoiceSessionDeps<S extends MicStream> {
  /** Supported mime type, or undefined when the browser cannot record. */
  mime: string | undefined;
  getUserMedia: () => Promise<S>;
  createRecorder: (stream: S, mime: string) => RecorderLike;
  /** The stream for the live wave (null when released). */
  onStream: (s: S | null) => void;
  onUnsupported: () => void;
  onDenied: () => void;
  /** Stopped before the microphone was open: nothing was recorded. */
  onNothingRecorded: (save: boolean) => void;
  /** A finished recording (save false = discarded). */
  onFinished: (chunks: Blob[], mimeType: string, save: boolean) => void;
}

/** start / stop / dispose of the live recorder, safe against late getUserMedia results. */
export function createVoiceSession<S extends MicStream>(deps: VoiceSessionDeps<S>) {
  const gate = createMicGate(deps.getUserMedia);
  let media: { rec: RecorderLike; chunks: Blob[] } | null = null;

  /** Ends a running recorder without delivering it. */
  const abandon = () => {
    const m = media;
    media = null;
    if (m) {
      m.rec.onstop = null;
      m.rec.ondataavailable = null;
      if (m.rec.state !== "inactive") m.rec.stop();
    }
    if (m || gate.stream || gate.pending) {
      gate.close();
      deps.onStream(null);
    }
  };

  return {
    start(): void {
      const mime = deps.mime;
      if (mime === undefined) {
        deps.onUnsupported();
        return;
      }
      abandon(); // a second start never leaks the first stream
      gate.open(
        (stream) => {
          const rec = deps.createRecorder(stream, mime);
          const chunks: Blob[] = [];
          rec.ondataavailable = (e) => {
            if (e.data.size) chunks.push(e.data);
          };
          rec.start(1000);
          media = { rec, chunks };
          deps.onStream(stream);
        },
        () => deps.onDenied(),
      );
    },
    stop(save: boolean): void {
      if (gate.pending) {
        gate.close(); // the stream that is still on its way is stopped when it arrives
        deps.onStream(null);
        deps.onNothingRecorded(save);
        return;
      }
      const m = media;
      if (!m) return;
      media = null;
      const finish = () => {
        gate.close();
        deps.onStream(null);
        deps.onFinished(m.chunks, m.rec.mimeType, save);
      };
      m.rec.onstop = finish;
      if (m.rec.state !== "inactive") m.rec.stop();
      else finish();
    },
    /** Unmount: stops everything, including a request still in flight. */
    dispose(): void {
      abandon();
    },
    get active() {
      return !!media || gate.pending;
    },
  };
}
