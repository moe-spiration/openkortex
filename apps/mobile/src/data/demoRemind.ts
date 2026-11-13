/** Demo-mode reminders (entry id → hours from now): one overdue since yesterday, one due this morning, one due right now. Kept apart from mock.ts, which needs the RN asset runtime. */
const DEMO_REMIND_HOURS: Record<string, number> = { e3: -20, e10: -2, e6: 0.001 };

export const demoRemindAt = (id: string, now: Date = new Date()): string | null => {
  const h = DEMO_REMIND_HOURS[id];
  return h === undefined ? null : new Date(now.getTime() + h * 3600_000).toISOString();
};
