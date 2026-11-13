import { beforeAll, describe, expect, it } from "vitest";
import {
  createRecipeAdapter,
  findRecipeJsonLd,
  formatIngredient,
  isoDurationToMinutes,
  parseIngredient,
  parseServings,
  parseLooseDuration,
  rateLowCarb,
  recipeFromMarkdown,
} from "../src/adapters/recipe.adapter";
import { formatMinutes } from "../src/util/json-ld";
import { AdapterDeclinedError } from "../src/errors";
import { failingModel, fakeFetch, html, mockModel, staticRouter, USER_ID } from "./helpers";
import {
  blogHtml,
  chefkochGraphHtml,
  chefkochHtml,
  chefkochMagazinHtml,
  noRecipeHtml,
} from "./fixtures/recipe";

// Recipe pages without JSON-LD go through linkedom; its first load takes seconds under load.
beforeAll(async () => {
  await import("linkedom");
}, 60_000);

const CHEFKOCH = "https://www.chefkoch.de/rezepte/123/Zucchini-Lasagne.html";

describe("recipe parsing helpers", () => {
  it.each([
    [
      "500 g Hackfleisch, gemischt",
      { quantity: 500, quantity_max: null, unit: "g", name: "Hackfleisch, gemischt" },
    ],
    ["1/2 TL Salz", { quantity: 0.5, unit: "TL", name: "Salz" }],
    ["1,5 EL Olivenöl", { quantity: 1.5, unit: "EL", name: "Olivenöl" }],
    ["2-3 Knoblauchzehen", { quantity: 2, quantity_max: 3, unit: null, name: "Knoblauchzehen" }],
    ["½ Bund Basilikum", { quantity: 0.5, unit: "Bund", name: "Basilikum" }],
    ["2 Zucchini", { quantity: 2, unit: null, name: "Zucchini" }],
    ["Pfeffer", { quantity: null, unit: null, name: "Pfeffer" }],
  ])("parses %s", (raw, expected) => {
    expect(parseIngredient(raw)).toMatchObject(expected);
  });

  it("scales ingredients", () => {
    expect(formatIngredient(parseIngredient("500 g Hackfleisch"), 0.5)).toBe("250 g Hackfleisch");
    expect(formatIngredient(parseIngredient("2-3 Knoblauchzehen"), 2)).toBe("4–6 Knoblauchzehen");
    expect(formatIngredient(parseIngredient("1/3 TL Salz"), 1)).toBe("0,33 TL Salz");
    expect(formatIngredient(parseIngredient("Pfeffer"), 3)).toBe("Pfeffer");
  });

  it("parses durations, servings and low-carb ratings", () => {
    expect(isoDurationToMinutes("PT1H30M")).toBe(90);
    expect(isoDurationToMinutes("P0DT0H45M")).toBe(45);
    expect(isoDurationToMinutes("20 Minuten")).toBeUndefined();
    expect(parseServings("4 Portionen")).toBe(4);
    expect(parseServings(["6", "6 Stück"])).toBe(6);
    expect(rateLowCarb(12, 4)).toBe("keto");
    expect(rateLowCarb(25)).toBe("low_carb");
    expect(rateLowCarb(40)).toBe("moderate");
    expect(rateLowCarb(80, 5)).toBe("high_carb");
  });

  it("finds Recipe nodes inside @graph and type arrays", () => {
    expect(findRecipeJsonLd(chefkochHtml)?.name).toBe("Zucchini-Lasagne &amp; Hackfleisch");
    expect(findRecipeJsonLd(noRecipeHtml)).toBeUndefined();
  });
});

describe("recipe adapter", () => {
  it("builds recipe Markdown and estimates macros with the fast model when the page has none", async () => {
    const fetch = fakeFetch([{ match: (u) => u === CHEFKOCH, respond: () => html(chefkochHtml) }]);
    const fast = mockModel({
      kcal: 520,
      protein_g: 32,
      carbs_g: 11.4,
      fat_g: 38,
      fiber_g: 3.2,
      rationale: "Zucchini statt Nudeln.",
    });
    const adapter = createRecipeAdapter({ fetch, models: staticRouter({ fast }) });
    expect(adapter.canHandle({ userId: USER_ID, url: CHEFKOCH })).toBe(true);

    const out = await adapter.extract({ userId: USER_ID, url: CHEFKOCH });
    expect(out.type).toBe("recipe");
    expect(out.titleHint).toBe("Zucchini-Lasagne & Hackfleisch");
    expect(out.coverImageUrl).toBe("https://img.chefkoch-cdn.de/lasagne.jpg");

    const md = out.contentMd;
    expect(md).toContain(
      "**Portionen:** 4 · **Vorbereitung:** 20 Min. · **Kochen/Backen:** 40 Min. · **Gesamt:** 1 Std.",
    );
    expect(md).toContain(
      "## Zutaten (für 4 Portionen)\n\n- [ ] 2 Zucchini\n- [ ] 500 g Hackfleisch, gemischt\n- [ ] 0,5 TL Salz",
    );
    expect(md).toContain("- [ ] Pfeffer");
    expect(md).toContain(
      "## Zubereitung\n\n1. Zucchini längs in Scheiben schneiden.\n2. Hackfleisch anbraten.\n3. Abwechselnd schichten und 40 Minuten backen.",
    );
    expect(md).toContain("## Nährwerte pro Portion (KI-Schätzung)");
    expect(md).toContain("| 520 kcal | 32 g | 11 g | 38 g | 3 g |");
    expect(md).toContain("**Low-Carb-Einstufung:** Keto (≤ 10 g Netto-KH)");
    expect(md).toContain(
      "Quelle: [chefkoch.de](https://www.chefkoch.de/rezepte/123/Zucchini-Lasagne.html)",
    );

    expect(out.metadata).toMatchObject({
      servings: 4,
      total_time_min: 60,
      category: ["Hauptspeise"],
      keywords: ["low carb", "lasagne", "ofen"],
      author: "LowCarbLisa",
      macros: { source: "llm-estimate", net_carbs_g: 8, low_carb_rating: "keto" },
    });
    expect((out.metadata.ingredients as unknown[]).length).toBe(8);
    // The model got the ingredient list.
    expect(JSON.stringify(fast.doGenerateCalls[0]?.prompt)).toContain("500 g Hackfleisch");
  });

  it("uses JSON-LD nutrition and HowToSections without calling the model", async () => {
    const url = "https://blog.example.com/recipes/keto-brot";
    const fetch = fakeFetch([{ match: () => true, respond: () => html(blogHtml) }]);
    const fast = mockModel({});
    const out = await createRecipeAdapter({ fetch, models: staticRouter({ fast }) }).extract({
      userId: USER_ID,
      url,
    });
    expect(fast.doGenerateCalls).toHaveLength(0);
    expect(out.contentMd).toContain("### Teig\n\n1. Mehl und Eier verrühren.");
    expect(out.contentMd).toContain("### Backen\n\n1. 45 Minuten bei 180 °C backen.");
    expect(out.contentMd).toContain("(laut Quelle)");
    expect(out.coverImageUrl).toBe("https://blog.example.com/brot.jpg");
    expect(out.metadata.macros).toMatchObject({
      source: "json-ld",
      kcal: 210,
      carbs_g: 4,
      fiber_g: 2.5,
      net_carbs_g: 1.5,
      low_carb_rating: "keto",
    });
  });

  it("still saves the recipe when the macro estimate fails", async () => {
    const fetch = fakeFetch([{ match: () => true, respond: () => html(chefkochHtml) }]);
    const out = await createRecipeAdapter({
      fetch,
      models: staticRouter({ fast: failingModel() }),
    }).extract({ userId: USER_ID, url: CHEFKOCH });
    expect(out.metadata.macros).toBeNull();
    expect(out.metadata.warnings).toEqual([expect.stringContaining("macro estimate failed")]);
    expect(out.contentMd).not.toContain("Nährwerte");
  });

  it("declines pages without Recipe JSON-LD so the article adapter can take over", async () => {
    const fetch = fakeFetch([{ match: () => true, respond: () => html(noRecipeHtml) }]);
    await expect(
      createRecipeAdapter({ fetch }).extract({ userId: USER_ID, url: CHEFKOCH }),
    ).rejects.toBeInstanceOf(AdapterDeclinedError);
  });

  it("only claims recipe-looking URLs", () => {
    const a = createRecipeAdapter({ extraHosts: ["meinblog.de"] });
    expect(a.canHandle({ userId: USER_ID, url: "https://www.lecker.de/x" })).toBe(true);
    expect(a.canHandle({ userId: USER_ID, url: "https://meinblog.de/post/1" })).toBe(true);
    expect(a.canHandle({ userId: USER_ID, url: "https://example.com/rezept/apfelkuchen" })).toBe(
      true,
    );
    expect(a.canHandle({ userId: USER_ID, url: "https://example.com/news/1" })).toBe(false);
  });
});

describe("recipe extraction (feedback G1)", () => {
  const MAGAZIN = "https://www.chefkoch.de/magazin/artikel/1-apfeltarte";

  it("parses loose durations and formats minutes", () => {
    expect(parseLooseDuration("ca. 1 Std. 55 Min.")).toBe(115);
    expect(parseLooseDuration("45 Minuten")).toBe(45);
    expect(parseLooseDuration("1,5 h")).toBe(90);
    expect(parseLooseDuration("normal")).toBeUndefined();
    expect(formatMinutes(45)).toBe("45 Min.");
    expect(formatMinutes(100)).toBe("1 Std. 40 Min.");
    expect(formatMinutes(120)).toBe("2 Std.");
  });

  it("resolves @id references, keeps tips and rating, drops comments (chefkoch 2026)", async () => {
    const fetch = fakeFetch([{ match: () => true, respond: () => html(chefkochGraphHtml) }]);
    const fast = mockModel({});
    const out = await createRecipeAdapter({ fetch, models: staticRouter({ fast }) }).extract({
      userId: USER_ID,
      url: "https://www.chefkoch.de/rezepte/1/Lasagne.html",
    });
    // Nutrition is on the page: no model call.
    expect(fast.doGenerateCalls).toHaveLength(0);
    expect(out.coverImageUrl).toBe("https://img.chefkoch-cdn.de/rezepte/1/lasagne.jpg");
    expect(out.metadata).toMatchObject({
      recipe_source: "json-ld",
      author: "hexe1078",
      servings: 4,
      total_time_min: 100,
      rating: { value: 4.7, count: 5033 },
      category: ["Pasta & Nudel"],
      cuisine: ["Italien"],
    });
    const md = out.contentMd;
    expect(md).toContain(
      "**Portionen:** 4 · **Vorbereitung:** 30 Min. · **Kochen/Backen:** 1 Std. 10 Min. · **Gesamt:** 1 Std. 40 Min. · **Bewertung:** 4,7/5 (5.033)",
    );
    // The single "Zubereitung" section adds no sub-heading; the tip stays a numbered step.
    expect(md).toContain(
      "## Zubereitung\n\n1. Zwiebel würfeln und das Hackfleisch krümelig anbraten.\n2. Tipp: Viel Flüssigkeit? Hitze erhöhen.\n3. Schichten",
    );
    expect(md).not.toContain("### Zubereitung");
    expect(md).toContain("| 1015 kcal | 48,9 g | 74,9 g | 56,7 g | – |");
    expect(md).toContain("· Rezept von hexe1078");
    expect(md).not.toContain("Kommentar");
    expect(md).not.toContain("Werbung");
  });

  it("cuts the recipe out of a magazine article without Recipe JSON-LD", async () => {
    const fetch = fakeFetch([{ match: () => true, respond: () => html(chefkochMagazinHtml) }]);
    const adapter = createRecipeAdapter({ fetch });
    expect(adapter.canHandle({ userId: USER_ID, url: MAGAZIN })).toBe(true);
    const out = await adapter.extract({ userId: USER_ID, url: MAGAZIN });

    expect(out.type).toBe("recipe");
    expect(out.titleHint).toBe("Apfeltarte mit Marzipan");
    expect(out.coverImageUrl).toBe("https://img.chefkoch-cdn.de/magazin/apfeltarte.jpg");
    expect(out.metadata).toMatchObject({
      recipe_source: "page",
      servings: 12,
      prep_time_min: 40,
      cook_time_min: 45,
      rest_time_min: 30,
      total_time_min: 115,
      difficulty: "normal",
    });
    expect(out.metadata.ingredients).toEqual([
      expect.objectContaining({ quantity: 200, unit: "g", name: "Mehl", group: "Für den Teig" }),
      expect.objectContaining({ name: "Butter, kalt", group: "Für den Teig" }),
      expect.objectContaining({ name: "Ei", group: "Für den Teig" }),
      expect.objectContaining({ name: "Marzipanrohmasse", group: "Für den Belag" }),
      expect.objectContaining({ name: "Äpfel, sauer", group: "Für den Belag" }),
      expect.objectContaining({ quantity: 2, unit: "EL", name: "Honig", group: "Für den Belag" }),
    ]);
    expect(out.metadata.steps).toHaveLength(3);

    const md = out.contentMd;
    expect(md).toBe(
      [
        "# Apfeltarte mit Marzipan",
        "",
        "> Mürbeteig, Marzipancreme und Apfelspalten mit Honigglasur.",
        "",
        "**Portionen:** 12 · **Vorbereitung:** 40 Min. · **Kochen/Backen:** 45 Min. · **Ruhezeit:** 30 Min. · **Gesamt:** 1 Std. 55 Min. · **Schwierigkeit:** normal",
        "",
        "## Zutaten (für 12 Portionen)",
        "",
        "### Für den Teig",
        "",
        "- [ ] 200 g Mehl",
        "- [ ] 120 g Butter, kalt",
        "- [ ] 1 Ei",
        "",
        "### Für den Belag",
        "",
        "- [ ] 150 g Marzipanrohmasse",
        "- [ ] 4 Äpfel, sauer",
        "- [ ] 2 EL Honig",
        "",
        "## Zubereitung",
        "",
        "1. Mehl, Butter und Ei zu einem Teig verkneten und 30 Minuten kalt stellen.",
        "2. Ofen auf 180 °C vorheizen, Teig ausrollen und die Form auslegen.",
        "3. Marzipan cremig rühren, aufstreichen, Äpfel darauf legen und 30 Minuten backen.",
        "",
        `Quelle: [chefkoch.de](${MAGAZIN})`,
      ].join("\n"),
    );
    // Story, teasers, author box and the "how do you like it" widget are gone.
    for (const noise of ["Finesse", "Apple Crumble", "Zum Rezept", "Redakteur", "gefällt", "Herbstzeit"])
      expect(md).not.toContain(noise);
  });

  it("reads steps written as paragraphs and stops at the next section", () => {
    const r = recipeFromMarkdown(
      [
        "# Pfannkuchen",
        "## Zutaten (2 Personen)",
        "* 2 Eier",
        "* 250 ml Milch",
        "## So geht's",
        "Alles verrühren und",
        "kurz quellen lassen.",
        "",
        "Portionsweise ausbacken.",
        "## Mehr Rezepte",
        "1. Waffeln",
      ].join("\n"),
    );
    expect(r?.servings).toBe(2);
    expect(r?.name).toBe("Pfannkuchen");
    expect(r?.steps.map((s) => s.text)).toEqual([
      "Alles verrühren und kurz quellen lassen.",
      "Portionsweise ausbacken.",
    ]);
  });

  it("returns nothing for articles that only mention ingredients", () => {
    expect(recipeFromMarkdown("# Gesund essen\n\n## Zutaten-Check\n\nText ohne Liste.")).toBe(
      undefined,
    );
    expect(recipeFromMarkdown("# Liste\n\n## Zutaten\n\n- 1 Ei\n- Mehl\n\nKeine Schritte.")).toBe(
      undefined,
    );
  });
});
