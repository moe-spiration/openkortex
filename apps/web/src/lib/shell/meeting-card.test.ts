import { describe, expect, it } from "vitest";
import { meetingCardMode, type MeetingCardInput } from "./meeting-card";

const base: MeetingCardInput = {
  hasMeeting: true,
  noteId: "m1",
  state: "full",
  hiddenNoteId: null,
  drawerOpen: false,
  onHome: false,
  pinned: false,
};

describe("meetingCardMode (meeting handed over by the Windows app)", () => {
  it("Home and other pages show the chip (Home adds its strip); the card opens only when expanded", () => {
    expect(meetingCardMode({ ...base, onHome: true })).toBe("dock");
    expect(meetingCardMode(base)).toBe("dock");
  });

  it("'Aufklappen' from the chip opens the card on the meeting's own note page too", () => {
    expect(meetingCardMode({ ...base, pinned: true })).toBe("full");
  });

  it("minimized or with a drawer open it is the chip", () => {
    expect(meetingCardMode({ ...base, onHome: true, state: "min" })).toBe("dock");
    expect(meetingCardMode({ ...base, onHome: true, drawerOpen: true })).toBe("dock");
  });

  it("a closed meeting stays closed (also after a reload); a newer meeting shows again", () => {
    expect(meetingCardMode({ ...base, onHome: true, hiddenNoteId: "m1" })).toBe("none");
    expect(meetingCardMode({ ...base, onHome: true, noteId: "m2", hiddenNoteId: "m1", pinned: true })).toBe("full");
    expect(meetingCardMode({ ...base, hasMeeting: false, onHome: true })).toBe("none");
  });
});
