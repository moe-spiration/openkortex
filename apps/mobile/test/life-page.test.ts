import { describe, expect, it } from "vitest";
import { findLifePage, LIFE_PAGE_FOLDER, lifePageTemplate } from "../src/lib/lifePage";

const row = (id: string, over: Partial<{ folder_path: string; tags: string[] | null; status: string; created_at: string }> = {}) => ({
  id,
  folder_path: LIFE_PAGE_FOLDER,
  tags: ["life/health"],
  status: "processed",
  created_at: "2026-11-01T10:00:00Z",
  ...over,
});

describe("findLifePage", () => {
  it("takes the oldest tagged note in the Life Areas folder, with or without #", () => {
    const rows = [row("new", { created_at: "2026-11-05T10:00:00Z", tags: ["#life/health"] }), row("old"), row("other", { tags: ["life/career"] })];
    expect(findLifePage(rows, "health")?.id).toBe("old");
    expect(findLifePage(rows, "career")?.id).toBe("other");
  });
  it("ignores archived notes and other folders", () => {
    expect(findLifePage([row("a", { status: "archived" }), row("b", { folder_path: "10_Notes" })], "health")).toBeUndefined();
  });
});

describe("lifePageTemplate", () => {
  it("writes the vision and empty sections in the user's language", () => {
    expect(lifePageTemplate("Fit mit 50", "de")).toBe("## Vision\n\nFit mit 50\n\n## Ideen\n\n## Bilder\n");
    expect(lifePageTemplate("", "en")).toBe("## Vision\n\n## Ideas\n\n## Images\n");
  });
});
