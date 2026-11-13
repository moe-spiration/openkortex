import { describe, expect, it } from "vitest";
import { REGISTERED_TYPES, TYPE_REGISTRY, isDomainObjectType } from "@kortex/db";
import { CONTENT_TYPES, CURATED_SPACES, TYPE_SPACES, buildSpaces, findSpace, spaceItems } from "./spaces";
import { registryIconOrNull } from "./shell/registry-icons";

describe("spaces from the type registry", () => {
  it("every registry content type lands in exactly one space, objects in none", () => {
    const all = [...CURATED_SPACES, ...TYPE_SPACES].filter((s) => s.types);
    for (const t of CONTENT_TYPES) expect(all.filter((s) => s.types!.includes(t)).map((s) => s.key)).toHaveLength(1);
    for (const t of REGISTERED_TYPES.filter(isDomainObjectType)) expect(all.some((s) => s.types!.includes(t))).toBe(false);
    // Curated groups only name registered types.
    for (const s of all) for (const t of s.types!) expect(REGISTERED_TYPES).toContain(t);
  });

  it("type spaces carry the registry label and an icon that resolves", () => {
    const movie = TYPE_SPACES.find((s) => s.key === "movie");
    expect(movie).toMatchObject({ label: TYPE_REGISTRY.movie.label, lucide: TYPE_REGISTRY.movie.icon, types: ["movie"] });
    for (const s of TYPE_SPACES) expect(registryIconOrNull(s.lucide!), s.key).not.toBeNull();
    expect(TYPE_SPACES.map((s) => s.key)).toEqual(expect.arrayContaining(["email", "product", "place", "snippet", "inspiration", "receipt", "prompt"]));
  });

  it("Sessions is a curated space and stays listed while empty", () => {
    expect(CURATED_SPACES.map((s) => s.key)).toContain("session");
    expect(TYPE_SPACES.some((s) => s.key === "session")).toBe(false);
    expect(buildSpaces([]).find((s) => s.key === "session")).toMatchObject({ count: 0, types: ["session"] });
  });

  it("every content type's registry icon resolves (objects use @kortex/ui OBJECT_TYPES)", () => {
    for (const t of CONTENT_TYPES) expect(registryIconOrNull(TYPE_REGISTRY[t].icon), t).not.toBeNull();
  });

  it("counts by registry type; type spaces show only with items", () => {
    const spaces = buildSpaces(["note", "daily_note", "pdf", "book", "movie", "movie", "receipt", "person"]);
    const count = (k: string) => spaces.find((s) => s.key === k)?.count;
    expect(count("all")).toBe(7);
    expect(count("notes")).toBe(2);
    expect(count("books")).toBe(2);
    expect(count("movie")).toBe(2);
    expect(count("receipt")).toBe(1);
    expect(count("recipes")).toBe(0); // curated spaces stay
    expect(spaces.some((s) => s.key === "prompt")).toBe(false);
    expect(spaces.map((s) => s.key).slice(0, CURATED_SPACES.length)).toEqual(CURATED_SPACES.map((s) => s.key));
  });

  it("finds unlisted type spaces and filters items by registry type", () => {
    const spaces = buildSpaces([]);
    expect(findSpace(spaces, "prompt")).toMatchObject({ key: "prompt", count: 0 });
    expect(findSpace(spaces, "nope")).toBeUndefined();
    const items = [
      { id: "a", type: "video", dbType: "movie" },
      { id: "b", type: "video", dbType: "video" },
      { id: "c", type: "ai" }, // mock item without dbType
    ];
    expect(spaceItems(findSpace(spaces, "movie")!, items).map((i) => i.id)).toEqual(["a"]);
    expect(spaceItems(findSpace(spaces, "videos")!, items).map((i) => i.id)).toEqual(["b"]);
    expect(spaceItems(findSpace(spaces, "ai")!, items).map((i) => i.id)).toEqual(["c"]);
    expect(spaceItems(findSpace(spaces, "all")!, items)).toHaveLength(3);
  });
});
