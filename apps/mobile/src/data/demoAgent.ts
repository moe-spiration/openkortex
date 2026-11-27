import type { JobView, StandingOrderView } from "../lib/agentJobs";

/*
 * Demo jobs and standing orders of the agent page (mock mode only, no account): one job that waits for the user's OK
 * with its steps and three proposed changes, one that runs, two finished today, three standing orders. Like the other
 * demo data (data/mock.ts) the content is plain English sample text, it is not part of the UI copy.
 */

const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export function demoJobs(): JobView[] {
  return [
    {
      id: "dj1",
      title: "Briefing for the architecture review",
      prompt: "Prepare a briefing for the architecture review with Jonas",
      skill: "briefing",
      autonomy: "ask",
      status: "waiting",
      origin: "standing",
      actionItemId: null,
      error: null,
      createdAt: at(5, 58),
      startedAt: at(5, 58),
      finishedAt: at(6, 2),
      result: {
        steps: [
          { kind: "read", label: "Read the dossier Jonas Weber" },
          { kind: "read", label: "Reviewed meetings", count: 3 },
          { kind: "search", label: "Searched the vault for sources", count: 6 },
          { kind: "write", label: "Wrote the briefing" },
        ],
        answer_md: "The tiered prices are not calculated yet, because the vault only holds the price list from 2025.",
        proposal: { actions: [], labels: ["Task: send the tiered prices", "Dossier: add to where things stand", "Link with Platform migration"] },
        sources: [
          { n: 1, item_id: "e2", title: "Q4 architecture sync", type: "meeting" },
          { n: 2, item_id: "e12", title: "Weekly with Tom", type: "meeting" },
        ],
      },
    },
    { id: "dj2", title: "Research: backups for Hetzner", prompt: "Research backups for Hetzner", skill: "research", autonomy: "read", status: "running", origin: "manual", actionItemId: null, error: null, result: null, createdAt: new Date(Date.now() - 4 * 60_000).toISOString(), startedAt: new Date(Date.now() - 4 * 60_000).toISOString(), finishedAt: null },
    { id: "dj3", title: "Five clippings filed", prompt: "File new clippings", skill: null, autonomy: "self", status: "done", origin: "standing", actionItemId: null, error: null, result: { done: { results: [{ ok: true, label: "Moved 5 entries to 30_Clippings" }] } }, createdAt: at(6, 15), startedAt: at(6, 15), finishedAt: at(6, 18) },
    { id: "dj4", title: "Weekly reading summarised", prompt: "Summarise this week's reading", skill: null, autonomy: "read", status: "done", origin: "manual", actionItemId: null, error: null, result: { answer_md: "Three articles on agent memory, one book chapter on retrieval." }, createdAt: at(6, 20), startedAt: at(6, 20), finishedAt: at(6, 25) },
  ];
}

export function demoOrders(): StandingOrderView[] {
  return [
    { id: "do1", title: "After every meeting", prompt: "After every meeting update the dossier and suggest tasks", cadence: "daily", hour: 18, weekday: null, autonomy: "ask", enabled: true, lastPeriod: null },
    { id: "do2", title: "Daily stack", prompt: "Every morning at 6 prepare the daily stack", cadence: "daily", hour: 6, weekday: null, autonomy: "self", enabled: true, lastPeriod: null },
    { id: "do3", title: "Weekly review", prompt: "Every Sunday at 18 draft my weekly review", cadence: "weekly", hour: 18, weekday: 7, autonomy: "ask", enabled: false, lastPeriod: null },
  ];
}
