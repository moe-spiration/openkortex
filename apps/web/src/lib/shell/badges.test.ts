import { reviewDue } from "@kortex/db/daily";
import { describe, expect, it } from "vitest";
import { badgeValue, percentValue, reviewTooltip } from "./badges";
import { DEFAULT_PREFS, migrateSections, SECTIONS_VERSION } from "./prefs";

describe("sidebar badges (A-06)", () => {
  it("renders counts above zero only", () => {
    expect(badgeValue(3)).toBe("3");
    for (const v of [0, -1, null, undefined, Number.NaN]) expect(badgeValue(v)).toBeNull();
  });

  it("keeps life percentages but drops 0 % and empty areas", () => {
    expect(percentValue(82)).toBe("82%");
    expect(percentValue(0)).toBeNull();
    expect(percentValue(40, true)).toBeNull();
    expect(percentValue(null)).toBeNull();
  });

  it("formats the review tooltip with the due date", () => {
    // Sunday 25.10.2026, review on Friday (5) → due Fr, 30.10.
    const due = reviewDue(new Date("2026-10-25T10:00:00Z"), "Europe/Berlin", 5)!;
    expect(due.weekdayShort).toBe("Fr");
    expect(reviewTooltip(due)).toBe("Fällig am Fr, 30.10.");
    const today = reviewDue(new Date("2026-10-25T10:00:00Z"), "Europe/Berlin", 0)!;
    expect(reviewTooltip(today)).toBe("Heute fällig (So, 25.10.)");
    // No badge while the settings are unknown.
    expect(reviewDue(new Date(), "Europe/Berlin", null)).toBeNull();
  });
});

describe("sidebar groups (A-09)", () => {
  it("start with Life open, Objects und Hubs and Hashtags collapsed", () => {
    expect(DEFAULT_PREFS.sections).toMatchObject({ life: true, spaces: true, objects: false, tags: false });
  });

  it("collapses them once for prefs stored before W4, then keeps the user's choice", () => {
    expect(migrateSections({ life: false, objects: true, tags: true }, undefined)).toMatchObject({ life: true, objects: false, tags: false });
    expect(migrateSections({ objects: true, tags: true }, SECTIONS_VERSION)).toMatchObject({ objects: true, tags: true });
    // Version 4 (2026-11-07): the Life dock opens once for older prefs, then the user's choice holds.
    expect(migrateSections({ life: false, objects: true }, 3)).toMatchObject({ life: true, objects: true });
    expect(migrateSections({ life: false }, SECTIONS_VERSION)).toMatchObject({ life: false });
  });
});
