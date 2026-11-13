/*
 * Life areas as pages (same rules as apps/web/src/lib/life/page.ts): every area has one ordinary note in
 * 10_Notes/Life Areas for the vision, ideas and images, found by its folder and the tag #life/<key>.
 * Goals, habits and tasks live in Griply; Kortex keeps no scores. Pure, covered by tests.
 */

export const LIFE_PAGE_FOLDER = "10_Notes/Life Areas";
export const lifeTag = (key: string) => `#life/${key}`;

interface PageRow {
  id: string;
  folder_path: string;
  tags: readonly string[] | null;
  status?: string | null;
  created_at: string;
}

const hasTag = (tags: readonly string[] | null, tag: string) => (tags ?? []).some((x) => (x.startsWith("#") ? x : `#${x}`).toLowerCase() === tag.toLowerCase());

/** The area's page: the oldest note in the Life Areas folder that carries the area's tag. */
export function findLifePage<R extends PageRow>(rows: readonly R[], key: string): R | undefined {
  return rows
    .filter((r) => r.status !== "archived" && r.folder_path === LIFE_PAGE_FOLDER && hasTag(r.tags, lifeTag(key)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
}

/** First text of a new area page: the vision so far (if any), then room for ideas and images. */
export function lifePageTemplate(vision: string, locale: "en" | "de"): string {
  const h = locale === "de" ? { vision: "Vision", ideas: "Ideen", images: "Bilder" } : { vision: "Vision", ideas: "Ideas", images: "Images" };
  return `## ${h.vision}\n\n${vision.trim()}\n\n## ${h.ideas}\n\n\n## ${h.images}\n`.replace(/\n{3,}/g, "\n\n");
}
