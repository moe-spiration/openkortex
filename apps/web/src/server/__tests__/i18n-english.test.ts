import { describe, expect, it } from "vitest";
import { withLocale } from "@kortex/i18n";
import { actionPrompt, copilotSystemPrompt } from "../chat/prompts";
import { editToolsPrompt } from "../chat/edit";
import { renderDigestMarkdown } from "../digest/service";
import {
  focusOwnTemplate,
  monthlyPeriod,
  ownNotesOf,
  renderFocusProfile,
  synthesisSystem,
  weeklyPeriod,
} from "../digest/synthesis";
import { briefingPrompt, briefingSystem, fallbackSummary, templateSummary } from "../home/briefing";
import { relativeDay } from "../home/service";
import { longDay, shortDay } from "../life/dates";
import { areaDef, areaKeyForLabel } from "../life/areas";
import { appendChangeEntry, countSummary, diffSystem } from "../radar/diff";
import { localeOfSettings } from "../locale";

/* The suite runs in German (setup.ts); these cover the English side of the generated texts. */
const en = <T>(fn: () => T): T => withLocale("en", fn);

describe("English texts", () => {
  it("copilot system prompt and editor actions", () => {
    const system = en(() => copilotSystemPrompt("brain", [], "2026-10-23", { routing: true, brief: true, focus: "- MCP" }));
    expect(system).toContain("You are the AI copilot of Kortex");
    expect(system).toContain("Answer in the language of the question (default English)");
    expect(system).toContain("Filing knowledge");
    expect(system).toContain("Sources:\n(No matching sources found.)");
    expect(system).not.toMatch(/Du bist|Quellen:|Standard Deutsch/);
    expect(en(() => actionPrompt("summarize"))).toContain("default English");
    expect(actionPrompt("summarize")).toContain("Standard Deutsch");
    expect(en(() => editToolsPrompt(true))).toContain('reports "No match"');
  });

  it("briefing: system prompt, user prompt and fallback sentence", () => {
    expect(en(briefingSystem)).toContain("Answer in English");
    expect(briefingSystem()).toContain("Antworte auf Deutsch");
    const inputs = {
      daily: { energy: 7, focus: ["Ship i18n"], text: "" },
      tasks: [{ id: "t1", title: "Review PR", due_date: "2026-10-24", priority: "high" }],
      recent: [{ title: "MCP notes", type: "note", summary: "" }],
      meeting: null,
    } as unknown as Parameters<typeof briefingPrompt>[0];
    const clock = { today: "2026-10-23", timeZone: "Europe/Berlin", now: new Date("2026-10-23T08:00:00Z") };
    const prompt = en(() => briefingPrompt(inputs, clock));
    expect(prompt).toContain("Today: Friday, October 23");
    expect(prompt).toContain("- [t1] Review PR (due 10/24) (priority high)");
    expect(prompt).toContain("New or edited since yesterday:");
    expect(en(() => fallbackSummary(inputs))).toBe("1 open task, 1 new entry since yesterday, Focus: Ship i18n.");
    expect(en(templateSummary)).toMatch(/^Still quiet here\./);
  });

  it("digest and synthesis: prompts, titles, headings", () => {
    expect(en(() => synthesisSystem("weekly"))).toContain("Write in English");
    expect(synthesisSystem("weekly")).toContain("Schreibe auf Deutsch");
    const at = new Date("2026-10-23T08:00:00Z");
    expect(en(() => weeklyPeriod(at, at))).toMatchObject({ key: "2026-W43", label: "Week 43/2026", title: "Weekly synthesis Week 43/2026" });
    expect(weeklyPeriod(at, at)).toMatchObject({ key: "2026-W43", label: "KW 43/2026", title: "Wochensynthese KW 43/2026" });
    expect(en(() => monthlyPeriod(new Date("2026-11-01T00:00:00Z"))).title).toBe("Monthly synthesis October 2026");
    const md = en(() =>
      renderDigestMarkdown(
        { key: "Kortex", items: [], tasks: [] } as unknown as Parameters<typeof renderDigestMarkdown>[0],
        { headline: "Quiet week.", decisions: ["MCP it is."], progress: [], blockers_risks: [], next_week: [] },
        { start: "2026-10-16T00:00:00Z", end: "2026-10-23T00:00:00Z", week: "Week 43/2026" },
      ),
    );
    expect(md).toContain("> Period 10/16/2026 – 10/23/2026 · 0 entries · 0 tasks");
    expect(md).toContain("## 1. Decisions\n\n- MCP it is.");
    expect(md).toContain("## 2. Progress\n\n- None");
    expect(md).toContain("## Sources");
  });

  it("focus profile: English heading for new profiles, German own notes are kept", () => {
    const period = en(() => weeklyPeriod(new Date("2026-10-23T08:00:00Z"), new Date("2026-10-23T08:00:00Z")));
    const focus = { topics: ["MCP"], projects: [], interests: [] };
    const fresh = en(() => renderFocusProfile(period, focus, "2026-10-23T08:00:00Z", null));
    expect(fresh).toContain("# Focus profile");
    expect(fresh).toContain("## Current focus topics\n\n- MCP");
    expect(fresh).toContain(en(focusOwnTemplate).trim());
    expect(ownNotesOf(fresh)).toMatch(/^## Own notes/);
    const german = "## Eigene Notizen\n\n- Mehr Sport!";
    const kept = en(() => renderFocusProfile(period, focus, "2026-10-23T08:00:00Z", german));
    expect(kept).toContain("only the section “Eigene Notizen” stays unchanged");
    expect(ownNotesOf(kept)).toBe(german);
  });

  it("radar: summary, prompt and the change section in either language", () => {
    expect(en(diffSystem)).toContain("Answer in English");
    expect(en(() => countSummary({ added: [], removed: [], addedCount: 1, removedCount: 2 }))).toBe("1 line new, 2 removed");
    expect(en(() => appendChangeEntry("# T\n\nText", "2026-11-01", "Price up"))).toBe("# T\n\nText\n\n## Changes\n\n- 2026-11-01: Price up\n");
    // An English account appends to the German section an older note already has (and the other way round).
    expect(en(() => appendChangeEntry("# T\n\n## Änderungen\n\n- 2026-11-01: Alt\n", "2026-11-02", "New"))).toBe(
      "# T\n\n## Änderungen\n\n- 2026-11-01: Alt\n- 2026-11-02: New\n",
    );
    expect(appendChangeEntry("# T\n\n## Changes\n\n- 2026-11-01: Old\n", "2026-11-02", "Neu")).toBe(
      "# T\n\n## Changes\n\n- 2026-11-01: Old\n- 2026-11-02: Neu\n",
    );
  });

  it("dates, relative days and life areas", () => {
    expect(en(() => longDay("2026-10-25"))).toBe("Sunday, October 25");
    expect(en(() => shortDay("2026-10-22"))).toBe("Oct 22");
    expect(shortDay("2026-10-22")).toBe("22. Okt");
    const clock = { today: "2026-10-23", timeZone: "Europe/Berlin" };
    expect(en(() => relativeDay("2026-10-19T10:00:00Z", clock))).toBe("4 days ago");
    expect(en(() => relativeDay("2026-09-12T10:00:00Z", clock))).toBe("09/12");
    expect(en(() => areaDef("career")!.name)).toBe("Career & Leadership");
    expect(areaDef("career")!.name).toBe("Karriere & Leadership");
    // Stored labels match in both languages, whatever the current one is.
    expect(en(() => areaKeyForLabel("Karriere & Leadership"))).toBe("career");
    expect(areaKeyForLabel("Career & Leadership")).toBe("career");
    expect(areaKeyForLabel("Persönliches Wachstum")).toBe("growth");
  });

  it("account language: only an explicit English setting is English", () => {
    expect(localeOfSettings({ locale: "en" })).toBe("en");
    expect(localeOfSettings({ locale: "de" })).toBe("de");
    expect(localeOfSettings({ locale: "" })).toBe("de");
    expect(localeOfSettings(null)).toBe("de");
  });
});

describe("request language", () => {
  it("covers the whole handler across awaits and leaves requests without a language alone", async () => {
    const { runInRequestLocale } = await import("@/i18n/server");
    const { getLocale } = await import("@kortex/i18n");
    const probe = async () => {
      await Promise.resolve();
      return getLocale();
    };
    expect(await runInRequestLocale(new Headers({ "x-kortex-locale": "en" }), probe)).toBe("en");
    expect(await runInRequestLocale(new Headers({ cookie: "a=1; kortex_locale=en" }), probe)).toBe("en");
    expect(await runInRequestLocale(new Headers({ "accept-language": "en-GB,en;q=0.9" }), probe)).toBe("en");
    expect(await runInRequestLocale(new Headers(), probe)).toBe("de");
    expect(getLocale()).toBe("de");
  });
});
