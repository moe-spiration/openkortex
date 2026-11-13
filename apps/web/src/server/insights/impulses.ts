import { byLocale } from "@kortex/i18n";
import { t } from "@/i18n";
import { createHash } from "node:crypto";
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { InsightsIcon, RecCategory, Recommendation } from "@/lib/mock/insights";
import { AREA_KEYS, areaDef } from "../life/areas";
import type { LifeData } from "../life/compute";
import { addDays, localDate } from "../life/dates";
import type { LifeSource } from "../life/source";

/*
 * Insights impulses ("Empfehlungen"): one call to the routed `summarize` model over a compact
 * summary of the last 30 days, cached in kortex.user_insights (kind 'impulses'). Regenerated when
 * the cache is older than 24 h, or when the inputs changed and the cache is older than 2 h.
 * Too little data (fewer than MIN_ITEMS recent entries) → no call at all.
 */

export const IMPULSE_TTL_MS = 24 * 60 * 60 * 1000;
export const IMPULSE_MIN_REFRESH_MS = 2 * 60 * 60 * 1000;
export const MIN_ITEMS = 5;

export interface ImpulseInput {
  items: { id: string; type: string; title: string; tags: string[]; summary?: string }[];
  tasks: { title: string; due: string | null }[];
  topTags: [string, number][];
  areas: { key: string; name: string; score: number; empty: boolean }[];
  energy: { avg: number | null; days: number };
}

export interface ImpulseCache {
  recommendations: Recommendation[];
  top: string[];
  generated_at: string;
  model: string;
}

const CATS = ["books", "podcasts", "meetings", "personal", "links", "gaps"] as const;

const RecSchema = z.object({
  cat: z.enum(CATS),
  title: z.string().min(1).max(120),
  meta: z.string().max(80).optional(),
  text: z.string().min(1).max(320),
  why: z.string().min(1).max(260),
  cta: z.string().min(1).max(32),
  item_id: z.string().max(40).optional(),
  life_area: z.string().max(20).optional(),
});
const OutputSchema = z.object({
  recommendations: z.array(RecSchema).min(3).max(12),
  top: z.array(z.number().int().min(0)).max(3),
});

export function buildImpulseInput(src: LifeSource, life: LifeData): ImpulseInput {
  const from = addDays(src.today, -29);
  const recent = src.items.filter((i) => localDate(i.created, src.timeZone) >= from).slice(0, 60);
  const tags = new Map<string, number>();
  for (const i of recent)
    for (const t of i.tags)
      if (!/^(daily|life\/|area\/)/i.test(t)) tags.set(t, (tags.get(t) ?? 0) + 1);
  const energies = src.dailies
    .filter((d) => d.date >= from && d.energy !== null)
    .map((d) => d.energy!);
  return {
    items: recent.map((i) => ({
      id: i.id,
      type: i.type,
      title: i.title.slice(0, 120),
      tags: i.tags.slice(0, 6),
      ...(i.summary ? { summary: i.summary.slice(0, 160) } : {}),
    })),
    tasks: src.tasks
      .filter((t) => !t.done)
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
      .slice(0, 15)
      .map((t) => ({ title: t.title.slice(0, 100), due: t.due })),
    topTags: [...tags].sort((a, b) => b[1] - a[1]).slice(0, 12),
    areas: life.areas
      .filter((a) => a.active)
      .map((a) => ({ key: a.key, name: a.name, score: a.score, empty: Boolean(a.empty) })),
    energy: {
      avg: energies.length
        ? Math.round((energies.reduce((x, y) => x + y, 0) / energies.length) * 10) / 10
        : null,
      days: energies.length,
    },
  };
}

export const inputHash = (input: ImpulseInput) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

export function needsRefresh(
  cache: { at: string; hash: string | null } | null,
  hash: string,
  now: Date,
): boolean {
  if (!cache) return true;
  const age = now.getTime() - Date.parse(cache.at);
  return age > IMPULSE_TTL_MS || (cache.hash !== hash && age > IMPULSE_MIN_REFRESH_MS);
}

const impulseSystem = (): string =>
  byLocale({
    en: `You are Kortex, a personal knowledge assistant. You get a summary of a person's vault (entries of the last 30 days, open tasks, topics, life areas, energy).
Write concrete, short impulses in English, addressing the person directly as "you", without platitudes, without emojis, without dashes as punctuation.
Categories:
- books: a real, fitting book (meta = "Author · Book").
- podcasts: a real, fitting podcast or episode (meta = "Podcast").
- meetings: preparation or follow-up of a meeting from the list (set item_id).
- personal: habit, energy or balance (set life_area when an area fits).
- links: a connection between entries (set the item_id of one of the entries).
- gaps: a knowledge gap that follows from the topics.
Rules: take item_id only from the list, never invent one. life_area only from the given keys. "why" gives reasons with concrete entries or numbers from the data. "cta" is 1 to 3 words (e.g. "Add to reading list", "Open note", "Prepare"). 6 to 10 impulses, at least 3 categories. "top": the indices of the 3 most important impulses for today.`,
    de: `Du bist Kortex, ein persönlicher Wissens-Assistent. Du bekommst eine Zusammenfassung des Vaults einer Person (Einträge der letzten 30 Tage, offene Aufgaben, Themen, Life Areas, Energie).
Schreibe konkrete, kurze Impulse auf Deutsch in der Du-Form, ohne Floskeln, ohne Emojis, ohne Gedankenstriche als Satzzeichen.
Kategorien:
- books: ein reales, passendes Buch (meta = "Autor · Buch").
- podcasts: ein realer, passender Podcast oder eine Folge (meta = "Podcast").
- meetings: Vorbereitung oder Nachbereitung eines Meetings aus der Liste (item_id setzen).
- personal: Gewohnheit, Energie oder Balance (life_area setzen, wenn eine Area passt).
- links: Verbindung zwischen Einträgen (item_id eines der Einträge setzen).
- gaps: eine Wissenslücke, die sich aus den Themen ergibt.
Regeln: item_id nur aus der Liste übernehmen, nie erfinden. life_area nur aus den gegebenen Keys. "why" begründet mit konkreten Einträgen oder Zahlen aus den Daten. "cta" ist 1 bis 3 Wörter (z. B. "Auf Leseliste", "Notiz öffnen", "Vorbereiten"). 6 bis 10 Impulse, mindestens 3 Kategorien. "top": die Indizes der 3 wichtigsten Impulse für heute.`,
  });

const ICON: Record<RecCategory, InsightsIcon> = {
  books: "in-book",
  podcasts: "in-pod",
  meetings: "in-cal",
  personal: "in-compass",
  links: "in-link",
  gaps: "in-target",
};
const PALETTE: [string, string][] = [
  ["#1E3A5F", "#0EA5E9"],
  ["#3B1F5C", "#A855F7"],
  ["#14532D", "#22C55E"],
  ["#7C2D12", "#F97316"],
  ["#1F2937", "#64748B"],
  ["#4C0519", "#F43F5E"],
];
const pick = (s: string) =>
  PALETTE[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length]!;

/** Model output → Recommendation (ids and area keys validated against the input). */
export function toRecommendations(
  out: z.infer<typeof OutputSchema>,
  input: ImpulseInput,
): { recommendations: Recommendation[]; top: string[] } {
  const ids = new Set(input.items.map((i) => i.id));
  const recommendations = out.recommendations.map((r, i): Recommendation => {
    const id = r.item_id && ids.has(r.item_id) ? r.item_id : undefined;
    const area = r.life_area && AREA_KEYS.includes(r.life_area) ? r.life_area : undefined;
    const fn = id
      ? { kind: "note" as const, id }
      : area
        ? { kind: "life" as const, key: area }
        : r.cat === "links"
          ? { kind: "graph" as const }
          : undefined;
    const [c1, c2] = pick(r.title);
    const cover =
      r.cat === "books"
        ? {
            kind: "book" as const,
            title: r.title,
            sub: (r.meta ?? "").split("·")[0]!.trim() || t("Book"),
            c1,
            c2,
          }
        : r.cat === "podcasts"
          ? { kind: "pod" as const, title: r.title, sub: "Podcast", c1, c2 }
          : undefined;
    return {
      k: `r${i + 1}`,
      cat: r.cat,
      title: r.title,
      ...(r.meta ? { meta: r.meta } : {}),
      text: r.text,
      why: r.why,
      cta: r.cta,
      icon: ICON[r.cat],
      ...(fn
        ? { fn }
        : {
            doneLabel: t("Done"),
            msg: r.cat === "books" ? t("Added to the reading list") : t("Noted"),
          }),
      ...(area && !id ? { msg: t("Continue to {area}", { area: areaDef(area)!.name }) } : {}),
      ...(cover ? { cover } : {}),
    };
  });
  const top = [...new Set(out.top.filter((i) => i < recommendations.length))].map(
    (i) => recommendations[i]!.k,
  );
  for (const r of recommendations)
    if (top.length < Math.min(3, recommendations.length) && !top.includes(r.k)) top.push(r.k);
  return { recommendations, top };
}

export async function generateImpulses(
  model: LanguageModel,
  input: ImpulseInput,
): Promise<{ recommendations: Recommendation[]; top: string[] }> {
  const { output } = await generateText({
    model,
    system: impulseSystem(),
    prompt: `${byLocale({ en: "Data (JSON)", de: "Daten (JSON)" })}:\n${JSON.stringify(input)}`,
    output: Output.object({ schema: OutputSchema }),
    maxOutputTokens: 3000,
  });
  return toRecommendations(output, input);
}
