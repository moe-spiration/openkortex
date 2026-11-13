import { describe, expect, it } from "vitest";
import { findLifePage, lifePageTemplate, lifeSubpages, lifeTag } from "./page";

const item = (id: string, path: string, tags: string[] = [], links: string[] = [], date = "2026-11-10", status?: string) => ({ id, path, tags, links, date, ...(status ? { status } : {}) });

describe("life pages", () => {
  const items = [
    item("later", "10_Notes/Life Areas/Health-2.md", ["#life/health"], [], "2026-11-12"),
    item("page", "10_Notes/Life Areas/Health.md", ["life/Health"], [], "2026-11-10"),
    item("gone", "10_Notes/Life Areas/Alt.md", ["#life/health"], [], "2026-01-01", "archived"),
    item("else", "10_Notes/Health.md", ["#life/health"]),
    item("career", "10_Notes/Life Areas/Career.md", ["#life/career"], ["page"]),
    item("sub", "10_Notes/Life Areas/Trainingsplan.md", [], ["page"]),
    item("linked", "30_Clippings/Hyrox.md", [], ["page"]),
  ];

  it("finds the oldest tagged note in the Life Areas folder", () => {
    expect(lifeTag("health")).toBe("#life/health");
    expect(findLifePage(items, "health")?.id).toBe("page");
    expect(findLifePage(items, "career")?.id).toBe("career");
    expect(findLifePage(items, "finance")).toBeUndefined();
  });

  it("lists subpages: same folder, linked to the page, no area page", () => {
    expect(lifeSubpages(items, items[1]!).map((i) => i.id)).toEqual(["sub"]);
  });

  it("starts a page with the vision and room for ideas and images", () => {
    expect(lifePageTemplate(" Fit für einen Hyrox. ", "de")).toBe("## Vision\n\nFit für einen Hyrox.\n\n## Ideen\n\n## Bilder\n");
    expect(lifePageTemplate("", "en")).toBe("## Vision\n\n## Ideas\n\n## Images\n");
  });
});
