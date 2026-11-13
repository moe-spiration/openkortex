import { describe, expect, it } from "vitest";
import { activeDraft, setActiveDraft, showsDraftEditor } from "./active-draft";

describe("new-note editor stays mounted across its own address change (/notes/new → /notes/<id>)", () => {
  it("shows the editor on /notes/new and on the saved draft's address only", () => {
    expect(showsDraftEditor("/notes/new", null)).toBe(true);
    expect(showsDraftEditor("/notes/abc", "abc")).toBe(true);
    expect(showsDraftEditor("/notes/other", "abc")).toBe(false);
    expect(showsDraftEditor("/notes/abc", null)).toBe(false);
  });
  it("tracks the active draft", () => {
    setActiveDraft("x1");
    expect(activeDraft()).toBe("x1");
    setActiveDraft(null);
    expect(activeDraft()).toBeNull();
  });
});
