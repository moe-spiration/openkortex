import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import {
  PLACE_CATEGORIES,
  TYPE_REGISTRY,
  typeStatuses,
  validateTypeMetadata,
  type RegisteredType,
} from "@kortex/db";
import { byLocale, ph } from "../i18n";
import { typedExtractionPrompt } from "../prompts/typed-extraction";
import { findImdbId, findIsbn, normalizeIsbn } from "./external-ids";

/** Types the typed extraction fills. `prompt` and `session` come from dedicated capture paths. */
export const TYPED_EXTRACTION_TYPES = [
  "movie",
  "book",
  "product",
  "place",
  "receipt",
  "snippet",
  "inspiration",
] as const satisfies readonly RegisteredType[];
export type TypedExtractionType = (typeof TYPED_EXTRACTION_TYPES)[number];

export const isTypedExtractionType = (t: string | undefined): t is TypedExtractionType =>
  !!t && (TYPED_EXTRACTION_TYPES as readonly string[]).includes(t);

const nstr = z.string().nullable();
const nnum = z.number().nullable();

/** One flat object for all types: the model fills the fields of the requested type, rest null. */
export const TypedExtractionSchema = z.object({
  title: z.string(),
  description_md: z.string(),
  // movie
  movie_kind: z.enum(["movie", "series"]).nullable(),
  year: nnum,
  director: nstr,
  genres: z.array(z.string()),
  cast: z.array(z.string()),
  imdb_id: nstr,
  // book
  author: nstr,
  isbn: nstr,
  themes: z.array(z.string()),
  // product
  price: nnum,
  currency: nstr,
  shop: nstr,
  url: nstr,
  specs: z.array(z.object({ key: z.string(), value: z.string() })),
  // place
  place_category: z.enum(PLACE_CATEGORIES).nullable(),
  location: nstr,
  // receipt
  issuer: nstr,
  date: nstr,
  amount: nnum,
  tax: nnum,
  receipt_category: nstr,
  items: z.array(z.object({ name: z.string(), quantity: nnum, price: nnum })),
  // snippet / inspiration
  language: nstr,
  source: nstr,
  inspiration_kind: nstr,
});
export type TypedExtraction = z.infer<typeof TypedExtractionSchema>;

export interface TypedPayload {
  type: TypedExtractionType;
  title: string;
  /** Registry-valid metadata (lenient: extra source fields like receipt `items` pass). */
  metadata: Record<string, unknown>;
  contentMd: string;
}

const str = (v: string | null | undefined, max = 500): string | undefined => {
  const t = v?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};
const num = (v: number | null | undefined): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const strList = (v: readonly string[] | undefined, max = 50): string[] | undefined => {
  const out = [...new Set((v ?? []).map((s) => str(s)).filter((s): s is string => !!s))].slice(
    0,
    max,
  );
  return out.length > 0 ? out : undefined;
};
const isoDate = (v: string | null | undefined): string | undefined => {
  const m = v?.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day ? undefined : day;
};
const currency = (v: string | null | undefined): string | undefined => {
  const t = v?.trim();
  if (!t) return undefined;
  const sym: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };
  const c = sym[t] ?? t.toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : undefined;
};
const httpUrl = (v: string | null | undefined): string | undefined => {
  try {
    const u = new URL(v ?? "");
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

/** Default lifecycle value of a type from the registry (movie → to_watch, book → want_to_read, …). */
export const defaultStatusFor = (type: RegisteredType): string | undefined =>
  typeStatuses(type)[0];

const drop = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * Keeps only what validates against the registry schema, field by field, so one bad value (a
 * year of 20260, a currency "Euro") never loses the rest. IDs come from `source` text, not the model.
 */
export function buildTypedMetadata(
  type: TypedExtractionType,
  x: TypedExtraction,
  source: { text: string; url?: string },
): Record<string, unknown> {
  const hay = `${source.url ?? ""}\n${source.text}`;
  let raw: Record<string, unknown>;
  switch (type) {
    case "movie":
      raw = {
        kind: x.movie_kind ?? undefined,
        year: num(x.year) !== undefined ? Math.round(x.year as number) : undefined,
        director: str(x.director),
        genres: strList(x.genres, 10),
        cast: strList(x.cast, 10),
        imdb_id: findImdbId(hay),
      };
      break;
    case "book":
      raw = {
        author: str(x.author),
        isbn: findIsbn(hay) ?? normalizeIsbn(x.isbn),
        themes: strList(x.themes, 10),
      };
      break;
    case "product": {
      const specs = x.specs
        .slice(0, 30)
        .map((s) => [s.key.trim().slice(0, 100), s.value.trim().slice(0, 500)] as const)
        .filter(([k, v]) => k && v);
      raw = {
        price: num(x.price),
        currency: currency(x.currency),
        shop: str(x.shop),
        url: httpUrl(source.url) ?? httpUrl(x.url),
        specs: specs.length > 0 ? Object.fromEntries(specs) : undefined,
      };
      break;
    }
    case "place":
      raw = { category: x.place_category ?? undefined, location: str(x.location) };
      break;
    case "receipt":
      raw = {
        issuer: str(x.issuer),
        date: isoDate(x.date),
        amount: num(x.amount),
        currency: currency(x.currency),
        tax: num(x.tax),
        category: str(x.receipt_category),
        items:
          x.items.length > 0
            ? x.items
                .slice(0, 100)
                .map((i) => drop({ name: str(i.name, 200), quantity: num(i.quantity), price: num(i.price) }))
            : undefined,
      };
      break;
    case "snippet":
      raw = {
        language: str(x.language, 50)?.toLowerCase(),
        source: str(x.source) ?? httpUrl(source.url),
      };
      break;
    case "inspiration":
      raw = { kind: str(x.inspiration_kind), source: str(x.source) ?? httpUrl(source.url) };
      break;
  }
  const status = defaultStatusFor(type);
  const candidate = drop({ ...raw, ...(status ? { status } : {}) });
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidate)) {
    if (validateTypeMetadata(type, { [k]: v }, { lenient: true }).ok) kept[k] = v;
  }
  return kept;
}

const row = (label: string, value: string | number | undefined | null) =>
  value === undefined || value === null || value === "" ? null : `- **${label}:** ${value}`;

/** Facts block shown at the top of a typed item (the same values live in metadata/frontmatter). */
export function renderTypedFacts(type: TypedExtractionType, m: Record<string, unknown>): string {
  const s = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : undefined);
  const list = (k: string) => (Array.isArray(m[k]) && m[k].length ? (m[k] as string[]).join(", ") : undefined);
  const money = (k: string) =>
    typeof m[k] === "number" ? `${(m[k] as number).toFixed(2)}${s("currency") ? ` ${s("currency")}` : ""}` : undefined;
  const label = (map: Record<string, string>, v: string | undefined) => (v ? (map[v] ?? v) : undefined);
  let lines: Array<string | null> = [];
  switch (type) {
    case "movie":
      lines = [
        row(ph("kind"), label({ movie: ph("movie"), series: ph("series") }, s("kind"))),
        row(ph("year"), m.year as number | undefined),
        row(ph("director"), s("director")),
        row("Genres", list("genres")),
        row(ph("cast"), list("cast")),
        row("IMDb", s("imdb_id")),
      ];
      break;
    case "book":
      lines = [row(ph("author"), s("author")), row("ISBN", s("isbn")), row(ph("themes"), list("themes"))];
      break;
    case "product":
      lines = [
        row(ph("price"), money("price")),
        row(ph("shop"), s("shop")),
        row("Link", s("url")),
        ...Object.entries((m.specs as Record<string, string | number> | undefined) ?? {}).map(
          ([k, v]) => row(k, v),
        ),
      ];
      break;
    case "place":
      lines = [
        row(ph("category"), label({ restaurant: "Restaurant", travel: ph("travel"), other: ph("other") }, s("category"))),
        row(ph("address"), s("location")),
      ];
      break;
    case "receipt":
      lines = [
        row(ph("shop"), s("issuer")),
        row(ph("date"), s("date")),
        row(ph("amount"), money("amount")),
        row(ph("tax"), money("tax")),
        row(ph("category"), s("category")),
      ];
      break;
    case "snippet":
      lines = [row(ph("language"), s("language")), row(ph("source"), s("source"))];
      break;
    case "inspiration":
      lines = [row(ph("kind"), s("kind")), row(ph("source"), s("source"))];
      break;
  }
  return lines.filter((l): l is string => !!l).join("\n");
}

const receiptItemsTable = (m: Record<string, unknown>): string => {
  const items = (m.items as Array<{ name?: string; quantity?: number; price?: number }> | undefined) ?? [];
  if (items.length === 0) return "";
  const cell = (v: string) => v.replace(/\|/g, "\\|");
  return [
    `## ${ph("lineItems")}`,
    "",
    `| ${ph("lineItem")} | ${ph("quantity")} | ${ph("price")} |`,
    "| --- | --- | --- |",
    ...items.map(
      (i) =>
        `| ${cell(i.name ?? "")} | ${i.quantity ?? ""} | ${typeof i.price === "number" ? i.price.toFixed(2) : ""} |`,
    ),
  ].join("\n");
};

/** Clean Markdown for the item body. Snippets keep the original code verbatim in a fenced block. */
export function renderTypedMarkdown(
  type: TypedExtractionType,
  title: string,
  description: string,
  metadata: Record<string, unknown>,
  originalText: string,
): string {
  const parts = [`# ${title}`, "", renderTypedFacts(type, metadata)];
  const desc = description.trim();
  if (desc) parts.push("", desc);
  if (type === "snippet") {
    const lang = typeof metadata.language === "string" ? metadata.language : "";
    const code = originalText.trim().replace(/^```[\w-]*\n([\s\S]*?)\n```$/, "$1");
    // Fence longer than any backtick run inside, so the code can never break out.
    const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
    const fence = "`".repeat(longest + 1);
    parts.push("", `${fence}${lang}`, code, fence);
  } else if (type === "receipt") {
    const items = receiptItemsTable(metadata);
    if (items) parts.push("", items);
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface ExtractTypedInput {
  type: TypedExtractionType;
  text: string;
  url?: string;
  titleHint?: string;
  /** Image bytes for receipts (vision); text is then optional. */
  image?: { data: Uint8Array; mediaType: string };
  /** Today (ISO), so "gestern" on a receipt resolves. */
  today?: string;
}

/** Maps the model's raw answer to a validated payload. Pure, so it is tested without a model. */
export function typedPayloadFrom(
  input: Pick<ExtractTypedInput, "type" | "text" | "url" | "titleHint">,
  x: TypedExtraction,
): TypedPayload {
  const metadata = buildTypedMetadata(input.type, x, { text: input.text, url: input.url });
  const title = str(x.title, 120) ?? str(input.titleHint, 120) ?? TYPE_REGISTRY[input.type].label;
  return {
    type: input.type,
    title,
    metadata,
    contentMd: renderTypedMarkdown(input.type, title, x.description_md, metadata, input.text),
  };
}

/** One model call: fields of `type` from the text (or image). The caller routes the model (ADR-06). */
export async function extractTyped(
  input: ExtractTypedInput,
  options: { model: LanguageModel; maxChars?: number; abortSignal?: AbortSignal },
): Promise<TypedPayload> {
  const max = options.maxChars ?? 16_000;
  const text = input.text.length > max ? input.text.slice(0, max) : input.text;
  const header = byLocale({
    en: [
      `Target type: ${input.type}`,
      input.url ? `URL: ${input.url}` : null,
      input.titleHint ? `Title hint: ${input.titleHint}` : null,
      input.today ? `Today: ${input.today}` : null,
    ],
    de: [
      `Zieltyp: ${input.type}`,
      input.url ? `URL: ${input.url}` : null,
      input.titleHint ? `Titel-Hinweis: ${input.titleHint}` : null,
      input.today ? `Heute: ${input.today}` : null,
    ],
  })
    .filter(Boolean)
    .join("\n");
  const content: Array<
    { type: "text"; text: string } | { type: "file"; data: Uint8Array; mediaType: string }
  > = [{ type: "text", text: `${header}\n<content>\n${text}\n</content>` }];
  if (input.image)
    content.push({ type: "file", data: input.image.data, mediaType: input.image.mediaType });
  const { output } = await generateText({
    model: options.model,
    system: typedExtractionPrompt(),
    messages: [{ role: "user", content }],
    output: Output.object({ schema: TypedExtractionSchema, name: "typed_extraction" }),
    temperature: 0,
    abortSignal: options.abortSignal,
  });
  return typedPayloadFrom(input, output);
}
