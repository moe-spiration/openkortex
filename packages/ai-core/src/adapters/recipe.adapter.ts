import { generateText, Output } from "ai";
import { z } from "zod";
import { AdapterDeclinedError, errorMessage } from "../errors";
import { BROWSER_USER_AGENT, defaultFetch, requestText, type FetchLike } from "../http";
import { createSafeFetch } from "../net/safe-fetch";
import { acceptLanguage, byLocale, getLocale, intlLocale, ph } from "../i18n";
import { recipeMacrosPrompt, renderRecipeMacrosMessage } from "../prompts/recipe-macros";
import type { ModelRouter } from "../router/model-router";
import {
  findJsonLdNode,
  formatMinutes,
  hasType,
  isObj,
  isoDurationToMinutes,
  ldImageUrl,
  ldText,
  ldTextList,
  type JsonLd,
} from "../util/json-ld";
import { decodeEntities } from "../util/markup";
import { readHtml } from "./web/direct-reader";
import {
  isHttpUrl,
  type ExtractedPayload,
  type IngestionAdapter,
  type RawIngestInput,
} from "./base-adapter";
import { modelFor } from "../router/model-router";

const ID = "recipe";

/** Hosts we always try as recipes before falling back to the article adapter. */
export const KNOWN_RECIPE_HOSTS = [
  "chefkoch.de",
  "lecker.de",
  "kitchenstories.com",
  "eatsmarter.de",
  "essen-und-trinken.de",
  "kochbar.de",
  "einfachbacken.de",
  "lowcarbkompendium.com",
  "allrecipes.com",
  "bbcgoodfood.com",
  "seriouseats.com",
  "budgetbytes.com",
  "dietdoctor.com",
  "cookidoo.de",
];

export interface RecipeAdapterOptions {
  fetch?: FetchLike;
  /** Used for the macro estimate when the page has no nutrition data. Optional. */
  models?: ModelRouter;
  extraHosts?: string[];
}

// --- JSON-LD ------------------------------------------------------------------

export { isoDurationToMinutes };

/** Finds the first schema.org Recipe in all `application/ld+json` blocks. */
export function findRecipeJsonLd(html: string): JsonLd | undefined {
  return findJsonLdNode(html, ["Recipe"]);
}

const text = ldText;
const textList = ldTextList;
const imageUrl = ldImageUrl;

export function parseServings(v: unknown): number | undefined {
  const values = Array.isArray(v) ? v : [v];
  for (const item of values) {
    if (typeof item === "number" && item > 0) return item;
    const m = typeof item === "string" ? item.match(/\d+/) : null;
    if (m) return Number(m[0]);
  }
  return undefined;
}

interface Step {
  section?: string;
  text: string;
}

export function parseInstructions(v: unknown): Step[] {
  const out: Step[] = [];
  const visit = (node: unknown, section?: string) => {
    if (typeof node === "string") {
      // Some sites put all steps in one string separated by line breaks.
      for (const line of stripTagsKeepLines(node.replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n"))) {
        out.push({ section, text: line });
      }
      return;
    }
    if (Array.isArray(node)) return node.forEach((n) => visit(n, section));
    if (!isObj(node)) return;
    if (hasType(node, "HowToSection"))
      return visit(node.itemListElement, text(node.name) ?? section);
    const t = text(node.text) ?? text(node.name);
    if (t) out.push({ section, text: hasType(node, "HowToTip") ? `${ph("tip")}: ${t}` : t });
  };
  visit(v);
  return out;
}

const stripTagsKeepLines = (s: string): string[] =>
  decodeEntities(s.replace(/<[^>]*>/g, ""))
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

// --- Ingredients ----------------------------------------------------------------

export interface ParsedIngredient {
  raw: string;
  quantity: number | null;
  quantity_max: number | null;
  unit: string | null;
  name: string;
  /** Sub-list label on the page ("Für den Teig"), when the recipe groups its ingredients. */
  group?: string;
}

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
};

const UNITS = [
  "kg",
  "g",
  "mg",
  "l",
  "ml",
  "cl",
  "dl",
  "el",
  "tl",
  "msp",
  "prise",
  "prisen",
  "pck",
  "pck.",
  "päckchen",
  "packung",
  "dose",
  "dosen",
  "becher",
  "bund",
  "stück",
  "stk",
  "stk.",
  "scheibe",
  "scheiben",
  "zehe",
  "zehen",
  "tasse",
  "tassen",
  "glas",
  "handvoll",
  "zweig",
  "zweige",
  "blatt",
  "cup",
  "cups",
  "tbsp",
  "tsp",
  "oz",
  "lb",
  "lbs",
  "clove",
  "cloves",
  "pinch",
  "can",
  "slice",
  "slices",
];

function parseNumber(s: string): number | undefined {
  const t = s.trim();
  if (UNICODE_FRACTIONS[t] !== undefined) return UNICODE_FRACTIONS[t];
  const mixed = t.match(/^(\d+)\s*([½¼¾⅓⅔⅛])$/);
  if (mixed?.[1] && mixed[2]) return Number(mixed[1]) + (UNICODE_FRACTIONS[mixed[2]] ?? 0);
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac?.[1] && frac[2]) return Number(frac[1]) / Number(frac[2]);
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** "200 g Mehl", "1/2 TL Salz", "2-3 EL Öl", "½ Zwiebel" → quantity / unit / name. */
export function parseIngredient(raw: string): ParsedIngredient {
  const clean = raw.replace(/\s+/g, " ").trim();
  const num = String.raw`\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?(?:\s*[½¼¾⅓⅔⅛])?|[½¼¾⅓⅔⅛]`;
  const m = clean.match(new RegExp(`^(${num})(?:\\s*[-–]\\s*(${num}))?\\s*(.*)$`));
  if (!m?.[1]) return { raw, quantity: null, quantity_max: null, unit: null, name: clean };
  const quantity = parseNumber(m[1]) ?? null;
  const quantityMax = m[2] ? (parseNumber(m[2]) ?? null) : null;
  let rest = (m[3] ?? "").trim();
  let unit: string | null = null;
  const unitMatch = rest.match(/^([\p{L}.]+)\s+(.*)$/u) ?? rest.match(/^([\p{L}.]+)$/u);
  if (unitMatch?.[1] && UNITS.includes(unitMatch[1].toLowerCase())) {
    unit = unitMatch[1];
    rest = (unitMatch[2] ?? "").trim();
  }
  return { raw, quantity, quantity_max: quantityMax, unit, name: rest || clean };
}

const formatQuantity = (q: number): string => {
  const rounded = Math.round(q * 100) / 100;
  // Decimal comma in German, point in English (parseIngredient reads both).
  return getLocale() === "de" ? String(rounded).replace(".", ",") : String(rounded);
};

export function formatIngredient(i: ParsedIngredient, factor = 1): string {
  if (i.quantity === null) return i.raw.trim();
  const q = formatQuantity(i.quantity * factor);
  const qMax = i.quantity_max !== null ? `–${formatQuantity(i.quantity_max * factor)}` : "";
  return [`${q}${qMax}`, i.unit, i.name].filter(Boolean).join(" ");
}

// --- Macros ---------------------------------------------------------------------

export const LOW_CARB_RATINGS = ["keto", "low_carb", "moderate", "high_carb"] as const;
export type LowCarbRating = (typeof LOW_CARB_RATINGS)[number];

/** Labels in the user's language, read when used (getters, so the exported shape stays a record). */
export const LOW_CARB_LABELS: Record<LowCarbRating, string> = {
  get keto() {
    return ph("lowCarbKeto");
  },
  get low_carb() {
    return ph("lowCarbLow");
  },
  get moderate() {
    return ph("lowCarbModerate");
  },
  get high_carb() {
    return ph("lowCarbHigh");
  },
};

/** Per-serving net carbs → rating. Same thresholds for JSON-LD and LLM numbers. */
export function rateLowCarb(carbsG: number, fiberG = 0): LowCarbRating {
  const net = Math.max(carbsG - fiberG, 0);
  if (net <= 10) return "keto";
  if (net <= 25) return "low_carb";
  if (net <= 50) return "moderate";
  return "high_carb";
}

export const MacroEstimateSchema = z.object({
  kcal: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  fiber_g: z.number(),
  rationale: z.string(),
});

export interface RecipeMacros {
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  net_carbs_g: number | null;
  low_carb_rating: LowCarbRating | null;
  source: "json-ld" | "llm-estimate";
  rationale?: string;
}

const grams = (v: unknown): number | undefined => {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v : undefined;
  const m = s?.match(/(\d+(?:[.,]\d+)?)/);
  return m?.[1] ? Number(m[1].replace(",", ".")) : undefined;
};

function macrosFromJsonLd(nutrition: unknown): RecipeMacros | undefined {
  if (!isObj(nutrition)) return undefined;
  const carbs = grams(nutrition.carbohydrateContent);
  if (carbs === undefined) return undefined;
  const fiber = grams(nutrition.fiberContent);
  return {
    kcal: grams(nutrition.calories) ?? null,
    protein_g: grams(nutrition.proteinContent) ?? null,
    carbs_g: carbs,
    fat_g: grams(nutrition.fatContent) ?? null,
    fiber_g: fiber ?? null,
    net_carbs_g: Math.max(carbs - (fiber ?? 0), 0),
    low_carb_rating: rateLowCarb(carbs, fiber),
    source: "json-ld",
  };
}

// --- Recipe data -------------------------------------------------------------------

/** Everything we keep of a recipe page, whichever way it was read. */
export interface RecipeData {
  name: string;
  description?: string;
  servings: number | null;
  prep?: number;
  cook?: number;
  rest?: number;
  total?: number;
  difficulty?: string;
  ingredients: ParsedIngredient[];
  steps: Step[];
  image?: string;
  author?: string;
  rating?: { value: number; count: number | null };
  category: string[];
  cuisine: string[];
  keywords: string[];
  nutrition?: unknown;
  /** "json-ld" (schema.org Recipe) or "page" (headings of the readable page). */
  source: "json-ld" | "page";
}

function ratingOf(v: unknown): RecipeData["rating"] {
  if (!isObj(v)) return undefined;
  const value = Number(String(v.ratingValue ?? "").replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const count = Number(v.ratingCount ?? v.reviewCount);
  return { value, count: Number.isFinite(count) && count > 0 ? count : null };
}

export function recipeFromJsonLd(recipe: JsonLd): RecipeData {
  const prep = isoDurationToMinutes(recipe.prepTime);
  const cook = isoDurationToMinutes(recipe.cookTime);
  return {
    name: text(recipe.name) ?? ph("recipe"),
    description: text(recipe.description),
    servings: parseServings(recipe.recipeYield) ?? null,
    prep,
    cook,
    total:
      isoDurationToMinutes(recipe.totalTime) ??
      (prep || cook ? (prep ?? 0) + (cook ?? 0) : undefined),
    ingredients: textList(recipe.recipeIngredient ?? recipe.ingredients).map(parseIngredient),
    steps: parseInstructions(recipe.recipeInstructions),
    image: imageUrl(recipe.image) ?? imageUrl(recipe.thumbnailUrl),
    author: text(Array.isArray(recipe.author) ? recipe.author[0] : recipe.author),
    rating: ratingOf(recipe.aggregateRating),
    category: textList(recipe.recipeCategory),
    cuisine: textList(recipe.recipeCuisine),
    keywords:
      typeof recipe.keywords === "string"
        ? recipe.keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
        : textList(recipe.keywords),
    nutrition: recipe.nutrition,
    source: "json-ld",
  };
}

// --- Recipe from the readable page (no JSON-LD) ---------------------------------------

const INGREDIENTS_HEADING = /^(zutaten|ingredients|das brauchst du|einkaufsliste)\b/i;
const STEPS_HEADING =
  /^(zubereitung|anleitung|so geht'?s|so wird'?s gemacht|schritt für schritt|instructions|directions|method|preparation)\b/i;
const SERVINGS_IN_TEXT = /(\d+)\s*(portionen|portion|personen|stück|stücke|servings|people)\b/i;

/** "ca. 1 Std. 55 Min.", "45 Minuten", "1 h 30 min" → minutes. */
export function parseLooseDuration(s: string): number | undefined {
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*(?:std\.?|stunden?|h\b|hours?|hrs?)/i);
  const m = s.match(/(\d+)\s*(?:min\.?|minuten|minutes|mins?)\b/i);
  const total = (h?.[1] ? Number(h[1].replace(",", ".")) * 60 : 0) + (m?.[1] ? Number(m[1]) : 0);
  return total > 0 ? Math.round(total) : undefined;
}

type FactKey = "prep" | "cook" | "rest" | "total" | "difficulty";
const FACT_LABELS: Array<[RegExp, FactKey]> = [
  [/^(arbeitszeit|vorbereitung(szeit)?|zubereitungszeit|prep(aration)? time)$/i, "prep"],
  [/^(koch-?\s*\/?\s*backzeit|kochzeit|backzeit|garzeit|cook(ing)? time|bake time)$/i, "cook"],
  [/^(ruhezeit|wartezeit|kühlzeit|rest(ing)? time)$/i, "rest"],
  [/^(gesamtzeit|gesamt|total time|total)$/i, "total"],
  [/^(schwierigkeit(sgrad)?|difficulty|level)$/i, "difficulty"],
];

/** `- **Arbeitszeit**: ca. 40 Min.` or `**Arbeitszeit:** 40 Min.` → [label, value]. */
const factLine = (line: string): [string, string] | undefined => {
  const m = line
    .replace(/^\s*[-*]\s+/, "")
    .match(/^\*\*([^*]+?):?\*\*\s*:?\s*(.+)$|^([\p{L} /-]{3,30}):\s+(.+)$/u);
  const label = (m?.[1] ?? m?.[3])?.trim();
  const value = (m?.[2] ?? m?.[4])?.trim();
  return label && value ? [label, value] : undefined;
};

const plain = (s: string): string =>
  s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();

interface MdLine {
  level: number; // 0 = no heading
  text: string;
}

/**
 * Reads a recipe from the readable Markdown of a page without schema.org Recipe (chefkoch magazine
 * articles, blogs): only the time/difficulty facts, the ingredients section (with sub-groups) and
 * the steps section are kept; everything else (story, teasers, author box) is dropped.
 * Returns undefined unless at least two ingredients and one step were found.
 */
export function recipeFromMarkdown(
  md: string,
  page: { title?: string; description?: string; image?: string } = {},
): RecipeData | undefined {
  const lines: MdLine[] = md.split("\n").map((raw) => {
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    return h?.[1] ? { level: h[1].length, text: plain(h[2] ?? "") } : { level: 0, text: raw };
  });
  const ingAt = lines.findIndex((l) => l.level > 0 && INGREDIENTS_HEADING.test(l.text));
  if (ingAt < 0) return undefined;
  const stepsAt = lines.findIndex(
    (l, i) => i > ingAt && l.level > 0 && STEPS_HEADING.test(l.text),
  );
  if (stepsAt < 0) return undefined;

  const sectionEnd = (from: number, stopAt?: number): number => {
    const level = lines[from]?.level ?? 1;
    for (let i = from + 1; i < lines.length; i++) {
      if (i === stopAt) return i;
      const l = lines[i] as MdLine;
      if (l.level > 0 && l.level <= level) return i;
    }
    return lines.length;
  };

  // Ingredients: list items; bold lines and deeper headings name a group.
  const ingredients: ParsedIngredient[] = [];
  let group: string | undefined;
  for (let i = ingAt + 1; i < sectionEnd(ingAt, stepsAt); i++) {
    const l = lines[i] as MdLine;
    const t = l.text.trim();
    if (!t) continue;
    if (l.level > 0) {
      group = l.text.replace(/:$/, "") || undefined;
      continue;
    }
    const item = t.match(/^[-*+]\s+(?:\[[ x]\]\s+)?(.+)$/i);
    if (item?.[1]) {
      const raw = plain(item[1]);
      if (raw) ingredients.push({ ...parseIngredient(raw), ...(group ? { group } : {}) });
      continue;
    }
    const label = t.match(/^\*\*(.+?):?\*\*:?$/) ?? t.match(/^(für [^.]{2,60}):$/i);
    if (label?.[1]) group = plain(label[1]).replace(/:$/, "");
  }

  // Steps: numbered or bulleted items (continuation lines are merged), else paragraphs.
  const steps: Step[] = [];
  let section: string | undefined;
  let current: Step | undefined;
  const flush = () => {
    if (current?.text) steps.push({ ...current, text: plain(current.text) });
    current = undefined;
  };
  for (let i = stepsAt + 1; i < sectionEnd(stepsAt); i++) {
    const l = lines[i] as MdLine;
    const t = l.text.trim();
    if (l.level > 0) {
      flush();
      section = l.text || undefined;
      continue;
    }
    if (!t || /^!\[/.test(t)) {
      flush();
      continue;
    }
    const item = t.match(/^(?:\d+[.)]|[-*+])\s+(.+)$/);
    if (item?.[1]) {
      flush();
      current = { ...(section ? { section } : {}), text: item[1] };
    } else if (current) current.text += ` ${t}`;
    else current = { ...(section ? { section } : {}), text: t };
  }
  flush();
  if (ingredients.length < 2 || steps.length < 1) return undefined;

  // Facts anywhere before the steps (time, difficulty) and servings from the ingredients heading.
  const facts: Partial<Record<FactKey, string>> = {};
  for (const l of lines.slice(0, stepsAt)) {
    if (l.level > 0) continue;
    const f = factLine(l.text);
    if (!f) continue;
    const key = FACT_LABELS.find(([re]) => re.test(f[0]))?.[1];
    if (key && !facts[key]) facts[key] = plain(f[1]);
  }
  const minutes = (k: FactKey) => (facts[k] ? parseLooseDuration(facts[k]) : undefined);
  const servingsMatch = (lines[ingAt]?.text ?? "").match(SERVINGS_IN_TEXT);
  const h1 = lines.find((l) => l.level === 1)?.text;

  return {
    name: page.title?.trim() || h1 || ph("recipe"),
    description: page.description?.trim() || undefined,
    servings: servingsMatch?.[1] ? Number(servingsMatch[1]) : null,
    prep: minutes("prep"),
    cook: minutes("cook"),
    rest: minutes("rest"),
    total: minutes("total"),
    difficulty: facts.difficulty,
    ingredients,
    steps,
    image: page.image,
    category: [],
    cuisine: [],
    keywords: [],
    source: "page",
  };
}

// --- Markdown ----------------------------------------------------------------------

const formatRating = (r: NonNullable<RecipeData["rating"]>) =>
  `${getLocale() === "de" ? String(Math.round(r.value * 10) / 10).replace(".", ",") : String(Math.round(r.value * 10) / 10)}/5${
    r.count ? ` (${r.count.toLocaleString(intlLocale())})` : ""
  }`;

/** The one recipe layout for both sources: facts, ingredients (grouped), steps, nutrition, source. */
export function renderRecipeMarkdown(
  r: RecipeData,
  macros: RecipeMacros | undefined,
  url: string,
): string {
  const md: string[] = [`# ${r.name}`, ""];
  if (r.description) md.push(`> ${r.description.replace(/\s*\n+\s*/g, " ")}`, "");
  const facts = [
    r.servings ? `**${ph("servings")}:** ${r.servings}` : null,
    r.prep ? `**${ph("prepTime")}:** ${formatMinutes(r.prep)}` : null,
    r.cook ? `**${ph("cookTime")}:** ${formatMinutes(r.cook)}` : null,
    r.rest ? `**${ph("restTime")}:** ${formatMinutes(r.rest)}` : null,
    r.total ? `**${ph("totalTime")}:** ${formatMinutes(r.total)}` : null,
    r.difficulty ? `**${ph("difficulty")}:** ${r.difficulty}` : null,
    r.rating ? `**${ph("rating")}:** ${formatRating(r.rating)}` : null,
  ].filter(Boolean);
  if (facts.length) md.push(facts.join(" · "), "");

  const forServings = r.servings
    ? byLocale({ en: ` (for ${r.servings} servings)`, de: ` (für ${r.servings} Portionen)` })
    : "";
  md.push(`## ${ph("ingredients")}${forServings}`, "");
  let group: string | undefined;
  for (const i of r.ingredients) {
    if (i.group && i.group !== group) {
      group = i.group;
      md.push("", `### ${group}`, "");
    }
    md.push(`- [ ] ${formatIngredient(i)}`);
  }
  md.push("", `## ${ph("preparation")}`, "");
  let section: string | undefined;
  let n = 0;
  for (const s of r.steps) {
    // A single section named like the heading itself ("Zubereitung") adds nothing.
    if (s.section && s.section !== section && !STEPS_HEADING.test(s.section)) {
      section = s.section;
      n = 0;
      md.push("", `### ${section}`, "");
    }
    md.push(`${++n}. ${s.text}`);
  }
  md.push("");

  if (macros) {
    const v = (x: number | null, unit: string) =>
      x === null ? "–" : `${formatQuantity(x)} ${unit}`;
    md.push(
      `## ${ph("nutritionPerServing")} (${ph(macros.source === "json-ld" ? "perSource" : "aiEstimate")})`,
      "",
      `| kcal | ${ph("protein")} | ${ph("carbs")} | ${ph("fat")} | ${ph("fiber")} |`,
      "| --- | --- | --- | --- | --- |",
      `| ${v(macros.kcal, "kcal")} | ${v(macros.protein_g, "g")} | ${v(macros.carbs_g, "g")} | ${v(macros.fat_g, "g")} | ${v(macros.fiber_g, "g")} |`,
      "",
    );
    if (macros.low_carb_rating)
      md.push(`**${ph("lowCarbRating")}:** ${LOW_CARB_LABELS[macros.low_carb_rating]}`, "");
    if (macros.rationale) md.push(macros.rationale, "");
  }
  const site = new URL(url).hostname.replace(/^www\./, "");
  md.push(`${ph("source")}: [${site}](${url})${r.author ? ` · ${ph("recipeBy")} ${r.author}` : ""}`);
  return md
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- Adapter ----------------------------------------------------------------------

export function createRecipeAdapter(options: RecipeAdapterOptions = {}): IngestionAdapter {
  const fetchFn = options.fetch ?? defaultFetch;
  const hosts = [...KNOWN_RECIPE_HOSTS, ...(options.extraHosts ?? [])];

  return {
    id: ID,
    canHandle(input: RawIngestInput) {
      if (!isHttpUrl(input.url) || input.fileBuffer) return false;
      if (input.typeHint === "recipe") return true;
      const u = new URL(input.url);
      const host = u.hostname.replace(/^www\./, "");
      return (
        hosts.some((h) => host === h || host.endsWith(`.${h}`)) ||
        /\/(rezepte?|recipes?)\b/i.test(u.pathname)
      );
    },

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      const url = input.url as string;
      const html = await requestText(createSafeFetch({ fetch: fetchFn }), ID, url, {
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept: "text/html",
          "Accept-Language": byLocale({ en: acceptLanguage(), de: "de-DE,de;q=0.9" }),
        },
      });
      const ld = findRecipeJsonLd(html);
      let recipe: RecipeData | undefined;
      if (ld) recipe = recipeFromJsonLd(ld);
      else {
        // No schema.org Recipe (e.g. chefkoch magazine articles): cut the recipe out of the page.
        const page = await readHtml(html, url);
        recipe = recipeFromMarkdown(page.markdown, {
          title: page.title,
          description: page.description,
          image: page.coverImageUrl,
        });
      }
      if (!recipe)
        throw new AdapterDeclinedError(ID, "no schema.org Recipe and no recipe sections on the page");

      const warnings: string[] = [];
      let macros = macrosFromJsonLd(recipe.nutrition);
      const ingredientsRaw = recipe.ingredients.map((i) => i.raw);
      if (!macros && options.models && ingredientsRaw.length > 0) {
        try {
          const { output } = await generateText({
            model: modelFor(options.models, "summarize"),
            system: recipeMacrosPrompt(),
            prompt: renderRecipeMacrosMessage({
              name: recipe.name,
              servings: recipe.servings,
              ingredients: ingredientsRaw,
            }),
            output: Output.object({ schema: MacroEstimateSchema, name: "macro_estimate" }),
            temperature: 0,
          });
          macros = {
            kcal: Math.round(output.kcal),
            protein_g: Math.round(output.protein_g),
            carbs_g: Math.round(output.carbs_g),
            fat_g: Math.round(output.fat_g),
            fiber_g: Math.round(output.fiber_g),
            net_carbs_g: Math.max(Math.round(output.carbs_g - output.fiber_g), 0),
            low_carb_rating: rateLowCarb(output.carbs_g, output.fiber_g),
            source: "llm-estimate",
            rationale: output.rationale,
          };
        } catch (err) {
          warnings.push(`macro estimate failed: ${errorMessage(err)}`);
        }
      }

      return {
        type: "recipe",
        sourcePlatform: "web",
        titleHint: recipe.name,
        contentMd: renderRecipeMarkdown(recipe, macros, url),
        coverImageUrl: recipe.image,
        sourceUrl: ld && typeof ld.url === "string" && isHttpUrl(ld.url) ? ld.url : url,
        metadata: {
          site: new URL(url).hostname.replace(/^www\./, ""),
          recipe_source: recipe.source,
          servings: recipe.servings,
          prep_time_min: recipe.prep ?? null,
          cook_time_min: recipe.cook ?? null,
          rest_time_min: recipe.rest ?? null,
          total_time_min: recipe.total ?? null,
          difficulty: recipe.difficulty ?? null,
          rating: recipe.rating ?? null,
          // Structured list so the UI can scale quantities by servings.
          ingredients: recipe.ingredients,
          steps: recipe.steps.map((s) =>
            s.section ? { section: s.section, text: s.text } : { text: s.text },
          ),
          category: recipe.category,
          cuisine: recipe.cuisine,
          keywords: recipe.keywords,
          author: recipe.author ?? null,
          macros: macros ?? null,
          warnings: warnings.length ? warnings : undefined,
        },
      };
    },
  };
}
