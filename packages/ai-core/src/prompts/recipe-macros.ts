import { byLocale } from "../i18n";

/** German wording (the original). `recipeMacrosPrompt()` picks the language of the user. */
export const RECIPE_MACROS_PROMPT = `Du bist Ernährungsberater:in mit Schwerpunkt Low-Carb. Schätze die Nährwerte PRO PORTION für das folgende Rezept anhand üblicher Nährwerttabellen (z. B. BLS/USDA).

Liefere ein JSON-Objekt:
- "kcal": Kilokalorien pro Portion
- "protein_g", "carbs_g", "fat_g", "fiber_g": Gramm pro Portion
- "rationale": 1-2 Sätze auf Deutsch, welche Zutaten die Kohlenhydrate treiben und wie man das Rezept low-carb-freundlicher machen kann.

Runde auf ganze Zahlen. Wenn Mengen fehlen, nimm übliche Haushaltsmengen an.`;

const RECIPE_MACROS_PROMPT_EN = `You are a nutritionist with a focus on low-carb. Estimate the nutritional values PER SERVING for the following recipe from common nutrition tables (e.g. BLS/USDA).

Deliver a JSON object:
- "kcal": kilocalories per serving
- "protein_g", "carbs_g", "fat_g", "fiber_g": grams per serving
- "rationale": 1-2 sentences in English on which ingredients drive the carbohydrates and how the recipe can be made more low-carb friendly.

Round to whole numbers. If quantities are missing, assume common household quantities.`;

export const recipeMacrosPrompt = (): string =>
  byLocale({ en: RECIPE_MACROS_PROMPT_EN, de: RECIPE_MACROS_PROMPT });

export const renderRecipeMacrosMessage = (p: {
  name: string;
  servings: number | null;
  ingredients: readonly string[];
}): string =>
  byLocale({
    en: [
      `Recipe: ${p.name}`,
      `Servings: ${p.servings ?? "unknown (assume 4)"}`,
      "Ingredients:",
      ...p.ingredients.map((i) => `- ${i}`),
    ],
    de: [
      `Rezept: ${p.name}`,
      `Portionen: ${p.servings ?? "unbekannt (nimm 4 an)"}`,
      "Zutaten:",
      ...p.ingredients.map((i) => `- ${i}`),
    ],
  }).join("\n");
