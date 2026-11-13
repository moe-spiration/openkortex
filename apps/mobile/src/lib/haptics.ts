import * as Haptics from "expo-haptics";

/* Light haptic tick for gestures (swipe threshold, long-press). Switchable in Settings. */
let enabled = true;
export const setHapticsEnabled = (on: boolean) => {
  enabled = on;
};
export const buzz = () => {
  if (enabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
};
