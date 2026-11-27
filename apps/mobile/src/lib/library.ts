import type { Entry } from "../data/mock";
import type { CoverSource } from "../theme/cover";
import { isPackCover } from "../theme/cover";

/*
 * Ruhe Bibliothek (2026-11-26): Smart Mixes and the week band of the mobile library, as pure functions.
 * A mix is a hashtag that at least two entries share (like the web MixesRail); the week band counts entries per
 * day of the current week (Monday first).
 */

export type Lens = "types" | "objects" | "vault";

/** The lens follows the existing filters: Vault = the folder view, Objekte = the object chip, else Typen. */
export function lensOf(scope: string, chip: string): Lens {
  if (scope === "folders") return "vault";
  if (chip === "object") return "objects";
  return "types";
}

/** Scope and chip a lens switches to. */
export function lensFilters(lens: Lens): { scope: "all" | "folders"; chip: string } {
  if (lens === "vault") return { scope: "folders", chip: "all" };
  if (lens === "objects") return { scope: "all", chip: "object" };
  return { scope: "all", chip: "all" };
}

export interface Mix {
  tag: string;
  label: string;
  count: number;
  /** Up to four covers of the mix's own entries (no pack tiles), for the collage. */
  imgs: CoverSource[];
}

const bare = (tag: string) => tag.replace(/^#/, "").trim();

export function mixesOf(entries: readonly Entry[], max = 8): Mix[] {
  const by = new Map<string, Entry[]>();
  for (const e of entries) {
    const tag = bare(e.tag ?? "");
    if (!tag) continue;
    const key = tag.toLowerCase();
    const l = by.get(key);
    if (l) l.push(e);
    else by.set(key, [e]);
  }
  return [...by.values()]
    .filter((l) => l.length >= 2)
    .sort((a, b) => b.length - a.length || bare(a[0]!.tag).localeCompare(bare(b[0]!.tag)))
    .slice(0, max)
    .map((l) => ({
      tag: l[0]!.tag,
      label: bare(l[0]!.tag).split("/").pop() || bare(l[0]!.tag),
      count: l.length,
      imgs: l
        .map((e) => e.img)
        .filter((img) => !!img && !isPackCover(img))
        .slice(0, 4),
    }));
}

/** True when the entry carries the mix's tag or a sub-tag of it (#fitness covers #fitness/running). */
export function inMix(e: Entry, tag: string): boolean {
  const own = bare(e.tag ?? "").toLowerCase();
  const m = bare(tag).toLowerCase();
  return !!m && (own === m || own.startsWith(m + "/"));
}

export interface WeekDay {
  /** Days ago (0 = today); negative for days later this week. */
  ago: number;
  date: number;
  /** Monday = 0. */
  weekday: number;
  today: boolean;
  /** Tags of up to three entries of that day, for the dots. */
  dots: string[];
}

/** The seven days of the current week (Monday first) with their entries' tags. */
export function weekOf(entries: readonly Entry[], now: Date = new Date()): WeekDay[] {
  const wd = (now.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const ago = wd - i;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago);
    const dots = entries
      .filter((e) => e.day === ago)
      .slice(0, 3)
      .map((e) => e.tag);
    return { ago, date: d.getDate(), weekday: i, today: ago === 0, dots };
  });
}
