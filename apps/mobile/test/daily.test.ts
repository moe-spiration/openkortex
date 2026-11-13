import { describe, expect, it } from "vitest";
import { parseCheckin, seedCheckin, streakOf, toDailyMarkdown, topTasks } from "../src/data/daily";

const tasks = [
  { id: "a", title: "Später", status: "open", due_date: null, priority: "low" as const },
  { id: "b", title: "Heute fällig", status: "open", due_date: "2026-10-25", priority: "medium" as const },
  { id: "c", title: "Dringend", status: "open", due_date: null, priority: "urgent" as const },
  { id: "d", title: "Erledigt", status: "done", due_date: "2026-10-20", priority: "high" as const },
];

describe("daily check-in", () => {
  it("writes the same Markdown as the web", () => {
    const c = { ...seedCheckin("2026-10-25", tasks, 3), energy: 8 };
    expect(toDailyMarkdown(c)).toBe(
      [
        "---",
        "type: daily",
        "date: 2026-10-25",
        "energy: 8",
        "streak: 3",
        "focus_done: 0",
        "tags: [daily]",
        "---",
        "# Daily Journal 2026-10-25",
        "",
        "## Check-in",
        "- Energie: 8/10",
        "",
        "## Top-3-Prioritäten",
        "- [ ] Heute fällig",
        "- [ ] Dringend",
        "- [ ] Später",
        "",
      ].join("\n"),
    );
  });

  it("orders focus like the web and tracks no habits on a new day", () => {
    expect(topTasks("2026-10-25", tasks).map((f) => f.key)).toEqual(["b", "c", "a"]);
    expect(seedCheckin("2026-10-25", tasks, 0).habits).toEqual([]);
  });

  it("keeps the habit lines of an old note when it is saved again", () => {
    const seed = seedCheckin("2026-10-25", [], 0);
    const old = parseCheckin("2026-10-25", { date: "2026-10-25", energy: 6, habits: [{ key: "mob", label: "Morning Mobility", done: true }], focus: [] }, seed)!;
    expect(toDailyMarkdown({ ...old, energy: 7 })).toContain("habits:\n  mob: true");
    expect(toDailyMarkdown({ ...old, energy: 7 })).toContain("- [x] Morning Mobility");
  });

  it("restores a stored day and ignores other days", () => {
    const seed = seedCheckin("2026-10-25", [], 0);
    expect(parseCheckin("2026-10-25", { date: "2026-10-25", energy: 6, focus: [] }, seed)).toMatchObject({ energy: 6, habits: [] });
    expect(parseCheckin("2026-10-25", { date: "2026-10-24", habits: [], focus: [] }, seed)).toBeNull();
  });

  it("counts the streak back from today or yesterday", () => {
    expect(streakOf(["2026-10-25", "2026-10-24", "2026-10-22"], "2026-10-25")).toBe(2);
    expect(streakOf(["2026-10-24", "2026-10-23"], "2026-10-25")).toBe(2);
    expect(streakOf([], "2026-10-25")).toBe(0);
  });
});

describe("settings", () => {
  it("lists routing per task like the web", async () => {
    const { routingRows } = await import("../src/data/settings");
    const rows = routingRows({ summarize: { provider: "anthropic", model_id: null, auto_mode: "cost_efficient" }, vision_ocr: { provider: "openrouter", model_id: "google/gemini-x" } });
    expect(rows.find((r) => r.task === "summarize")!.value).toBe("Anthropic · Auto (günstig)");
    expect(rows.find((r) => r.task === "vision_ocr")!.value).toBe("OpenRouter · gemini-x");
    expect(rows).toHaveLength(8);
  });
});
