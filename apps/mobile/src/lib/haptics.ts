import * as Haptics from "expo-haptics";

/* Light haptic tick for gestures (swipe threshold, long-press). Switchable in Settings. */
let enabled = true;
export const setHapticsEnabled = (on: boolean) => {
  enabled = on;
};
export const buzz = () => {
  if (enabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
};
/** Softer selection tick for switching tabs, segments and filters. */
export const tick = () => {
  if (enabled) void Haptics.selectionAsync().catch(() => undefined);
};
/* Ruhe haptic tokens (android-richtlinien section 15): never on scroll, load or answers; always with a visual cue. */
/** Accepting a diff, finishing a task. */
export const ok = () => {
  if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
};
/** Discarding, a confirmed delete. */
export const warn = () => {
  if (enabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
};
/** An error, e.g. sending failed. */
export const fail = () => {
  if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
};
