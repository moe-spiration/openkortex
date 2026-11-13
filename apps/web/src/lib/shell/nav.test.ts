import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOURNAL_DAY_HREF, JOURNAL_WEEK_HREF, NAV_GROUPS, NAV_ITEMS, legacyJournalRedirect } from "./nav";
import { routeInfo } from "./routes";

/* fx3 (device test 0.6.1): sidebar groups, the journal tabs and the redirect of the old weekly review route. */

describe("sidebar groups", () => {
  it("has the A2 groups: navigation on top, tools docked at the bottom", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Navigation", "Werkzeuge"]);
    expect(NAV_GROUPS.map((g) => g.items.map((i) => i.id))).toEqual([
      ["home", "inbox", "tasks", "journal", "agent"],
      ["graph", "flashcards", "insights", "archive"],
    ]);
  });

  it("lists every route once; no Scratchpad, no separate review or daily journal row", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).not.toContain("/review");
    expect(NAV_ITEMS.map((i) => i.label.toLowerCase())).not.toContain("scratchpad");
    expect(NAV_ITEMS.find((i) => i.id === "journal")).toMatchObject({ label: "Tagebuch", href: JOURNAL_DAY_HREF });
    expect(NAV_ITEMS.length).toBeLessThan(12);
  });

  it("every row's view is a known route (the row can show as active)", () => {
    for (const item of NAV_ITEMS) expect(routeInfo(item.href).view, item.href).toBe(item.id);
  });

  it("the sidebar has no Scratchpad row any more", () => {
    const src = readFileSync(new URL("../../components/shell/Sidebar.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/SCRATCHPAD_EVENT/);
    expect(src).not.toMatch(/>Scratchpad</);
  });
});

describe("journal tabs and old routes", () => {
  it("/review goes to the week tab, query kept", () => {
    expect(legacyJournalRedirect("/review")).toBe(JOURNAL_WEEK_HREF);
    expect(legacyJournalRedirect("/review/")).toBe("/journal/week");
    expect(legacyJournalRedirect("/review", "step=2")).toBe("/journal/week?step=2");
    expect(legacyJournalRedirect("/review", "?a=1")).toBe("/journal/week?a=1");
  });

  it("other paths are not redirected; /journal stays the day tab", () => {
    expect(legacyJournalRedirect("/journal")).toBeNull();
    expect(legacyJournalRedirect("/journal/week")).toBeNull();
    expect(legacyJournalRedirect("/reviews")).toBeNull();
    expect(legacyJournalRedirect("/reminders")).toBeNull();
  });

  it("both tabs are the journal view with one tab key; the week tab is titled Wochen-Review", () => {
    const day = routeInfo("/journal");
    const week = routeInfo("/journal/week");
    expect(day).toMatchObject({ view: "journal", tabKey: "journal", tabLabel: "Tagebuch", title: "Tagebuch" });
    expect(week).toMatchObject({ view: "journal", tabKey: "journal", title: "Wochen-Review", rest: ["week"] });
  });

  it("the /review page redirects through legacyJournalRedirect", () => {
    const src = readFileSync(new URL("../../app/(workspace)/review/page.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/redirect\(legacyJournalRedirect\("\/review"/);
  });
});
