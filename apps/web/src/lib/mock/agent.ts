import { t } from "@/i18n";
import type { JobView, StandingOrderView } from "@/lib/agent-jobs";

/*
 * Mock fixtures of the agent page (/agent) for the mock mode (KORTEX_DATA_SOURCE=mock): one job waiting for a
 * confirmation (steps with times, entities and wiki links, three changes with their facts, a question back), two
 * running jobs with progress, three finished today and three standing orders. Without them nobody can check the
 * agent page, the sidebar dot or the Orbit-Bar chip without an account. Times are relative to "now" so the groups
 * ("Heute erledigt") hold. The texts follow the mock vault (Dr. Priya Shah, Q4 Architecture Sync, Northwind).
 */

/** Today at hh:mm (local), as ISO. */
function at(now: Date, hh: number, mm: number): string {
  const d = new Date(now);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

/** YYYY-MM-DD of the day after `now` (local). */
function tomorrow(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const base = (id: string, title: string, patch: Partial<JobView>): JobView => ({
  id,
  title,
  prompt: title,
  skill: null,
  autonomy: "ask",
  status: "done",
  origin: "standing",
  actionItemId: null,
  result: null,
  error: null,
  createdAt: "",
  startedAt: null,
  finishedAt: null,
  ...patch,
});

export function mockAgentJobs(now: Date = new Date()): JobView[] {
  const briefing = t("Briefing Q4 Architecture Sync");
  return [
    base("mock-job-briefing", briefing, {
      prompt: `/briefing Dr. Priya Shah`,
      skill: "briefing",
      status: "waiting",
      createdAt: at(now, 5, 58),
      startedAt: at(now, 5, 58),
      finishedAt: at(now, 6, 2),
      result: {
        steps: [
          { kind: "read", label: t("Read the dossier of **Dr. Priya Shah**, found 3 open points"), at: at(now, 5, 58) },
          { kind: "read", label: t("Went through **3 meetings**: kick-off, offer, review preparation"), at: at(now, 5, 59) },
          { kind: "search", label: t("Searched the vault for “platform migration”, **6 sources**"), at: at(now, 6, 0) },
          { kind: "write", label: t("Wrote the briefing: [[{title}]]", { title: briefing }), at: at(now, 6, 2) },
        ],
        proposal: {
          actions: [
            { kind: "task_create", title: t("Send the tiered prices to Priya"), due_date: tomorrow(now) },
            { kind: "dossier_update", item_id: "o-p1", item_title: "Dr. Priya Shah", state: t("Priya reviews the offer. Two phases are decided.") },
            { kind: "note_edit", item_id: "n9", item_title: "Platform Strategy: Build, Partner or Buy", append_markdown: `[[${briefing}]]` },
          ],
          labels: [
            t("New task: **Send the tiered prices to Priya**"),
            t("Dossier Dr. Priya Shah: add to “Where things stand”"),
            t("Link the briefing with [[Platform Strategy: Build, Partner or Buy]]"),
          ],
        },
        answer_md: t("I did not calculate the tiered prices myself, because the vault only holds the old price list from 2025. Shall I use the new one from “Pricing ideas”?"),
      },
    }),
    base("mock-job-research", t("Research: backups for Hetzner"), {
      origin: "manual",
      status: "running",
      createdAt: at(now, 6, 30),
      startedAt: at(now, 6, 30),
      result: {
        steps: [
          { kind: "search", label: t("Searched the web for “Hetzner storage box backup”, **11 sources**"), at: at(now, 6, 30) },
          { kind: "read", label: t("Reads source 7 of 11"), at: at(now, 6, 34) },
        ],
        progress: { done: 7, total: 11, label: t("Reads source 7 of 11") },
      },
    }),
    base("mock-job-inbox", t("Tidy up the Inbox"), {
      origin: "presort",
      status: "running",
      createdAt: at(now, 6, 40),
      startedAt: at(now, 6, 40),
      result: { steps: [{ kind: "read", label: t("Reads **12 entries** of the Inbox"), at: at(now, 6, 40) }], progress: { done: 4, total: 12, label: t("12 entries · 4 sorted") } },
    }),
    base("mock-job-dossier", t("Dossier Dr. Priya Shah updated"), {
      createdAt: at(now, 6, 8),
      startedAt: at(now, 6, 8),
      finishedAt: at(now, 6, 10),
      result: { steps: [{ kind: "read", label: t("Read the dossier of **Dr. Priya Shah**, found 3 open points"), at: at(now, 6, 8) }], done: { results: [{ ok: true, label: t("Dossier Dr. Priya Shah: “Where things stand” updated"), item_id: "o-p1" }] } },
    }),
    base("mock-job-clippings", t("5 clippings filed"), {
      createdAt: at(now, 6, 15),
      startedAt: at(now, 6, 15),
      finishedAt: at(now, 6, 18),
      result: { done: { results: [{ ok: true, label: t("5 clippings moved to 30_Web") }] } },
    }),
    base("mock-job-reading", t("Weekly reading summarised"), {
      createdAt: at(now, 6, 20),
      startedAt: at(now, 6, 20),
      finishedAt: at(now, 6, 25),
      result: { answer_md: t("Three of the five articles this week are about agents with memory. The best one: “MCP Servers for Support Knowledge”.") },
    }),
  ];
}

export function mockStandingOrders(): StandingOrderView[] {
  const order = (id: string, title: string, cadence: "daily" | "weekly", hour: number, weekday: number | null): StandingOrderView => ({
    id,
    title,
    prompt: title,
    cadence,
    hour,
    weekday,
    autonomy: "ask",
    enabled: true,
    lastPeriod: null,
  });
  return [
    order("mock-order-stack", t("Prepare the daily stack"), "daily", 6, null),
    order("mock-order-dossier", t("Update dossiers after the day's meetings and suggest tasks"), "daily", 18, null),
    order("mock-order-review", t("Draft the weekly review"), "weekly", 18, 7),
  ];
}
