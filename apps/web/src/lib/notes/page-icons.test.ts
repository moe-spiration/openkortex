import { describe, expect, it } from "vitest";
import { cleanCoverUrl, cleanIcon } from "@/server/notes/service";
import { PAGE_ICONS, pageIcon, searchPageIcons } from "./page-icons";

describe("W4 page icons (monochrome Lucide, searchable)", () => {
  it("has unique kebab-case names", () => {
    const names = PAGE_ICONS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(cleanIcon(n), n).toBe(n);
  });
  it("finds icons by German words and by name", () => {
    expect(searchPageIcons("buch").map((p) => p.name)).toContain("book-open");
    expect(searchPageIcons("ZIEL").map((p) => p.name)).toContain("target");
    expect(searchPageIcons("rocket").map((p) => p.name)).toEqual(["rocket"]);
    expect(searchPageIcons("")).toHaveLength(PAGE_ICONS.length);
    expect(searchPageIcons("gibtsnicht")).toEqual([]);
  });
  it("resolves stored names; unknown names fall back to nothing", () => {
    expect(pageIcon("book-open")?.name).toBe("book-open");
    expect(pageIcon("not-an-icon")).toBeNull();
    expect(pageIcon(null)).toBeNull();
  });
});

describe("W4 cover / icon values saved on the item", () => {
  it("accepts http(s) cover URLs and clears with null", () => {
    expect(cleanCoverUrl("https://images.unsplash.com/photo-1?w=1600")).toBe("https://images.unsplash.com/photo-1?w=1600");
    expect(cleanCoverUrl(null)).toBeNull();
    expect(cleanCoverUrl("")).toBeNull();
    expect(() => cleanCoverUrl("javascript:alert(1)")).toThrow();
    expect(() => cleanCoverUrl("not a url")).toThrow();
  });
  it("rejects icon values that are not Lucide names", () => {
    expect(cleanIcon(null)).toBeNull();
    expect(() => cleanIcon("😀")).toThrow();
    expect(() => cleanIcon("Book Open")).toThrow();
  });
});
