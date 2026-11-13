import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withLocale } from "@kortex/i18n";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLDER_BY_TYPE,
  DOMAIN_OBJECT_TYPES,
  KNOWLEDGE_ITEM_TYPES,
  PRIORITIES,
  SYSTEM_FOLDER_PATHS,
} from "./domain";
import {
  URL_RULE_NAMES,
  typeFromTags,
  typeFromUrl,
  typeSuggestionGuide,
  FOLDER_TYPE_INFERENCE,
  NEW_TYPED_TYPES,
  TYPE_REGISTRY,
  FIELD_LABELS,
  STATUS_LABELS,
  fieldLabel,
  statusLabel,
  typeLabel,
  metadataFields,
  typeStatuses,
  validateTypeMetadata,
} from "./type-registry";

const migrationsDir = join(__dirname, "..", "supabase", "migrations");
const migration = readFileSync(join(migrationsDir, "20261101000000_type_registry.sql"), "utf8");

describe("type registry", () => {
  it("is the single source of the type list", () => {
    expect([...KNOWLEDGE_ITEM_TYPES]).toEqual(Object.keys(TYPE_REGISTRY));
    expect(KNOWLEDGE_ITEM_TYPES).toHaveLength(32);
    expect([...NEW_TYPED_TYPES]).toEqual([
      "movie", "book", "product", "place", "snippet", "inspiration", "receipt", "prompt", "session",
    ]);
  });

  it("matches the type CHECK constraint of the migration", () => {
    const check = /knowledge_items_type_check check \(\s*type in \(([\s\S]*?)\)\s*\);/.exec(migration);
    expect(check).not.toBeNull();
    const inDb = [...(check?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...inDb].sort()).toEqual([...KNOWLEDGE_ITEM_TYPES].sort());
  });

  it("creates every typed folder in _bootstrap_user", () => {
    for (const type of NEW_TYPED_TYPES) {
      const [parent, name] = [
        TYPE_REGISTRY[type].folder.split("/")[0],
        TYPE_REGISTRY[type].folder.split("/")[1],
      ];
      expect(migration).toContain(`('${parent}'`);
      expect(migration).toContain(`'${name}'`);
    }
  });

  it("every folder is a system folder or below one", () => {
    for (const t of KNOWLEDGE_ITEM_TYPES) {
      expect(SYSTEM_FOLDER_PATHS as readonly string[]).toContain(DEFAULT_FOLDER_BY_TYPE[t]);
    }
  });

  it("keeps PRIORITIES in sync with the registry schema", () => {
    const parsed = TYPE_REGISTRY.project.metadata.safeParse({ priority: "urgent" });
    expect(parsed.success).toBe(true);
    for (const p of PRIORITIES) {
      expect(TYPE_REGISTRY.project.metadata.safeParse({ priority: p }).success).toBe(true);
    }
    expect(TYPE_REGISTRY.project.metadata.safeParse({ priority: "x" }).success).toBe(false);
  });

  it("infers a type from the deepest matching folder", () => {
    const map = new Map(FOLDER_TYPE_INFERENCE);
    expect(map.get("30_Clippings/Movies")).toBe("movie");
    expect(map.get("40_AI_Memories/Prompts")).toBe("prompt");
    expect(map.get("40_AI_Memories")).toBe("ai_chat");
    const idx = (f: string) => FOLDER_TYPE_INFERENCE.findIndex(([p]) => p === f);
    expect(idx("40_AI_Memories/Prompts")).toBeLessThan(idx("40_AI_Memories"));
    expect(idx("10_Notes/Daily")).toBeGreaterThanOrEqual(0);
  });

  it("has a metadata schema for every object and new type", () => {
    for (const t of [...DOMAIN_OBJECT_TYPES, ...NEW_TYPED_TYPES]) {
      expect(TYPE_REGISTRY[t].metadata).not.toBeNull();
      expect(metadataFields(t).length).toBeGreaterThan(0);
    }
  });

  it("exposes the lifecycle enums", () => {
    expect(typeStatuses("movie")).toEqual(["to_watch", "watched"]);
    expect(typeStatuses("book")).toEqual(["want_to_read", "reading", "read"]);
    expect(typeStatuses("product")).toEqual(["wishlist", "owned"]);
    expect(typeStatuses("note")).toEqual([]);
  });

  it("validates typed metadata strictly", () => {
    expect(
      validateTypeMetadata("movie", { kind: "series", status: "to_watch", rating: 8, genres: ["scifi"], feedback: "gut" }).ok,
    ).toBe(true);
    expect(validateTypeMetadata("movie", { status: "reading" }).ok).toBe(false);
    expect(validateTypeMetadata("book", { status: "reading", isbn: "978" }).ok).toBe(true);
    expect(validateTypeMetadata("place", { category: "hotel" }).ok).toBe(false);
    expect(validateTypeMetadata("receipt", { amount: 12.5, currency: "EUR", date: "2026-10-31" }).ok).toBe(true);
    expect(validateTypeMetadata("receipt", { date: "31.10.2026" }).ok).toBe(false);
    expect(validateTypeMetadata("session", { tabs: [{ url: "https://a.de", title: "A" }], saved_at: "2026-10-31T10:00:00Z" }).ok).toBe(true);
    expect(validateTypeMetadata("prompt", { variables: ["name"], typo: 1 }).ok).toBe(false);
  });

  it("lenient mode keeps unknown fields but still checks known ones", () => {
    const ok = validateTypeMetadata("book", { status: "read", source_x: 1 }, { lenient: true });
    expect(ok).toEqual({ ok: true, metadata: { status: "read", source_x: 1 } });
    expect(validateTypeMetadata("book", { status: "nope" }, { lenient: true }).ok).toBe(false);
    expect(validateTypeMetadata("book", { source_x: 1 }).ok).toBe(false);
  });

  it("lets free types accept any metadata", () => {
    expect(validateTypeMetadata("note", { anything: 1 })).toEqual({ ok: true, metadata: { anything: 1 } });
  });

  it("no later migration redefines the bootstrap folders of the type registry", () => {
    const names = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    const at = names.indexOf("20261101000000_type_registry.sql");
    expect(at).toBeGreaterThanOrEqual(0);
    for (const later of names.slice(at + 1))
      expect(readFileSync(join(migrationsDir, later), "utf8")).not.toMatch(/_bootstrap_user/);
  });
});

describe("display labels", () => {
  it("label every status and every typed field", async () => {
    const r = await import("./type-registry");
    for (const t of r.REGISTERED_TYPES) {
      for (const s of r.typeStatuses(t)) expect(r.STATUS_LABELS[s], `${t}.${s}`).toBeTruthy();
      for (const f of r.metadataFields(t)) if (f !== "contact_info") expect(r.FIELD_LABELS[f], `${t}.${f}`).toBeTruthy();
    }
  });
});

describe("typeFromUrl (domain rules)", () => {
  const cases: Array<[rule: string, url: string, type: string]> = [
    ["youtube", "https://www.youtube.com/watch?v=abcDEF12345", "video"],
    ["youtube", "https://www.youtube.com/clip/UgkxAbCdEfGh", "video"],
    ["youtube", "https://youtu.be/abcDEF12345", "video"],
    ["youtube", "https://www.youtube.com/shorts/abcDEF12345", "video"],
    ["amazon-isbn", "https://www.amazon.de/Atomic-Habits/dp/0735211299/ref=sr_1_1", "book"],
    ["amazon-isbn", "https://www.amazon.com/gp/product/080213825X", "book"],
    ["amazon-product", "https://www.amazon.de/dp/B0CHX1W1XY", "product"],
    ["goodreads", "https://www.goodreads.com/book/show/40121378-atomic-habits", "book"],
    ["openlibrary", "https://openlibrary.org/works/OL17930368W/Atomic_Habits", "book"],
    ["google-books", "https://books.google.com/books?id=XfFvDwAAQBAJ", "book"],
    ["imdb", "https://www.imdb.com/title/tt0133093/", "movie"],
    ["tmdb", "https://www.themoviedb.org/movie/603-the-matrix", "movie"],
    ["letterboxd", "https://letterboxd.com/film/the-matrix/", "movie"],
    ["vimeo", "https://vimeo.com/76979871", "video"],
    ["spotify-podcast", "https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk", "podcast"],
    ["apple-podcasts", "https://podcasts.apple.com/de/podcast/foo/id123", "podcast"],
    ["instagram", "https://www.instagram.com/reel/C9xYz123AbC/", "social"],
    ["tiktok", "https://www.tiktok.com/@chef/video/7351234567890123456", "social"],
    ["x-post", "https://x.com/someone/status/1234567890", "social"],
    ["twitch-vod", "https://www.twitch.tv/videos/123456789", "video"],
    ["justwatch", "https://www.justwatch.com/de/film/the-matrix", "movie"],
    ["thalia-hugendubel", "https://www.thalia.de/shop/home/artikeldetails/A1", "book"],
    ["google-maps", "https://www.google.com/maps/place/Berlin", "place"],
    ["tripadvisor", "https://www.tripadvisor.de/Restaurant_Review-g187323", "place"],
  ];
  it.each(cases)("%s: %s → %s", (rule, url, type) => {
    expect(typeFromUrl(url)).toMatchObject({ rule, type });
  });
  it("covers every rule with an example", () => {
    const covered = new Set(cases.map((c) => c[0]));
    const missing = URL_RULE_NAMES.filter((r) => !covered.has(r));
    expect(missing).toEqual([]);
  });
  it("ignores plain pages, bad URLs and non-content YouTube pages", () => {
    expect(typeFromUrl("https://www.heise.de/news/x.html")).toBeNull();
    expect(typeFromUrl("https://www.youtube.com/@channel")).toBeNull();
    expect(typeFromUrl("not a url")).toBeNull();
    expect(typeFromUrl(undefined)).toBeNull();
  });
});

describe("typeFromTags", () => {
  it("maps tag words (also nested) to a type", () => {
    expect(typeFromTags(["buch", "selbstorganisation"])).toBe("book");
    expect(typeFromTags(["medien/Film", "scifi"])).toBe("movie");
    expect(typeFromTags(["finanzen/rechnung"])).toBe("receipt");
  });
  it("is null for no hint or conflicting hints", () => {
    expect(typeFromTags(["ai/mcp", "lesen"])).toBeNull();
    expect(typeFromTags(["buch", "film"])).toBeNull();
  });
});

describe("typeSuggestionGuide", () => {
  it("lists the retypable registry types", () => {
    const guide = typeSuggestionGuide();
    for (const t of ["movie", "book", "product", "place", "receipt", "snippet", "inspiration"])
      expect(guide).toContain(`"${t}"`);
  });
});

describe("labels follow the language at the time they are read", () => {
  it("translates type, status and field labels through the exported shapes", () => {
    expect(TYPE_REGISTRY.note.label).toBe("Notiz");
    expect(typeLabel("movie")).toBe("Film/Serie");
    expect(STATUS_LABELS.read).toBe("Gelesen");
    expect(fieldLabel("target_metric")).toBe("Zielgröße");
    withLocale("en", () => {
      expect(TYPE_REGISTRY.note.label).toBe("Note");
      expect(typeLabel("movie")).toBe("Movie/series");
      expect(statusLabel("read")).toBe("Read");
      expect(FIELD_LABELS.target_metric).toBe("Target metric");
    });
    expect(Object.keys(TYPE_REGISTRY.note)).toContain("label");
    expect(Object.keys(FIELD_LABELS)).toContain("email");
  });
});
