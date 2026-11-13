import { t } from "@/i18n";
import { z } from "zod";

/*
 * Daily check-in habits per user (WP-M): user_settings.habits = [{ key, label }] in display order.
 * The done-state of a day stays in the daily note (metadata.checkin.habits, keyed by `key`), so
 * renaming keeps the key and history; a new habit gets a fresh key. Pure, shared by the settings
 * patch check, the check-in widget and the tests.
 */

export interface HabitDef {
  key: string;
  label: string;
}

export const MAX_HABITS = 12;
export const MAX_HABIT_LABEL = 60;

/** Same as the column default of migration 20261027000000. */
export const DEFAULT_HABITS: HabitDef[] = [
  { key: "mob", label: "Morning Mobility" },
  { key: "carb", label: "Low-Carb Fokus" },
];

export const HabitDefSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, { error: () => t("Invalid habit key") }),
  label: z.string().trim().min(1, { error: () => t("A habit needs a name") }).max(MAX_HABIT_LABEL, { error: () => t("Habit name is too long") }),
});

export const HabitsSchema = z
  .array(HabitDefSchema)
  .max(MAX_HABITS, { error: () => t("At most {max} habits", { max: MAX_HABITS }) })
  .refine((hs) => new Set(hs.map((h) => h.key)).size === hs.length, { error: () => t("Duplicate habit key") });

/** Stored habits, or the defaults when the value is missing or malformed. */
export function habitDefs(raw: unknown): HabitDef[] {
  const r = HabitsSchema.safeParse(raw);
  return r.success ? r.data : DEFAULT_HABITS.map((h) => ({ ...h }));
}

/** A key for a new habit from its label, unique among `existing`. */
export function habitKey(label: string, existing: readonly string[]): string {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "habit";
  let key = base;
  for (let i = 2; existing.includes(key); i++) key = `${base}-${i}`.slice(0, 40);
  return key;
}

/** A day's habits in definition order, keeping the done-state of keys that already existed. */
export function applyHabitDefs<T extends { key: string; done: boolean }>(
  current: readonly T[],
  defs: readonly HabitDef[],
): { key: string; label: string; done: boolean }[] {
  const done = new Map(current.map((h) => [h.key, h.done]));
  return defs.map((d) => ({ key: d.key, label: d.label, done: done.get(d.key) ?? false }));
}
