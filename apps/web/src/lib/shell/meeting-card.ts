/*
 * Where the meeting of the shell shows (floating card, orbit-bar chip or nothing). Device test 0.6.0: after the
 * Windows app handed a meeting over, the app opened its note; on note and reader pages the card could never be
 * expanded ("Aufklappen" did nothing), the chip had no way out, and a closed card came back on every reload.
 */

export type MeetingCardMode = "full" | "dock" | "none";

export interface MeetingCardInput {
  /** The shell has a meeting (live session, or a meeting of the last 3 hours). */
  hasMeeting: boolean;
  noteId: string | null;
  /** Shell state: "full" (expanded), "min" (chip) or "hidden". */
  state: "full" | "min" | "hidden";
  /** Meeting the user closed (persisted), so it stays closed after a reload; a newer meeting shows again. */
  hiddenNoteId: string | null;
  /** A note drawer is open (the card would cover it). */
  drawerOpen: boolean;
  /** Home shows the card on its own; elsewhere only after the user expanded it (pinned). */
  onHome: boolean;
  pinned: boolean;
}

export function meetingCardMode(i: MeetingCardInput): MeetingCardMode {
  if (!i.hasMeeting || i.state === "hidden" || (i.noteId !== null && i.noteId === i.hiddenNoteId)) return "none";
  // Feinschliff A2 (2026-11-07): Home shows the meeting as a slim strip on top of the page (HomeLiveStrip), the
  // floating card only opens when the user expands it.
  const full = i.state === "full" && !i.drawerOpen && i.pinned;
  return full ? "full" : "dock";
}

const KEY = "kortex.meetingCard.hidden.v1";

export function readHiddenMeeting(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeHiddenMeeting(noteId: string | null): void {
  try {
    if (noteId) window.localStorage.setItem(KEY, noteId);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: closing still works for this session */
  }
}

/** Window event: the Home strip asks the shell to open the floating meeting card. */
export const MEETING_EXPAND_EVENT = "kortex:meeting-expand";
