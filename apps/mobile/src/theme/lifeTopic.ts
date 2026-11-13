import type { TileTopic } from "@kortex/theme-packs";

/** Theme-pack topic of a Life area key (the six areas share their ids with the manifest). */
const LIFE = new Set(["health", "career", "finance", "ventures", "relations", "growth"]);

export const lifeTopic = (key: string): TileTopic | null => (LIFE.has(key) ? (key as TileTopic) : null);
