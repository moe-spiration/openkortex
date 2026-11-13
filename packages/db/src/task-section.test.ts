import { withLocale } from "@kortex/i18n";
import { describe, expect, it } from "vitest";
import {
  parseTaskSection,
  planTaskSectionSync,
  taskInsertFromLine,
  withTaskSection,
  type SectionTask,
} from "./task-section";
import { formatTaskLine, parseTaskLine } from "./tasks";

const NOW = "2026-11-01T10:00:00.000Z";
const A = "0b7f5c9e-1111-4a5b-8c6d-000000000001";
const B = "0b7f5c9e-1111-4a5b-8c6d-000000000002";

const task = (over: Partial<SectionTask> & { id: string; title: string }): SectionTask => ({
  status: "open",
  due_date: null,
  timeframe: null,
  context: null,
  ...over,
});

describe("task line id marker", () => {
  it("round-trips format -> parse with every field and the id", () => {
    const line = formatTaskLine({
      id: A,
      title: "Folien senden",
      done: true,
      project: "Kortex",
      timeframe: "2026-11-07",
      due: "2026-11-05T00:00:00Z",
      context: "Aus dem Sync",
    });
    expect(line).toBe(
      `- [x] Folien senden · Projekt: [[Kortex]] · Zeitrahmen: 2026-11-07 · Fällig: 2026-11-05 · Kontext: Aus dem Sync <!-- task:${A} -->`,
    );
    expect(parseTaskLine(line)).toEqual({
      title: "Folien senden",
      done: true,
      project: "Kortex",
      timeframe: "2026-11-07",
      due: "2026-11-05",
      context: "Aus dem Sync",
      id: A,
    });
  });

  it("leaves exports without a marker and reads a hand-typed line as id-less", () => {
    expect(formatTaskLine({ title: "Milch" })).toBe("- [ ] Milch");
    expect(parseTaskLine("- [ ] Milch")?.id).toBeNull();
    expect(parseTaskLine(`- [ ] <!-- task:${A} -->`)).toBeNull();
  });
});

describe("withTaskSection", () => {
  const tasks = [
    task({ id: A, title: "Folien senden", timeframe: "this_week" }),
    task({ id: B, title: "Vertrag prüfen", status: "done" }),
  ];

  it("appends the section and leaves the note text alone", () => {
    const md = withTaskSection("# Sync\n\nNotizen vom Montag.\n", tasks);
    expect(md).toBe(
      `# Sync\n\nNotizen vom Montag.\n\n## Aufgaben\n\n- [ ] Folien senden · Zeitrahmen: diese Woche <!-- task:${A} -->\n- [x] Vertrag prüfen <!-- task:${B} -->\n`,
    );
    expect(parseTaskSection(md)?.map((l) => [l.id, l.done])).toEqual([
      [A, false],
      [B, true],
    ]);
  });

  it("is a fixed point and never adds a section for an item without tasks", () => {
    const md = withTaskSection("# Sync\n\nText", tasks);
    expect(withTaskSection(md, tasks)).toBe(md);
    expect(withTaskSection("# Leer\n", [])).toBe("# Leer\n");
  });

  it("replaces only its own lines inside the section and keeps text after it", () => {
    const before = `# M\n\n## Aufgaben\n\nHinweis vom Nutzer\n- [ ] Altlast <!-- task:gone-1 -->\n- [ ] folien senden\n\n## Danach\n\nRest`;
    const md = withTaskSection(before, tasks);
    expect(md).toBe(
      `# M\n\n## Aufgaben\n\n- [ ] Folien senden · Zeitrahmen: diese Woche <!-- task:${A} -->\n- [x] Vertrag prüfen <!-- task:${B} -->\n\nHinweis vom Nutzer\n\n## Danach\n\nRest`,
    );
  });

  it("skips cancelled tasks and tasks already standing as a checklist line in the body", () => {
    const md = withTaskSection("# N\n\n- [ ] Vertrag prüfen\n", [
      ...tasks,
      task({ id: "c", title: "Abgesagt", status: "cancelled" }),
    ]);
    expect(md).toContain("- [ ] Vertrag prüfen\n\n## Aufgaben\n\n- [ ] Folien senden");
    expect(md).not.toContain("Abgesagt");
    expect(md.match(/Vertrag prüfen/g)).toHaveLength(1);
  });
});

describe("planTaskSectionSync", () => {
  const existing = [
    task({ id: A, title: "Folien senden", timeframe: "this_week", context: "warum" }),
    task({ id: B, title: "Vertrag prüfen", due_date: "2026-11-05T00:00:00+00:00" }),
  ];
  const plan = (md: string) => planTaskSectionSync(existing, parseTaskSection(md) ?? [], NOW);

  it("is empty for the rendered section (no change, no loop)", () => {
    expect(plan(withTaskSection("# N\n", existing))).toEqual({ update: [], insert: [] });
  });

  it("applies a ticked checkbox and an edited title by id; a removed key clears the field", () => {
    const md = `## Aufgaben\n\n- [x] Folien an Team senden · Zeitrahmen: diese Woche <!-- task:${A} -->\n- [ ] Vertrag prüfen · Fällig: 2026-11-05 <!-- task:${B} -->`;
    expect(plan(md).update).toEqual([
      { id: A, patch: { status: "done", completed_at: NOW, title: "Folien an Team senden", context: null } },
    ]);
  });

  it("matches a line without marker by title and never clears fields from it", () => {
    const md = `## Aufgaben\n\n- [x] folien senden!\n- [ ] Vertrag prüfen · Zeitrahmen: heute`;
    expect(plan(md)).toEqual({
      update: [
        { id: A, patch: { status: "done", completed_at: NOW } },
        { id: B, patch: { timeframe: "today" } },
      ],
      insert: [],
    });
  });

  it("inserts new lines once and ignores markers of deleted tasks", () => {
    const md = `## Aufgaben\n\n- [ ] Neu · Kontext: aus dem Vault\n- [ ] neu\n- [ ] Gelöscht <!-- task:deleted-1 -->`;
    const p = plan(md);
    expect(p.update).toEqual([]);
    expect(p.insert.map((l) => l.title)).toEqual(["Neu"]);
    expect(taskInsertFromLine("u", "item", p.insert[0]!, NOW)).toMatchObject({
      user_id: "u",
      source_item_id: "item",
      title: "Neu",
      status: "open",
      context: "aus dem Vault",
      description: "manual",
    });
  });

  it("does not insert a duplicate when the same section syncs again", () => {
    const md = `## Aufgaben\n\n- [ ] Neu`;
    const first = plan(md);
    expect(first.insert).toHaveLength(1);
    const after = [...existing, task({ id: "n", title: "Neu" })];
    expect(planTaskSectionSync(after, parseTaskSection(md) ?? [], NOW)).toEqual({ update: [], insert: [] });
  });

  it("does nothing for a note without the section", () => {
    expect(parseTaskSection("# N\n\n- [ ] irgendwas")).toBeNull();
  });
});

describe("task section in two languages", () => {
  const tasks = [
    task({ id: A, title: "Send slides", timeframe: "this_week", due_date: "2026-11-05T00:00:00Z", context: "why" }),
    task({ id: B, title: "Check contract", status: "done" }),
  ];

  it("writes a new section in the current language", () => {
    const md = withLocale("en", () => withTaskSection("# Sync\n\nNotes.\n", tasks));
    expect(md).toBe(
      `# Sync\n\nNotes.\n\n## Tasks\n\n- [ ] Send slides · Timeframe: this week · Due: 2026-11-05 · Context: why <!-- task:${A} -->\n- [x] Check contract <!-- task:${B} -->\n`,
    );
    // Read back in German mode as well: every reader accepts both forms.
    expect(parseTaskSection(md)).toEqual([
      { title: "Send slides", done: false, project: null, timeframe: "this_week", due: "2026-11-05", context: "why", id: A },
      { title: "Check contract", done: true, project: null, timeframe: null, due: null, context: null, id: B },
    ]);
  });

  it("keeps the heading and the language of an existing section, whatever the current language is", () => {
    const german = `# M\n\n## Aufgaben\n\n- [ ] Send slides <!-- task:${A} -->\n\n## Danach\n\nRest`;
    expect(withLocale("en", () => withTaskSection(german, tasks))).toBe(
      `# M\n\n## Aufgaben\n\n- [ ] Send slides · Zeitrahmen: diese Woche · Fällig: 2026-11-05 · Kontext: why <!-- task:${A} -->\n- [x] Check contract <!-- task:${B} -->\n\n## Danach\n\nRest`,
    );
    const english = `## Tasks\n\n- [ ] Send slides <!-- task:${A} -->`;
    expect(withTaskSection(english, tasks)).toBe(
      `## Tasks\n\n- [ ] Send slides · Timeframe: this week · Due: 2026-11-05 · Context: why <!-- task:${A} -->\n- [x] Check contract <!-- task:${B} -->`,
    );
  });

  it("reads German sections in English mode", () => {
    const md = `## Aufgaben\n\n- [ ] Vertrag prüfen · Zeitrahmen: heute · Fällig: 2026-11-05 · Kontext: wichtig`;
    expect(withLocale("en", () => parseTaskSection(md))).toEqual([
      { title: "Vertrag prüfen", done: false, project: null, timeframe: "today", due: "2026-11-05", context: "wichtig", id: null },
    ]);
  });
});
