import { withLocale } from "@kortex/i18n";
import { describe, expect, it } from "vitest";
import {
  formatTaskLine,
  normalizeTimeframe,
  parseTaskLine,
  tasksToCsv,
  tasksToMarkdown,
  timeframeBucket,
} from "./tasks";

describe("normalizeTimeframe", () => {
  it("keeps named timeframes and ISO days, maps German labels, drops the rest", () => {
    expect(normalizeTimeframe("today")).toBe("today");
    expect(normalizeTimeframe("This Week")).toBe("this_week");
    expect(normalizeTimeframe("diese Woche")).toBe("this_week");
    expect(normalizeTimeframe("später")).toBe("later");
    expect(normalizeTimeframe("2026-11-05T10:00:00Z")).toBe("2026-11-05");
    expect(normalizeTimeframe("2026-13-45")).toBeNull();
    expect(normalizeTimeframe("bald")).toBeNull();
    expect(normalizeTimeframe(null)).toBeNull();
  });
});

describe("timeframeBucket", () => {
  it("buckets a day relative to today (Sunday ends the week)", () => {
    // 2026-11-01 is a Sunday.
    expect(timeframeBucket("2026-11-01", "2026-11-01")).toBe("today");
    expect(timeframeBucket("2026-11-02", "2026-11-01")).toBe("later");
    expect(timeframeBucket("2026-11-04", "2026-11-03")).toBe("this_week"); // Tue → Wed
    expect(timeframeBucket("later", "2026-11-03")).toBe("later");
    expect(timeframeBucket(null, "2026-11-03")).toBeNull();
  });
});

describe("task line", () => {
  it("leaves the user out as owner", () => {
    expect(formatTaskLine({ title: "Folien senden", assignee: "Me" })).toBe("- [ ] Folien senden");
    expect(formatTaskLine({ title: "Folien senden", assignee: "ich" })).toBe("- [ ] Folien senden");
    expect(formatTaskLine({ title: "Send slides", assignee: "@Anna" }, "en")).toBe("- [ ] Send slides · Owner: Anna");
  });

  it("round-trips all fields", () => {
    const line = formatTaskLine({
      title: "Folien senden",
      assignee: "Max",
      project: "Kortex",
      timeframe: "this_week",
      due: "2026-11-05T00:00:00Z",
      context: "Aus dem Sync vom Montag",
    });
    expect(line).toBe(
      "- [ ] Folien senden · Zuständig: Max · Projekt: [[Kortex]] · Zeitrahmen: diese Woche · Fällig: 2026-11-05 · Kontext: Aus dem Sync vom Montag",
    );
    expect(parseTaskLine(line)).toEqual({
      title: "Folien senden",
      done: false,
      assignee: "Max",
      project: "Kortex",
      timeframe: "this_week",
      due: "2026-11-05",
      context: "Aus dem Sync vom Montag",
      id: null,
    });
  });

  it("writes a plain checklist line when no extra field is set and ignores non-checklist lines", () => {
    expect(formatTaskLine({ title: "  Milch  kaufen ", done: true })).toBe("- [x] Milch kaufen");
    expect(parseTaskLine("- [x] Milch kaufen")?.done).toBe(true);
    expect(parseTaskLine("Milch kaufen")).toBeNull();
  });

  it("keeps a dot-separated title intact", () => {
    expect(parseTaskLine("- [ ] A · B · Zeitrahmen: heute")).toMatchObject({ title: "A · B", timeframe: "today" });
  });
});

describe("export", () => {
  const tasks = [
    { title: "Eins", project: "Kortex", timeframe: "today", priority: "high", context: 'Sagte "jetzt", dann\nZeile' },
    { title: "=SUMME(A1)", done: true },
  ];

  it("renders a Markdown checklist with optional heading", () => {
    expect(tasksToMarkdown(tasks, { title: "Export" })).toBe(
      '# Export\n\n- [ ] Eins · Projekt: [[Kortex]] · Zeitrahmen: heute · Kontext: Sagte "jetzt", dann Zeile\n- [x] =SUMME(A1)\n',
    );
  });

  it("renders RFC 4180 CSV, quoting cells and neutralising formulas", () => {
    const csv = tasksToCsv(tasks);
    const rows = csv.split("\r\n");
    expect(rows[0]).toBe("title,status,priority,project,timeframe,due,context,assignee,external_ref");
    expect(rows[1]).toBe('Eins,open,high,Kortex,today,,"Sagte ""jetzt"", dann Zeile",,');
    expect(rows[2]).toBe("'=SUMME(A1),done,,,,,,,");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("task line in English", () => {
  it("writes English keys and reads both languages", () => {
    const task = { title: "Send slides", project: "Kortex", timeframe: "this_week", due: "2026-11-05T00:00:00Z", context: "From Monday" };
    const line = withLocale("en", () => formatTaskLine(task));
    expect(line).toBe("- [ ] Send slides · Project: [[Kortex]] · Timeframe: this week · Due: 2026-11-05 · Context: From Monday");
    const parsed = { title: "Send slides", done: false, assignee: null, project: "Kortex", timeframe: "this_week", due: "2026-11-05", context: "From Monday", id: null };
    expect(parseTaskLine(line)).toEqual(parsed);
    expect(withLocale("en", () => parseTaskLine(formatTaskLine(task, "de")))).toEqual(parsed);
    expect(withLocale("en", () => normalizeTimeframe("später"))).toBe("later");
  });
});
