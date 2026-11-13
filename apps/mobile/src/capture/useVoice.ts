import { useCallback, useRef } from "react";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, type AudioRecorder } from "expo-audio";

/*
 * Push-to-talk recorder (expo-audio, works in Expo Go). HIGH_QUALITY records AAC in an .m4a
 * container (audio/mp4), which /api/chat/transcribe accepts. Metering is on, so the recording
 * UI can follow the real input level (A4, see LevelWave).
 */

export const VOICE_MIME = "audio/mp4";

const OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

export interface Voice {
  /** Asks for the microphone on first use; false when denied or the recorder failed. */
  start: () => Promise<boolean>;
  /** Stops and returns the file URI (null when nothing was recorded). */
  stop: () => Promise<string | null>;
  cancel: () => Promise<void>;
  /** The recorder, for level meters (useAudioRecorderState). */
  recorder: AudioRecorder;
}

export function useVoice(): Voice {
  const recorder = useAudioRecorder(OPTIONS);
  const active = useRef(false);
  /** A start that is still waiting for the permission dialog; a stop/cancel meanwhile must win over it. */
  const starting = useRef<Promise<boolean> | null>(null);
  const aborted = useRef(false);

  const start = useCallback(() => {
    aborted.current = false;
    const run = (async () => {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) return false;
        if (aborted.current) return true; // released during the dialog: nothing to record, not a denial
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        if (aborted.current) return true;
        recorder.record();
        active.current = true;
        return true;
      } catch {
        active.current = false;
        return false;
      }
    })();
    starting.current = run;
    void run.finally(() => {
      if (starting.current === run) starting.current = null;
    });
    return run;
  }, [recorder]);

  const stop = useCallback(async () => {
    if (starting.current) {
      aborted.current = true;
      await starting.current.catch(() => false);
    }
    if (!active.current) return null;
    active.current = false;
    try {
      await recorder.stop();
      return recorder.uri;
    } catch {
      return null;
    } finally {
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  }, [recorder]);

  const cancel = useCallback(async () => {
    await stop();
  }, [stop]);

  return { start, stop, cancel, recorder };
}
