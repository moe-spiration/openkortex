import { DAILY_NOTES, isLiveData } from "@/lib/workspace-data";
import type { EnergyDay } from "./TodayOverview";

/** Mock: energy of the 13 days before the frozen mock day, oldest first (null = no check-in). */
const MOCK_ENERGY_BEFORE: (number | null)[] = [7, 6, 8, null, 7, 9, 8, 6, 7, null, 8, 5, 7];

/** Bars of the streak tile in "Heute im Überblick" (dummy: 14). */
export const HISTORY_DAYS = 14;

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The last `days` days ending today (default 7), oldest first. Earlier days come from the daily notes'
 * check-in energy (snapshot), today from the live check-in state so the bar follows the picker at once.
 */
export function energyHistory(
  today: string,
  todayEnergy: number | null,
  notes: readonly { date: string; energy?: number | null }[],
  days = 7,
): EnergyDay[] {
  const byDate = new Map(notes.map((n) => [n.date, n.energy ?? null]));
  return Array.from({ length: days }, (_, i) => {
    const date = shift(today, i - (days - 1));
    return { date, energy: i === days - 1 ? todayEnergy : (byDate.get(date) ?? null) };
  });
}

/** Daily notes with their energy: live from the snapshot, mock from the fixed series above. */
export function energyNotes(today: string): { date: string; energy: number | null }[] {
  if (isLiveData()) return DAILY_NOTES as { date: string; energy?: number | null }[] as { date: string; energy: number | null }[];
  return MOCK_ENERGY_BEFORE.map((energy, i) => ({ date: shift(today, i - MOCK_ENERGY_BEFORE.length), energy }));
}
