import { describe, expect, it } from "vitest";
import { copilotSystemPrompt } from "../chat/prompts";
import {
  buildSynthesisPrompt,
  generateSynthesis,
  loadFocusContext,
  monthlyPeriod,
  ownNotesOf,
  PROMPT_BUDGET,
  renderSynthesisMarkdown,
  SYNTHESIS_TASK,
  synthesisPath,
  topAreas,
  weeklyPeriod,
  type SynthesisInput,
  type SynthesisItem,
  type SynthesisOutput,
} from "../digest/synthesis";
import type { AuthContext } from "../auth";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, NOW, seedFolders, setup, USER_ID } from "./helpers";

const out = (headline = "Woche im Zeichen von MCP."): SynthesisOutput => ({
  headline,
  themes: [
    {
      title: "Agenten-Schnittstelle",
      summary: "MCP wurde beschlossen.",
      items: ["Q4 Architektur-Sync", "Erfundener Titel"],
    },
  ],
  connections: ["Das Meeting setzt die Notiz zur Suche fort."],
  open_loops: ["Deepgram-Keys fehlen noch."],
  questions: ["Brauchen wir einen eigenen Agenten-Ordner?"],
  suggestions: ["MCP-Server testen.", "Docs schreiben.", "Review planen.", "Vierter Vorschlag."],
  areas: [
    { name: "Kortex", summary: "Viel MCP-Arbeit. Zweiter Satz." },
    { name: "Erfunden", summary: "Nicht erwartet." },
  ],
  trends: ["Mehr Meetings als im September."],
  focus: { topics: ["MCP", "Suche"], projects: ["Kortex"], interests: ["Kochen"] },
});

const item = (over: Partial<SynthesisItem> & { id: string; title: string }): SynthesisItem => ({
  type: "note",
  summary: null,
  content_md: "Inhalt",
  cluster_name: "Kortex",
  folder_path: "10_Notes",
  tags: [],
  updated_at: "2026-10-21T10:00:00Z",
  ...over,
});

function seed(extra: Record<string, unknown>[] = []) {
  const db = new FakeSupabase({
    knowledge_items: [
      {
        id: "m1",
        user_id: USER_ID,
        slug: "q4",
        title: "Q4 Architektur-Sync",
        type: "meeting",
        summary: "MCP beschlossen.",
        content_md: "…",
        cluster_name: "Kortex",
        folder_path: "20_Meetings",
        tags: ["kortex"],
        updated_at: "2026-10-21T10:00:00Z",
      },
      {
        id: "old",
        user_id: USER_ID,
        slug: "alt",
        title: "Alte Notiz",
        type: "note",
        summary: null,
        content_md: "alt",
        cluster_name: null,
        folder_path: "10_Notes",
        tags: [],
        updated_at: "2026-09-01T10:00:00Z",
      },
      {
        id: "o1",
        user_id: "99999999-9999-4999-8999-999999999999",
        slug: "fremd",
        title: "Fremd",
        type: "note",
        summary: null,
        content_md: "x",
        cluster_name: null,
        folder_path: "10_Notes",
        tags: [],
        updated_at: "2026-10-21T10:00:00Z",
      },
      ...extra,
    ],
    action_items: [
      {
        id: "t1",
        user_id: USER_ID,
        title: "Deepgram-Keys einrichten",
        status: "open",
        priority: "high",
        due_date: "2026-10-30",
        completed_at: null,
        created_at: "2026-10-22T10:00:00Z",
      },
    ],
  });
  seedFolders(db);
  return db;
}

const ctxOf = (db: FakeSupabase): AuthContext => ({
  userId: USER_ID,
  mode: "api_token",
  client: db.client,
});

describe("synthesis periods and paths", () => {
  it("weekly: ISO week key of the local date, last 7 days, 90_Digests/Weekly/YYYY-Www.md", () => {
    const p = weeklyPeriod(new Date(Date.UTC(2026, 9, 23)), NOW);
    expect(p).toMatchObject({
      kind: "weekly",
      key: "2026-W43",
      label: "KW 43/2026",
      title: "Wochensynthese KW 43/2026",
      end: NOW.toISOString(),
      start: "2026-10-16T08:00:00.000Z",
    });
    expect(synthesisPath(p)).toBe("90_Digests/Weekly/2026-W43.md");
    // Week 1 of 2027 starts in 2026; week 53 of 2026 ends in 2027.
    expect(weeklyPeriod(new Date(Date.UTC(2027, 0, 1)), NOW).key).toBe("2026-W53");
    expect(weeklyPeriod(new Date(Date.UTC(2025, 11, 29)), NOW).key).toBe("2026-W01");
  });

  it("monthly: the month before the run date, 90_Digests/Monthly/YYYY-MM.md", () => {
    const p = monthlyPeriod(new Date(Date.UTC(2026, 10, 1)));
    expect(p).toMatchObject({
      kind: "monthly",
      key: "2026-10",
      label: "Oktober 2026",
      start: "2026-10-01T00:00:00.000Z",
      end: "2026-11-01T00:00:00.000Z",
    });
    expect(synthesisPath(p)).toBe("90_Digests/Monthly/2026-10.md");
    // January run → December of the previous year.
    expect(monthlyPeriod(new Date(Date.UTC(2027, 0, 1))).key).toBe("2026-12");
  });

  it("routes weekly to summarize and monthly to chat_reasoning (ADR-06, no model ids)", () => {
    expect(SYNTHESIS_TASK).toEqual({ weekly: "summarize", monthly: "chat_reasoning" });
  });
});

describe("synthesis prompt", () => {
  const base = (over: Partial<SynthesisInput> = {}): SynthesisInput => ({
    period: weeklyPeriod(new Date(Date.UTC(2026, 9, 23)), NOW),
    items: [
      item({ id: "a", title: "Q4 Architektur-Sync", type: "meeting", summary: "MCP beschlossen." }),
    ],
    tasks: [],
    openTasks: [
      {
        id: "t",
        title: "Keys einrichten",
        status: "open",
        priority: "high",
        due_date: "2026-10-30",
        completed_at: null,
      },
    ],
    weeklyDigests: [],
    previousFocus: "## Aktuelle Fokus-Themen\n\n- Suche",
    reminders: [],
    areas: [],
    previousMonth: null,
    ...over,
  });

  it("lists items, tasks, open loops and the previous focus", () => {
    const prompt = buildSynthesisPrompt(base());
    expect(prompt).toContain("Zeitraum: Wochensynthese KW 43/2026 (16.10.2026 bis 23.10.2026)");
    expect(prompt).toContain(
      "- [meeting] Q4 Architektur-Sync (21.10.2026, Kortex): MCP beschlossen.",
    );
    expect(prompt).toContain(
      "Offene Aufgaben insgesamt:\n- [open] Keys einrichten (high, fällig 30.10.2026)",
    );
    expect(prompt).toContain("Aufgaben im Zeitraum (angelegt oder erledigt):\n(keine)");
    expect(prompt).toContain("Bisheriges automatisches Fokus-Profil:\n## Aktuelle Fokus-Themen");
  });

  it("stays within the budget and says how much it cut", () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      item({ id: `i${i}`, title: `Eintrag ${i}`, content_md: "x".repeat(5_000) }),
    );
    const prompt = buildSynthesisPrompt(base({ items: many }));
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_BUDGET.weekly);
    expect(prompt).toMatch(/\(\+\d+ weitere gekürzt\)/);
    // Each entry is clipped, not the whole body.
    expect(prompt).not.toContain("x".repeat(700));
  });

  it("monthly puts the weekly syntheses first", () => {
    const prompt = buildSynthesisPrompt(
      base({
        period: monthlyPeriod(new Date(Date.UTC(2026, 10, 1))),
        weeklyDigests: [{ title: "Wochensynthese KW 43/2026", content_md: "# W43\n\nMCP." }],
      }),
    );
    expect(prompt.indexOf("Wochensynthesen des Monats:")).toBeLessThan(prompt.indexOf("Einträge"));
    expect(prompt).toContain("### Wochensynthese KW 43/2026\n# W43");
  });

  it("renders all sections; wiki links only for real titles; at most 3 suggestions", () => {
    const md = renderSynthesisMarkdown(base(), out());
    expect(md).toMatch(
      /^# Wochensynthese KW 43\/2026\n\n> Zeitraum 16\.10\.2026 – 23\.10\.2026 · 1 Einträge · 0 Aufgaben/,
    );
    for (const h of [
      "## Themen der Woche",
      "### Agenten-Schnittstelle",
      "## Verbindungen",
      "## Offene Schleifen & Aufgaben",
      "## Fragen zum Wiederaufgreifen",
      "## 3 Vorschläge für nächste Woche",
      "## Fokus",
      "## Quellen",
    ])
      expect(md).toContain(h);
    expect(md).toContain("Bezüge: [[Q4 Architektur-Sync]]");
    expect(md).not.toContain("[[Erfundener Titel]]");
    expect(md).toContain("3. Review planen.");
    expect(md).not.toContain("Vierter Vorschlag");
    expect(md).toContain("- **Projekte:** Kortex");
  });
});

describe("generateSynthesis", () => {
  it("writes the weekly synthesis and the focus profile with one AI call", async () => {
    const db = seed();
    const fast = mockModel([out()]);
    const s = setup({ db, models: mockRouter({ fast }) });
    const period = weeklyPeriod(new Date(Date.UTC(2026, 9, 23)), NOW);
    const r = await generateSynthesis(s.deps, ctxOf(db), period, s.models);
    expect(r).toMatchObject({
      status: "created",
      period: "2026-W43",
      path: "90_Digests/Weekly/2026-W43.md",
    });
    expect(fast.doGenerateCalls).toHaveLength(1);

    const prompt = JSON.stringify(fast.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("Q4 Architektur-Sync");
    expect(prompt).toContain("Deepgram-Keys einrichten");
    expect(prompt).not.toContain("Alte Notiz");
    expect(prompt).not.toContain("Fremd");

    const digest = db.rows("knowledge_items").find((i) => i.id === r.item_id)!;
    expect(digest).toMatchObject({
      type: "digest",
      slug: "2026-W43",
      title: "Wochensynthese KW 43/2026",
      folder_path: "90_Digests/Weekly",
      is_manual_placement: true,
      summary: "Woche im Zeichen von MCP.",
      related_item_ids: ["m1"],
    });
    // Same week label as the per-group digests: the weekly review shows the headline.
    expect(digest.metadata).toMatchObject({
      kind: "weekly",
      period: "2026-W43",
      iso_week: "KW 43/2026",
      model_used: "mock/fast",
    });
    expect(db.rows("folders").some((f) => f.folder_path === "90_Digests/Weekly")).toBe(true);
    expect(db.rows("item_chunks").some((c) => c.item_id === r.item_id)).toBe(true);

    const focus = db.rows("knowledge_items").find((i) => i.id === r.focus_profile_id)!;
    expect(focus).toMatchObject({
      slug: "Focus-Profile",
      folder_path: "40_AI_Memories",
      type: "note",
    });
    expect(focus.content_md).toContain("## Aktuelle Fokus-Themen\n\n- MCP\n- Suche");
    expect(focus.content_md).toContain("[[Wochensynthese KW 43/2026]]");
  });

  it("is idempotent: no second digest and no AI call for the same period", async () => {
    const db = seed();
    const fast = mockModel([out("v1"), out("v2")]);
    const s = setup({ db, models: mockRouter({ fast }) });
    const period = weeklyPeriod(new Date(Date.UTC(2026, 9, 23)), NOW);
    const first = await generateSynthesis(s.deps, ctxOf(db), period, s.models);
    const second = await generateSynthesis(s.deps, ctxOf(db), period, s.models);
    expect(second).toMatchObject({ status: "exists", item_id: first.item_id });
    expect(fast.doGenerateCalls).toHaveLength(1);
    const weekly = () =>
      db.rows("knowledge_items").filter((i) => i.folder_path === "90_Digests/Weekly");
    expect(weekly()).toHaveLength(1);

    // rerun updates the same item in place.
    const third = await generateSynthesis(s.deps, ctxOf(db), period, s.models, { rerun: true });
    expect(third).toMatchObject({ status: "updated", item_id: first.item_id });
    expect(weekly()).toHaveLength(1);
    expect(weekly()[0]?.summary).toBe("v2");
  });

  it("a quiet period writes nothing and calls no model", async () => {
    const db = new FakeSupabase({ knowledge_items: [], action_items: [] });
    seedFolders(db);
    const fast = mockModel([out()]);
    const s = setup({ db, models: mockRouter({ fast }) });
    const r = await generateSynthesis(
      s.deps,
      ctxOf(db),
      weeklyPeriod(new Date(Date.UTC(2026, 9, 23)), NOW),
      s.models,
    );
    expect(r.status).toBe("empty");
    expect(fast.doGenerateCalls).toHaveLength(0);
    // Nothing generated; only the (idempotent) focus profile template exists.
    expect(db.rows("knowledge_items").map((i) => i.slug)).toEqual(["Focus-Profile"]);
  });

  it("monthly reads the month's weekly syntheses, uses chat_reasoning and keeps the user's focus notes", async () => {
    const db = seed([
      {
        id: "w43",
        user_id: USER_ID,
        slug: "2026-W43",
        title: "Wochensynthese KW 43/2026",
        type: "digest",
        summary: "W43",
        content_md: "# Wochensynthese KW 43/2026\n\nMCP beschlossen.",
        folder_path: "90_Digests/Weekly",
        tags: [],
        metadata: { period_end: "2026-10-23T08:00:00.000Z" },
        updated_at: "2026-10-23T08:00:00Z",
      },
      {
        id: "w39",
        user_id: USER_ID,
        slug: "2026-W39",
        title: "Wochensynthese KW 39/2026",
        type: "digest",
        summary: "W39",
        content_md: "September-Woche",
        folder_path: "90_Digests/Weekly",
        tags: [],
        metadata: { period_end: "2026-09-25T08:00:00.000Z" },
        updated_at: "2026-09-25T08:00:00Z",
      },
      {
        id: "fp",
        user_id: USER_ID,
        slug: "Focus-Profile",
        title: "Fokus-Profil",
        type: "note",
        summary: null,
        content_md:
          "# Fokus-Profil\n\n## Aktuelle Fokus-Themen\n\n- Alt\n\n## Eigene Notizen\n\n- Mehr Sport!",
        folder_path: "40_AI_Memories",
        tags: [],
        metadata: {},
        updated_at: "2026-10-22T08:00:00Z",
      },
    ]);
    const chat = mockModel([out("Oktober: MCP.")]);
    const fast = mockModel([out()]);
    const s = setup({ db, models: mockRouter({ chat, fast }) });
    const r = await generateSynthesis(
      s.deps,
      ctxOf(db),
      monthlyPeriod(new Date(Date.UTC(2026, 10, 1))),
      s.models,
    );
    expect(r).toMatchObject({
      status: "created",
      path: "90_Digests/Monthly/2026-10.md",
      focus_profile_id: "fp",
    });
    expect(chat.doGenerateCalls).toHaveLength(1);
    expect(fast.doGenerateCalls).toHaveLength(0);
    const prompt = JSON.stringify(chat.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("MCP beschlossen.");
    expect(prompt).not.toContain("September-Woche");
    // The focus profile is input context, never an activity item.
    expect(prompt).not.toContain("[note] Fokus-Profil");

    const monthly = db.rows("knowledge_items").find((i) => i.id === r.item_id)!;
    expect(monthly).toMatchObject({
      slug: "2026-10",
      folder_path: "90_Digests/Monthly",
      title: "Monatssynthese Oktober 2026",
    });
    expect(monthly.metadata).toMatchObject({
      kind: "monthly",
      weekly_digest_count: 1,
      model_used: "mock/chat",
    });
    expect(monthly.content_md).toContain("- [[Wochensynthese KW 43/2026]]");

    const focus = db.rows("knowledge_items").find((i) => i.id === "fp")!;
    expect(focus.content_md).toContain("- MCP");
    expect(focus.content_md).not.toContain("- Alt");
    expect(focus.content_md).toContain("## Eigene Notizen\n\n- Mehr Sport!");
  });
});

describe("focus profile as copilot context", () => {
  it("loads a lean, bounded version, null without a profile", async () => {
    const db = seed([
      {
        id: "fp",
        user_id: USER_ID,
        slug: "Focus-Profile",
        title: "Fokus-Profil",
        type: "note",
        content_md:
          "# Fokus-Profil\n\n> Automatisch aktualisiert.\n\n## Aktuelle Fokus-Themen\n\n- MCP",
        folder_path: "40_AI_Memories",
      },
    ]);
    const ctx = await loadFocusContext(db.client, USER_ID);
    expect(ctx).toBe("## Aktuelle Fokus-Themen\n\n- MCP");
    expect(await loadFocusContext(seed().client, USER_ID)).toBeNull();
    expect(ownNotesOf("# x\n\n## Eigene Notizen\n\n- a")).toBe("## Eigene Notizen\n\n- a");
    expect(ownNotesOf("# x")).toBeNull();
  });

  it("goes into the system prompt only when present", () => {
    const withFocus = copilotSystemPrompt("brain", [], "2026-10-23", { focus: "- MCP" });
    expect(withFocus).toContain("Fokus-Profil des Nutzers");
    expect(withFocus).toContain("- MCP");
    expect(copilotSystemPrompt("brain", [], "2026-10-23")).not.toContain("Fokus-Profil");
  });
});

describe("deep synthesis additions", () => {
  it("topAreas: top-level user folders and tags by activity, system folders ignored, max 3", () => {
    const mk = (id: string, folder_path: string, tags: string[] = []) =>
      item({ id, title: id, folder_path, tags });
    const areas = topAreas([
      mk("a1", "Reisen/Japan"),
      mk("a2", "Reisen"),
      mk("a3", "10_Notes", ["kortex", "digest/weekly"]),
      mk("a4", "10_Notes", ["kortex"]),
      mk("a5", "10_Notes", ["kortex"]),
      mk("a6", "Steuern"),
      mk("a7", "20_Meetings", ["ai/x"]),
      mk("a8", "Zeta"),
    ]);
    expect(areas).toEqual([
      { name: "kortex", items: 3 },
      { name: "Reisen", items: 2 },
      { name: "Steuern", items: 1 },
    ]);
  });

  it("weekly Markdown: changes, reminders, watched pages, Bereiche only for the top areas", () => {
    const input: SynthesisInput = {
      period: weeklyPeriod(new Date(Date.UTC(2026, 9, 23)), NOW),
      items: [
        item({ id: "w", title: "Preisseite", metadata: { watch: { url: "https://x.test" } } }),
      ],
      tasks: [
        {
          id: "d",
          title: "Fertig",
          status: "done",
          priority: "low",
          due_date: null,
          completed_at: "x",
        },
      ],
      openTasks: [],
      weeklyDigests: [],
      previousFocus: null,
      reminders: [{ title: "Steuer prüfen", remind_at: "2026-10-25T08:00:00Z" }],
      areas: [{ name: "Kortex", items: 1 }],
      previousMonth: null,
    };
    const md = renderSynthesisMarkdown(input, out());
    expect(md).toContain("## Was sich geändert hat");
    expect(md).toContain("- Erledigte Aufgaben: 1");
    expect(md).toContain("- Erinnerungen: 1");
    expect(md).toContain("- Beobachtete Seiten mit Änderung: 1");
    expect(md).toContain(
      "## Bereiche\n\n### Kortex (1 Einträge)\n\nViel MCP-Arbeit. Zweiter Satz.",
    );
    expect(md).not.toContain("Erfunden");
    const prompt = buildSynthesisPrompt(input);
    expect(prompt).toContain("Steuer prüfen (25.10.2026)");
    expect(prompt).toContain("Beobachtete Seiten mit Änderung:\n- Preisseite");
    expect(prompt).toContain("- Kortex (1 Einträge)");
  });

  it("focus profile: template on first digest (also when empty), idempotent, user lists kept and read", async () => {
    const db = seed();
    const fast = mockModel([out()]);
    const s = setup({ db, models: mockRouter({ fast }) });
    const quiet = weeklyPeriod(new Date(Date.UTC(2026, 0, 9)), new Date("2026-01-09T08:00:00Z"));
    const empty = await generateSynthesis(s.deps, ctxOf(db), quiet, s.models);
    expect(empty.status).toBe("empty");
    const focus = () =>
      db
        .rows("knowledge_items")
        .filter((i) => i.folder_path === "40_AI_Memories" && i.slug === "Focus-Profile");
    expect(focus()).toHaveLength(1);
    for (const h of ["### Ziele", "### Themen", "### Ignorieren"])
      expect(focus()[0]?.content_md).toContain(h);

    focus()[0]!.content_md = String(focus()[0]?.content_md).replace(
      "### Ignorieren\n\n-",
      "### Ignorieren\n\n- Fußball",
    );
    const period = weeklyPeriod(new Date(Date.UTC(2026, 9, 23)), NOW);
    await generateSynthesis(s.deps, ctxOf(db), period, s.models);
    expect(focus()).toHaveLength(1);
    expect(JSON.stringify(fast.doGenerateCalls[0]?.prompt)).toContain("Fußball");
    expect(focus()[0]?.content_md).toContain("- Fußball");
    expect(focus()[0]?.content_md).toContain("- MCP");
  });

  it("weekly run: top areas and reminders in the prompt, areas in metadata", async () => {
    const db = seed([
      {
        id: "r1",
        user_id: USER_ID,
        slug: "r",
        title: "Remind",
        type: "note",
        summary: null,
        content_md: "x",
        cluster_name: null,
        folder_path: "10_Notes",
        tags: [],
        metadata: {},
        remind_at: "2026-10-25T08:00:00Z",
        updated_at: "2026-09-01T10:00:00Z",
      },
    ]);
    const fast = mockModel([out()]);
    const s = setup({ db, models: mockRouter({ fast }) });
    const period = weeklyPeriod(new Date(Date.UTC(2026, 9, 23)), NOW);
    const r = await generateSynthesis(s.deps, ctxOf(db), period, s.models);
    const prompt = JSON.stringify(fast.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("Aktivste Bereiche");
    expect(prompt).toContain("- kortex (1 Einträge)");
    expect(prompt).toContain("Remind (25.10.2026)");
    const row = db.rows("knowledge_items").find((i) => i.id === r.item_id)!;
    expect(row.folder_path).toBe("90_Digests/Weekly");
    expect(row.metadata).toMatchObject({ areas: ["kortex"] });
  });

  it("monthly: trends vs the previous month, period Oct 1 to Nov 1", async () => {
    const p = monthlyPeriod(new Date(Date.UTC(2026, 10, 1)));
    expect([p.start, p.end]).toEqual(["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]);
    const db = seed([
      {
        id: "sep",
        user_id: USER_ID,
        slug: "2026-09",
        title: "Monatssynthese September 2026",
        type: "digest",
        summary: null,
        content_md: "September: Reisen.",
        folder_path: "90_Digests/Monthly",
        tags: [],
        metadata: {},
        updated_at: "2026-10-01T08:00:00Z",
      },
    ]);
    const chat = mockModel([out("Oktober")]);
    const s = setup({ db, models: mockRouter({ chat }) });
    const r = await generateSynthesis(s.deps, ctxOf(db), p, s.models);
    const prompt = JSON.stringify(chat.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("Vormonat (für Trends)");
    expect(prompt).toContain("September: Reisen.");
    const md = String(db.rows("knowledge_items").find((i) => i.id === r.item_id)?.content_md);
    expect(md).toContain("## Trends gegenüber dem Vormonat\n\n- Mehr Meetings als im September.");
    expect(md).not.toContain("## Bereiche");
    expect(monthlyPeriod(new Date(Date.UTC(2027, 1, 1))).key).toBe("2027-01");
  });
});
