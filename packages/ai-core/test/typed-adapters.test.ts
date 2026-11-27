import { describe, expect, it } from "vitest";
import { validateTypeMetadata } from "@kortex/db";
import { createDefaultRegistry } from "../src/adapters";
import { createTypedCaptureAdapter } from "../src/adapters/typed-capture.adapter";
import {
  createVoiceMemoAdapter,
  renderVoiceMarkdown,
  type VoiceSynthesis,
} from "../src/adapters/voice-memo.adapter";
import { createVisionOcrAdapter } from "../src/adapters/vision-ocr.adapter";
import {
  appendMentions,
  normalizeEnrichment,
  type Enrichment,
  type OrganizeInput,
  type OrganizerContext,
} from "../src/enrichment/auto-organizer";
import { AdapterDeclinedError } from "../src/errors";
import { ingest, type IngestContext, type IngestDeps } from "../src/pipeline/ingest";
import { createMemoryStorageGateway } from "../src/storage";
import { findImdbId, findIsbn, normalizeIsbn } from "../src/typed/external-ids";
import { PNG_1PX } from "./fixtures/make-epub";
import { failingModel, ITEM_ID, mockEmbeddingModel, mockModel, staticRouter, USER_ID } from "./helpers";

const blank = {
  title: "",
  description_md: "",
  movie_kind: null,
  year: null,
  director: null,
  genres: [],
  cast: [],
  imdb_id: null,
  author: null,
  isbn: null,
  themes: [],
  price: null,
  currency: null,
  shop: null,
  url: null,
  specs: [],
  place_category: null,
  location: null,
  issuer: null,
  date: null,
  amount: null,
  tax: null,
  receipt_category: null,
  items: [],
  language: null,
  source: null,
  inspiration_kind: null,
};
const answer = (o: Record<string, unknown>) => ({ ...blank, ...o });

const capture = (typeHint: string, rawText: string, extra: Record<string, unknown> = {}) => ({
  userId: USER_ID,
  itemId: ITEM_ID,
  typeHint: typeHint as never,
  rawText,
  ...extra,
});

function typedAdapter(fast: ReturnType<typeof mockModel>, vision?: ReturnType<typeof mockModel>) {
  const storage = createMemoryStorageGateway();
  const adapter = createTypedCaptureAdapter({
    models: staticRouter({ fast, ...(vision ? { vision } : {}) }),
    storage,
    now: () => new Date("2026-11-01T10:00:00Z"),
  });
  return { adapter, storage };
}

/** Metadata the adapter wrote minus the provenance field: must pass the registry's own schema. */
function registryMetadata(type: string, metadata: Record<string, unknown>) {
  // Adapter extras (provenance, receipt line items) are allowed by the lenient pipeline validation.
  const rest = Object.fromEntries(
    Object.entries(metadata).filter(([k]) => !["typed_by", "original_file_name", "items"].includes(k)),
  );
  return validateTypeMetadata(type, rest);
}

describe("external ids", () => {
  it("accepts only checksum-valid ISBNs, normalised", () => {
    expect(findIsbn("Buch, ISBN 978-3-16-148410-0, toll")).toBe("9783161484100");
    expect(findIsbn("ISBN: 0-306-40615-2")).toBe("0306406152");
    expect(findIsbn("Bestellnummer 978-3-16-148410-1")).toBeUndefined();
    expect(findIsbn("https://www.amazon.de/dp/0306406152?tag=x")).toBe("0306406152");
    expect(normalizeIsbn("123")).toBeUndefined();
  });

  it("reads the IMDb id from a URL or bare text", () => {
    expect(findImdbId("https://www.imdb.com/de/title/tt0133093/")).toBe("tt0133093");
    expect(findImdbId("kein Film")).toBeUndefined();
  });
});

describe("typed-capture adapter", () => {
  it("only claims typed hints with text (or a receipt photo)", () => {
    const { adapter } = typedAdapter(mockModel(answer({})));
    expect(adapter.canHandle(capture("movie", "Matrix"))).toBe(true);
    expect(adapter.canHandle(capture("note", "Matrix"))).toBe(false);
    expect(adapter.canHandle({ ...capture("movie", ""), rawText: " " })).toBe(false);
    expect(
      adapter.canHandle({
        userId: USER_ID,
        typeHint: "receipt",
        fileBuffer: PNG_1PX,
        mimeType: "image/png",
      }),
    ).toBe(true);
    expect(
      adapter.canHandle({
        userId: USER_ID,
        typeHint: "movie",
        fileBuffer: PNG_1PX,
        mimeType: "image/png",
      }),
    ).toBe(false);
  });

  it("movie: registry metadata, to_watch default, IMDb id from the text not the model", async () => {
    const { adapter } = typedAdapter(
      mockModel(
        answer({
          title: "Matrix",
          description_md: "Ein Hacker entdeckt die Wahrheit über seine Welt.",
          movie_kind: "movie",
          year: 1999,
          director: "Lana und Lilly Wachowski",
          genres: ["Sci-Fi", "Action"],
          cast: ["Keanu Reeves"],
          imdb_id: "tt9999999",
        }),
      ),
    );
    const out = await adapter.extract(
      capture("movie", "Matrix mal anschauen https://www.imdb.com/title/tt0133093/"),
    );
    expect(out.type).toBe("movie");
    expect(out.metadata).toMatchObject({
      kind: "movie",
      status: "to_watch",
      year: 1999,
      director: "Lana und Lilly Wachowski",
      imdb_id: "tt0133093",
    });
    expect(registryMetadata("movie", out.metadata).ok).toBe(true);
    expect(out.contentMd).toBe(
      [
        "# Matrix",
        "",
        "- **Art:** Film",
        "- **Jahr:** 1999",
        "- **Regie:** Lana und Lilly Wachowski",
        "- **Genres:** Sci-Fi, Action",
        "- **Besetzung:** Keanu Reeves",
        "- **IMDb:** tt0133093",
        "",
        "Ein Hacker entdeckt die Wahrheit über seine Welt.",
      ].join("\n"),
    );
  });

  it("book: ISBN from the text wins over a hallucinated one; want_to_read default", async () => {
    const { adapter } = typedAdapter(
      mockModel(
        answer({ title: "Atomic Habits", author: "James Clear", isbn: "1234567890", themes: ["Gewohnheiten"] }),
      ),
    );
    const out = await adapter.extract(capture("book", "Atomic Habits von James Clear, ISBN 978-3-16-148410-0"));
    expect(out.type).toBe("book");
    expect(out.metadata).toMatchObject({
      status: "want_to_read",
      author: "James Clear",
      isbn: "9783161484100",
    });
    expect(registryMetadata("book", out.metadata).ok).toBe(true);
  });

  it("book: an unverifiable model ISBN is dropped", async () => {
    const { adapter } = typedAdapter(mockModel(answer({ title: "X", author: "Y", isbn: "1234567890" })));
    const out = await adapter.extract(capture("book", "Buch X von Y"));
    expect(out.metadata).not.toHaveProperty("isbn");
  });

  it("product: price, shop, url and wishlist; an invalid currency drops only itself", async () => {
    const { adapter } = typedAdapter(
      mockModel(
        answer({
          title: "Sony WH-1000XM6",
          price: 349.9,
          currency: "Euro",
          shop: "Amazon",
          specs: [{ key: "Akku", value: "30 h" }],
        }),
      ),
    );
    const out = await adapter.extract(
      capture("product", "Kopfhörer für 349,90 € bei Amazon", { url: "https://www.amazon.de/dp/B0XYZ" }),
    );
    expect(out.type).toBe("product");
    expect(out.metadata).toMatchObject({
      status: "wishlist",
      price: 349.9,
      shop: "Amazon",
      url: "https://www.amazon.de/dp/B0XYZ",
      specs: { Akku: "30 h" },
    });
    expect(out.metadata).not.toHaveProperty("currency");
    expect(out.sourceUrl).toBe("https://www.amazon.de/dp/B0XYZ");
    expect(registryMetadata("product", out.metadata).ok).toBe(true);
  });

  it("place: category and address", async () => {
    const { adapter } = typedAdapter(
      mockModel(
        answer({ title: "Trattoria Da Enzo", place_category: "restaurant", location: "Via dei Vascellari 29, Rom" }),
      ),
    );
    const out = await adapter.extract(capture("place", "Trattoria Da Enzo in Trastevere, Rom"));
    expect(out.type).toBe("place");
    expect(out.metadata).toMatchObject({ category: "restaurant", location: "Via dei Vascellari 29, Rom" });
    expect(registryMetadata("place", out.metadata).ok).toBe(true);
    expect(out.contentMd).toContain("- **Kategorie:** Restaurant");
  });

  it("receipt from a photo: stores the image, reads fields via the vision model", async () => {
    const vision = mockModel(
      answer({
        title: "REWE 2026-10-30",
        issuer: "REWE",
        date: "2026-10-30",
        amount: 23.47,
        tax: 1.53,
        currency: "EUR",
        receipt_category: "Lebensmittel",
        items: [
          { name: "Hafermilch", quantity: 2, price: 3.98 },
          { name: "Brot | Bio", quantity: 1, price: 3.49 },
        ],
      }),
    );
    const fast = mockModel(answer({}));
    const { adapter, storage } = typedAdapter(fast, vision);
    const input = {
      userId: USER_ID,
      itemId: ITEM_ID,
      typeHint: "receipt" as const,
      fileBuffer: PNG_1PX,
      mimeType: "image/png",
      fileName: "beleg.png",
    };
    const out = await adapter.extract(input);
    expect(fast.doGenerateCalls).toHaveLength(0);
    expect(vision.doGenerateCalls).toHaveLength(1);
    expect([...storage.files.keys()]).toEqual([`kortex-media/${USER_ID}/${ITEM_ID}.png`]);
    expect(out.type).toBe("receipt");
    expect(out.file).toMatchObject({ mimeType: "image/png" });
    expect(out.metadata).toMatchObject({
      issuer: "REWE",
      date: "2026-10-30",
      amount: 23.47,
      currency: "EUR",
      tax: 1.53,
    });
    expect(registryMetadata("receipt", out.metadata).ok).toBe(true);
    expect(out.contentMd).toContain("| Brot \\| Bio | 1 | 3.49 |");
    expect(out.contentMd).toContain("- **Betrag:** 23.47 EUR");
  });

  it("receipt: an impossible date is dropped, the amount stays", async () => {
    const { adapter } = typedAdapter(
      mockModel(answer({ title: "Beleg", date: "2026-02-31", amount: 10, currency: "€" })),
    );
    const out = await adapter.extract(capture("receipt", "Beleg 10 €"));
    expect(out.metadata).toMatchObject({ amount: 10, currency: "EUR" });
    expect(out.metadata).not.toHaveProperty("date");
  });

  it("snippet: keeps the code verbatim in a fence longer than any backtick run inside", async () => {
    const code = "const s = `a`;\nconsole.log(```x```);";
    const { adapter } = typedAdapter(
      mockModel(answer({ title: "Log-Snippet", language: "TypeScript", description_md: "Gibt aus." })),
    );
    const out = await adapter.extract(capture("snippet", code));
    expect(out.type).toBe("snippet");
    expect(out.metadata).toMatchObject({ language: "typescript" });
    expect(out.contentMd).toContain(`\n\n\`\`\`\`typescript\n${code}\n\`\`\`\`\n`.trimEnd());
  });

  it("inspiration keeps the source URL", async () => {
    const { adapter } = typedAdapter(mockModel(answer({ title: "Brutalist Landing", inspiration_kind: "Design" })));
    const out = await adapter.extract(capture("inspiration", "Schöne Seite", { url: "https://example.com/x" }));
    expect(out.metadata).toMatchObject({ kind: "Design", source: "https://example.com/x" });
    expect(registryMetadata("inspiration", out.metadata).ok).toBe(true);
  });

  it("declines on a model failure, so the plain note adapter still saves the capture", async () => {
    const { adapter } = typedAdapter(failingModel());
    await expect(adapter.extract(capture("movie", "Matrix"))).rejects.toBeInstanceOf(AdapterDeclinedError);

    const models = staticRouter({ fast: failingModel() });
    const registry = createDefaultRegistry({ storage: createMemoryStorageGateway(), models });
    const ids = registry.candidates(capture("movie", "Matrix")).map((a) => a.id);
    expect(ids).toEqual(["typed-capture", "text-note"]);
  });
});

describe("voice-memo adapter", () => {
  const transcript =
    "Also ich muss morgen noch den Vertrag an Herrn Weber schicken und danach mit dem Steuerberater telefonieren. " +
    "Außerdem wollte ich überlegen, ob wir die Preise im Q1 anheben, vielleicht um fünf Prozent, das muss ich mit Anna besprechen.";
  const synthesis: VoiceSynthesis = {
    title: "Vertrag, Steuerberater und Preise",
    tldr: "Zwei Aufgaben für morgen und eine Preisüberlegung.",
    outline: [
      { heading: "Aufgaben", points: ["Vertrag an Herrn Weber", "Steuerberater anrufen"] },
      { heading: "Preise", points: ["+5 % im Q1 prüfen"] },
    ],
    action_items: [
      { title: "Vertrag an Herrn Weber schicken", description: null, priority: "high", due_date: "2026-11-02" },
      { title: "Preise mit Anna besprechen", description: "Anhebung um 5 %", priority: "medium", due_date: "kommende Woche" },
    ],
  };
  const adapterFor = (model: ReturnType<typeof mockModel>) =>
    createVoiceMemoAdapter({
      models: staticRouter({ fast: model }),
      now: () => new Date("2026-11-01T10:00:00Z"),
    });

  it("builds TL;DR, outline, action items and a collapsed raw transcript", async () => {
    const out = await adapterFor(mockModel(synthesis)).extract(capture("voice", transcript));
    expect(out.type).toBe("voice");
    expect(out.titleHint).toBe("Vertrag, Steuerberater und Preise");
    expect(out.contentMd).toBe(
      [
        "## TL;DR",
        "",
        synthesis.tldr,
        "",
        "## Gliederung",
        "",
        "### Aufgaben",
        "",
        "- Vertrag an Herrn Weber",
        "- Steuerberater anrufen",
        "",
        "### Preise",
        "",
        "- +5 % im Q1 prüfen",
        "",
        "## Aufgaben",
        "",
        "- [ ] Vertrag an Herrn Weber schicken · Fällig: 2026-11-02",
        "- [ ] Preise mit Anna besprechen",
        "",
        "> [!toggle]- Transkript",
        ">",
        `> ${transcript}`,
      ].join("\n"),
    );
    expect(out.actionItems).toEqual([
      {
        title: "Vertrag an Herrn Weber schicken",
        description: null,
        assignee: "Me",
        priority: "high",
        due_date: "2026-11-02",
        source_timestamp_sec: null,
      },
      {
        title: "Preise mit Anna besprechen",
        description: "Anhebung um 5 %",
        assignee: "Me",
        priority: "medium",
        due_date: null, // not an ISO date
        source_timestamp_sec: null,
      },
    ]);
  });

  it("claims only voice hints and declines short memos and model failures", async () => {
    const adapter = adapterFor(mockModel(synthesis));
    expect(adapter.canHandle(capture("voice", transcript))).toBe(true);
    expect(adapter.canHandle(capture("note", transcript))).toBe(false);
    await expect(adapter.extract(capture("voice", "Milch kaufen"))).rejects.toBeInstanceOf(
      AdapterDeclinedError,
    );
    await expect(adapterFor(failingModel()).extract(capture("voice", transcript))).rejects.toBeInstanceOf(
      AdapterDeclinedError,
    );
  });

  it("cannot be broken out of the details block by a transcript that says </details>", () => {
    const md = renderVoiceMarkdown({ ...synthesis, action_items: [] }, "a </details> b");
    expect(md.match(/<\/details>/g)).toHaveLength(1);
  });
});

describe("vision-ocr structured fields", () => {
  it("writes objects, scene and detected_text to metadata", async () => {
    const storage = createMemoryStorageGateway();
    const adapter = createVisionOcrAdapter({
      storage,
      models: staticRouter({
        vision: mockModel({
          title_hint: "Schreibtisch",
          image_kind: "photo",
          ocr_text: "Kortex v1",
          description_md: "Ein Arbeitsplatz.",
          todos: [],
          objects: ["Laptop", " Laptop ", "Tasse", ""],
          scene: "Home-Office am Abend",
        }),
      }),
    });
    const out = await adapter.extract({
      userId: USER_ID,
      itemId: ITEM_ID,
      fileBuffer: PNG_1PX,
      mimeType: "image/png",
    });
    expect(out.metadata).toMatchObject({
      objects: ["Laptop", "Tasse"],
      scene: "Home-Office am Abend",
      detected_text: "Kortex v1",
    });
  });
});

describe("organizer: typed suggestion and mentions", () => {
  const ctx: OrganizerContext = {
    existingTags: [],
    existingClusters: [],
    existingObjects: [{ id: "o1", title: "Obsidian", type: "tool" }],
  };
  const raw = (o: Partial<Enrichment>): Enrichment => ({
    title: "T",
    summary: "S",
    cluster_name: null,
    suggested_folder_path: null,
    placement_confidence: 0.9,
    tags: ["a", "b"],
    entities: [],
    action_items: [],
    ...o,
  });
  const input = (type: OrganizeInput["type"]): OrganizeInput => ({
    type,
    sourcePlatform: "manual",
    contentMd: "x",
    isManualPlacement: false,
  });

  it("keeps a suggested type only for retypable types at confidence >= 0.7", () => {
    expect(normalizeEnrichment(raw({ suggested_type: "movie" }), input("note"), ctx).suggestedType).toBe("movie");
    expect(
      normalizeEnrichment(raw({ suggested_type: "movie", placement_confidence: 0.6 }), input("note"), ctx).suggestedType,
    ).toBeNull();
    expect(normalizeEnrichment(raw({ suggested_type: "movie" }), input("pdf"), ctx).suggestedType).toBeNull();
    expect(
      normalizeEnrichment(raw({ suggested_type: "movie", placement_confidence: null }), input("note"), ctx)
        .suggestedType,
    ).toBeNull();
  });

  it("mentions: only video/podcast, canonical object spelling, [[Wiki-Links]]", () => {
    const mentions = [
      { name: "obsidian", kind: "tool" as const },
      { name: "Atomic Habits", kind: "book" as const },
      { name: "Atomic  Habits", kind: "book" as const },
      { name: "Bad [[Name]]", kind: "tool" as const },
    ];
    const res = normalizeEnrichment(raw({ mentions }), input("video"), ctx);
    expect(res.mentions).toEqual([
      { name: "Obsidian", kind: "tool" },
      { name: "Atomic Habits", kind: "book" },
      { name: "Bad Name", kind: "tool" },
    ]);
    expect(normalizeEnrichment(raw({ mentions }), input("article"), ctx).mentions).toEqual([]);
    expect(appendMentions("Text", res.mentions)).toBe(
      "Text\n\n## Erwähnt\n\n- [[Obsidian]] (Tool)\n- [[Atomic Habits]] (Buch)\n- [[Bad Name]] (Tool)\n",
    );
    // Already linked through "Verknüpft": not repeated.
    expect(
      appendMentions("Text", res.mentions, [
        { name: "Obsidian", type: "tool", objectId: "o1", objectType: "tool" },
      ]),
    ).not.toContain("[[Obsidian]]");
    expect(appendMentions("Text", [])).toBe("Text");
  });
});

describe("ingest(): typing generic captures", () => {
  const context: IngestContext = {
    existingTags: [],
    existingClusters: [],
    existingObjects: [],
    folders: [
      { id: "f-note", folder_path: "10_Notes" },
      { id: "f-movies", folder_path: "30_Clippings/Movies" },
    ],
  };
  const enrichment = (o: Partial<Enrichment>): Enrichment => ({
    title: "Matrix",
    summary: "Filmtipp.",
    cluster_name: null,
    suggested_folder_path: "10_Notes",
    placement_confidence: 0.9,
    tags: ["film", "scifi"],
    entities: [],
    action_items: [],
    suggested_type: "movie",
    ...o,
  });
  const run = async (e: Enrichment, input: Record<string, unknown> = {}) => {
    const models = staticRouter({
      // 1st call: organizer, 2nd call: typed extraction
      fast: mockModel(e, answer({ title: "Matrix", movie_kind: "movie", year: 1999 })),
      embedding: mockEmbeddingModel(),
    });
    const deps: IngestDeps = {
      registry: createDefaultRegistry({ storage: createMemoryStorageGateway(), models }),
      models,
      generateId: () => ITEM_ID,
      now: () => new Date("2026-11-01T10:00:00Z"),
    };
    return ingest({ userId: USER_ID, rawText: "Matrix soll richtig gut sein, 1999", ...input }, context, deps);
  };

  it("an organizer suggestion types the note: metadata, registry folder, icon", async () => {
    const res = await run(enrichment({}));
    expect(res.item).toMatchObject({
      type: "movie",
      folder_path: "30_Clippings/Movies",
      folder_id: "f-movies",
      icon: "clapperboard",
    });
    expect(res.item.metadata).toMatchObject({
      kind: "movie",
      status: "to_watch",
      year: 1999,
      retyped_from: "note",
    });
    expect(res.item.content_md).toMatch(/^- \*\*Art:\*\* Film\n- \*\*Jahr:\*\* 1999\n\nMatrix soll/);
  });

  it("stays a note below the confidence threshold", async () => {
    const res = await run(enrichment({ placement_confidence: 0.5, tags: ["scifi", "abend"] }));
    expect(res.item.type).toBe("note");
    expect(res.item.folder_path).toBe("10_Notes");
  });

  it("a manual folder stays untouched, the type still applies", async () => {
    const res = await run(enrichment({}), {
      targetFolderId: "f-note",
      targetFolderPath: "10_Notes",
    });
    expect(res.item).toMatchObject({ is_manual_placement: true, folder_path: "10_Notes" });
  });

  it("a failing typed extraction keeps the item as captured and warns", async () => {
    // 2nd call returns an object that does not match the schema
    const bad = mockModel(enrichment({}), { nonsense: true });
    const m2 = staticRouter({ fast: bad, embedding: mockEmbeddingModel() });
    const deps: IngestDeps = {
      registry: createDefaultRegistry({ storage: createMemoryStorageGateway(), models: m2 }),
      models: m2,
      generateId: () => ITEM_ID,
    };
    const res = await ingest({ userId: USER_ID, rawText: "Matrix soll gut sein" }, context, deps);
    expect(res.item.type).toBe("note");
    expect(res.warnings.join(" ")).toMatch(/typed extraction \(movie\) failed/);
  });
});
