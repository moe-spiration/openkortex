import type { TileTopic } from "@kortex/theme-packs";

/*
 * Maps the app's own keys to theme-pack topics (manifest.surfaces). Pure, shared by the pack surfaces.
 * Auto-space keys come from lib/mock/workspace.ts (`videos` is the manifest topic `video`).
 */

const SPACE_TOPICS: Record<string, TileTopic> = {
  all: "all",
  notes: "notes",
  meetings: "meetings",
  articles: "articles",
  books: "books",
  videos: "video",
  ai: "ai",
  recipes: "recipes",
};

/** Topic of an auto-space key, or null for keys without one. */
export const spaceTopic = (key: string): TileTopic | null => SPACE_TOPICS[key] ?? null;

/** Background topic of a SpaceView scope (`space:<key>`); vault folders and domain objects have none. */
export function spaceHeroTopic(scope: string): TileTopic | null {
  return scope.startsWith("space:") ? spaceTopic(scope.slice("space:".length)) : null;
}

const LIFE_TOPICS = new Set(["health", "career", "finance", "ventures", "relations", "growth"]);

/** Topic of a Life area key (`overview` has none). */
export const lifeTopic = (key: string): TileTopic | null => (LIFE_TOPICS.has(key) ? (key as TileTopic) : null);
