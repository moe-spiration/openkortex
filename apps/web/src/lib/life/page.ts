/*
 * Life areas as pages: every area has one ordinary note in the vault (10_Notes/Life Areas/<Name>.md)
 * for the vision, ideas and images. It is found by its folder and the tag #life/<key>, so the user can
 * rename it. Goals, habits and tasks of an area live in the task tool (Griply) and are only shown.
 * Pure, covered by tests.
 */

export const LIFE_PAGE_FOLDER = "10_Notes/Life Areas";
export const lifeTag = (key: string) => `#life/${key}`;

interface PageLike {
  id: string;
  path: string;
  tags: readonly string[];
  links: readonly string[];
  date: string;
  time?: string;
  status?: string;
}

const hasTag = (tags: readonly string[], tag: string) => tags.some((x) => (x.startsWith("#") ? x : `#${x}`).toLowerCase() === tag.toLowerCase());
const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");

/** The area's page: the oldest note in the Life Areas folder that carries the area's tag. */
export function findLifePage<T extends PageLike>(items: readonly T[], key: string): T | undefined {
  return items
    .filter((i) => i.status !== "archived" && folderOf(i.path) === LIFE_PAGE_FOLDER && hasTag(i.tags, lifeTag(key)))
    .sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))[0];
}

/** Subpages of an area page: notes in the same folder that link to it and are no area page themselves. */
export function lifeSubpages<T extends PageLike>(items: readonly T[], page: PageLike): T[] {
  return items
    .filter((i) => i.id !== page.id && i.status !== "archived" && folderOf(i.path) === folderOf(page.path) && i.links.includes(page.id) && !i.tags.some((x) => /^#?life\//i.test(x)))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** First text of a new area page: the vision so far (if any), then room for ideas and images. */
export function lifePageTemplate(vision: string, locale: "en" | "de"): string {
  const h = locale === "de" ? { vision: "Vision", ideas: "Ideen", images: "Bilder" } : { vision: "Vision", ideas: "Ideas", images: "Images" };
  return `## ${h.vision}\n\n${vision.trim()}\n\n## ${h.ideas}\n\n\n## ${h.images}\n`.replace(/\n{3,}/g, "\n\n");
}
