/*
 * Push-to-talk gating. The hold gesture must stay enabled for its whole life: starting it opens the voice
 * capture (`cap === "voice"`), and flipping a running gesture's `enabled` to false makes RNGH cancel it, which
 * released the orb at once and saved a 0 s memo. So "may a new hold start" is decided once, in onStart, from the
 * state before the hold began.
 */
export function pttMayStart(fanOpen: boolean, cap: string | null | undefined): boolean {
  return !fanOpen && cap !== "voice";
}
