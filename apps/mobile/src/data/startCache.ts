import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ItemRow, LiveBackIn, LiveHome, LiveLife, TaskRow } from "./live";

/*
 * Start cache: the last live load (entries, tasks, home and life answers) is kept on the phone, so the
 * next app start shows the vault at once while the fresh load runs (stale while revalidate).
 * Rows are stored whole, never shortened: an entry opened from the cache must not lose text on save.
 * Android keeps one AsyncStorage value below ~2 MB, so rows go in newest first until the budget is used.
 */

export interface StartSnapshot {
  v: 1;
  at: number;
  items: ItemRow[];
  tasks: TaskRow[] | null;
  home: ({ backIn: LiveBackIn[] } & Partial<LiveHome>) | null;
  life: LiveLife | null;
}

/** Byte budget for one snapshot (UTF-16 length as an upper estimate of the stored size). */
export const SNAPSHOT_BUDGET = 1_500_000;

const PREFIX = "kortex.start.v1:";

export const snapshotKey = (server: string | null, email: string | null): string | null => (email ? `${PREFIX}${server ?? ""}|${email.toLowerCase()}` : null);

/** The newest rows that fit into the budget next to the other parts; null when not even the rest fits. */
export function fitSnapshot(snap: StartSnapshot, budget = SNAPSHOT_BUDGET): StartSnapshot | null {
  const base = JSON.stringify({ ...snap, items: [] }).length;
  if (base > budget) return null;
  let used = base;
  const items: ItemRow[] = [];
  for (const row of snap.items) {
    const size = JSON.stringify(row).length + 1;
    if (used + size > budget) break;
    used += size;
    items.push(row);
  }
  return { ...snap, items };
}

export function parseSnapshot(raw: string | null): StartSnapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<StartSnapshot>;
    if (s.v !== 1 || !Array.isArray(s.items)) return null;
    return { v: 1, at: s.at ?? 0, items: s.items, tasks: Array.isArray(s.tasks) ? s.tasks : null, home: s.home ?? null, life: s.life ?? null };
  } catch {
    return null;
  }
}

export async function readSnapshot(key: string | null): Promise<StartSnapshot | null> {
  if (!key) return null;
  try {
    return parseSnapshot(await AsyncStorage.getItem(key));
  } catch {
    return null;
  }
}

export async function writeSnapshot(key: string | null, snap: StartSnapshot): Promise<void> {
  if (!key) return;
  const fit = fitSnapshot(snap);
  if (!fit) return;
  try {
    await AsyncStorage.setItem(key, JSON.stringify(fit));
  } catch {
    /* storage full or unavailable: the app simply starts without the cache */
  }
}

/** Removes every stored snapshot (sign-out, server change): no vault content stays on the phone. */
export async function clearSnapshots(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    /* nothing to clear */
  }
}
