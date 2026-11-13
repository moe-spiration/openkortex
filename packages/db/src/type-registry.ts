// Typ-Registry: die einzige Quelle für alle `knowledge_items.type`-Werte.
// Pro Typ: Anzeigename, Lucide-Icon, Zielordner im Vault, Metadata-Schema (Zod), Status-Enum.
// Daraus abgeleitet (nicht duplizieren!): KNOWLEDGE_ITEM_TYPES, DOMAIN_OBJECT_FOLDERS,
// SYSTEM_FOLDER_PATHS, DEFAULT_FOLDER_BY_TYPE, md-sync-Ordner->Typ, MCP-Objektvalidierung.
//
// Zielordner der Typen (Vault, 1:1 `folders.folder_path`):
//   note 10_Notes | daily_note 10_Notes/Daily | meeting 20_Meetings | recipe 50_Recipes | digest 90_Digests
//   article/video/podcast/social/bookmark 30_Clippings | ai_chat 40_AI_Memories
//   image/voice/email 00_Inbox | pdf/epub 60_Documents
//   Objekte (person, project, ...) 70_Objects/<Plural>
//   movie 30_Clippings/Movies | product 30_Clippings/Products | place 30_Clippings/Places
//   inspiration 30_Clippings/Inspiration | session 30_Clippings/Sessions
//   book 60_Documents/Books | receipt 60_Documents/Receipts
//   prompt 40_AI_Memories/Prompts | snippet 40_AI_Memories/Snippets
// Die DB-Seite (kortex._bootstrap_user) legt dieselben Ordner an; die Migration muss mit dieser
// Tabelle übereinstimmen (Test: type-registry.test.ts liest die Migration).
//
// `metadata.status` ist der gemeinsame Lifecycle-Schlüssel (nicht zu verwechseln mit der
// Spalte `status` = Pipeline-Zustand inbox/processed/...). `metadata.feedback` (Freitext) und
// `metadata.rating` sind für alle neuen Typen erlaubt.

import { t, tx } from "@kortex/i18n";
import { z } from "zod";
import type {
  AssetMetadata,
  ConceptMetadata,
  GoalMetadata,
  OrganizationMetadata,
  PersonMetadata,
  ProjectMetadata,
  ToolMetadata,
} from "./domain";
import { lazyLabels } from "./i18n";

// --- Schema-Bausteine -------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)");
const str = z.string().min(1).max(500);
const longStr = z.string().min(1).max(5000);
const strList = z.array(str).max(50);
// Dieselben Werte wie PRIORITIES in domain.ts (Test stellt die Gleichheit sicher; kein Import,
// weil domain.ts aus dieser Datei abgeleitet wird).
const priority = z.enum(["low", "medium", "high", "urgent"]);

/** Für alle neuen Typen erlaubt. */
const common = {
  feedback: longStr.optional(),
  rating: z.number().min(0).max(10).optional(),
};

/** Optional enrichment (S16): where the filled fields came from; "llm" is a proposal to review. */
const enrichmentInfo = z.strictObject({
  source: z.enum(["omdb", "openlibrary", "llm"]),
  confidence: z.number().min(0).max(1),
  at: z.string().optional(),
});

// --- Metadata-Schemas der 7 Domain-Objekte (strikt: Tippfehler fallen dem Agenten auf) ----

const objectSchemas = {
  person: z.strictObject({
    role: str.optional(),
    organization: str.optional(),
    relationship: str.optional(),
    email: z.string().email().max(320).optional(),
    contact_info: z.record(z.string(), z.string().max(500)).optional(),
  }),
  project: z.strictObject({
    project_status: str.optional(),
    priority: priority.optional(),
    target_date: isoDate.optional(),
    tech_stack: strList.optional(),
    repo_or_url: str.optional(),
  }),
  organization: z.strictObject({
    industry: str.optional(),
    org_type: str.optional(),
    location: str.optional(),
    website: str.optional(),
    key_contacts: strList.optional(),
  }),
  concept: z.strictObject({
    category: str.optional(),
    maturity: str.optional(),
    related_tools: strList.optional(),
  }),
  tool: z.strictObject({
    tool_category: str.optional(),
    usage_status: str.optional(),
    pricing: str.optional(),
    url: str.optional(),
  }),
  asset: z.strictObject({
    asset_type: str.optional(),
    location: str.optional(),
    status: str.optional(),
    monthly_value: z.number().finite().optional(),
  }),
  goal: z.strictObject({
    goal_timeframe: str.optional(),
    target_metric: str.optional(),
    progress_pct: z.number().min(0).max(100).optional(),
    status: str.optional(),
  }),
} satisfies {
  person: z.ZodType<PersonMetadata>;
  project: z.ZodType<ProjectMetadata>;
  organization: z.ZodType<OrganizationMetadata>;
  concept: z.ZodType<ConceptMetadata>;
  tool: z.ZodType<ToolMetadata>;
  asset: z.ZodType<AssetMetadata>;
  goal: z.ZodType<GoalMetadata>;
};

// --- Status-Enums (metadata.status) ---------------------------------------------------------

export const MOVIE_STATUSES = ["to_watch", "watched"] as const;
export const BOOK_STATUSES = ["want_to_read", "reading", "read"] as const;
export const PRODUCT_STATUSES = ["wishlist", "owned"] as const;
export type MovieStatus = (typeof MOVIE_STATUSES)[number];
export type BookStatus = (typeof BOOK_STATUSES)[number];
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

// --- Metadata-Schemas der neuen Typen -------------------------------------------------------

export const MOVIE_KINDS = ["movie", "series"] as const;
export const PLACE_CATEGORIES = ["restaurant", "travel", "other"] as const;

const typedSchemas = {
  movie: z.strictObject({
    kind: z.enum(MOVIE_KINDS).optional(),
    status: z.enum(MOVIE_STATUSES).optional(),
    year: z.number().int().min(1880).max(2200).optional(),
    genres: strList.optional(),
    director: str.optional(),
    cast: strList.optional(),
    imdb_id: str.optional(),
    pitch: longStr.optional(),
    runtime_min: z.number().int().min(1).max(10000).optional(),
    plot: longStr.optional(),
    imdb_rating: z.strictObject({ value: z.number().min(0).max(10), count: z.number().nullable() }).optional(),
    enrichment: enrichmentInfo.optional(),
    warnings: strList.optional(),
    ...common,
  }),
  book: z.strictObject({
    status: z.enum(BOOK_STATUSES).optional(),
    author: str.optional(),
    isbn: str.optional(),
    themes: strList.optional(),
    publisher: str.optional(),
    year: z.number().int().min(-3000).max(2200).optional(),
    pages: z.number().int().min(1).max(100000).optional(),
    enrichment: enrichmentInfo.optional(),
    warnings: strList.optional(),
    ...common,
  }),
  product: z.strictObject({
    status: z.enum(PRODUCT_STATUSES).optional(),
    price: z.number().finite().min(0).optional(),
    currency: str.optional(),
    shop: str.optional(),
    specs: z.record(z.string(), z.union([z.string().max(500), z.number().finite()])).optional(),
    url: str.optional(),
    ...common,
  }),
  place: z.strictObject({
    category: z.enum(PLACE_CATEGORIES).optional(),
    location: str.optional(),
    note: longStr.optional(),
    ...common,
  }),
  snippet: z.strictObject({
    language: str.optional(),
    source: str.optional(),
    ...common,
  }),
  inspiration: z.strictObject({
    kind: str.optional(),
    source: str.optional(),
    ...common,
  }),
  receipt: z.strictObject({
    amount: z.number().finite().optional(),
    currency: str.optional(),
    date: isoDate.optional(),
    issuer: str.optional(),
    category: str.optional(),
    tax: z.number().finite().optional(),
    ...common,
  }),
  prompt: z.strictObject({
    /** Namen der `{{variablen}}` im Prompt-Text. */
    variables: strList.optional(),
    use_case: longStr.optional(),
    ...common,
  }),
  session: z.strictObject({
    tabs: z.array(z.strictObject({ url: z.string().min(1).max(4000), title: str.optional() })).max(500).optional(),
    saved_at: z.string().min(1).max(40).optional(), // ISO-Zeitstempel
    ...common,
  }),
} as const;

// --- Die Registry ---------------------------------------------------------------------------

export interface TypeDefinition {
  /** Anzeigename für UI-Labels, in der aktuellen Sprache (Getter: wird bei jedem Lesen übersetzt). */
  readonly label: string;
  /** Lucide-Icon-Name. */
  icon: string;
  /** Zielordner im Vault, Fallback des Auto-Organizers. */
  folder: string;
  /** Datei in diesem Ordner ohne `type:` bekommt diesen Typ (nur für eindeutige Ordner). */
  inferFromFolder: boolean;
  /** Strikte Metadata-Validierung; null = freie Metadaten. */
  metadata: z.ZodObject | null;
  /** Erlaubte Werte für `metadata.status`, falls der Typ einen Lifecycle hat. */
  statuses?: readonly string[];
  /** Externe IDs in `metadata`, die Einträge desselben Typs eindeutig machen (Dedup-Schlüssel). */
  idKeys?: readonly string[];
}

/**
 * Adds `label` as a getter, so the name is translated when it is read, not when this module loads.
 * (Never spread a definition at module level: a spread would read the label once and freeze it.)
 */
const labelled = <const T extends object>(label: () => string, rest: T): T & { readonly label: string } =>
  Object.defineProperty(rest, "label", { get: label, enumerable: true }) as T & { readonly label: string };

const free = (label: () => string, icon: string, folder: string, inferFromFolder = false, idKeys?: readonly string[]): TypeDefinition =>
  labelled(label, { icon, folder, inferFromFolder, metadata: null, ...(idKeys ? { idKeys } : {}) });

export const TYPE_REGISTRY = {
  note: free(() => t("Note"), "notebook-pen", "10_Notes"),
  daily_note: free(() => t("Daily note"), "calendar-days", "10_Notes/Daily", true),
  article: free(() => t("Article"), "newspaper", "30_Clippings"),
  meeting: free(() => t("Meeting"), "mic", "20_Meetings", true),
  video: free(() => t("Video"), "circle-play", "30_Clippings"),
  podcast: free(() => t("Podcast"), "podcast", "30_Clippings"),
  recipe: free(() => t("Recipe"), "chef-hat", "50_Recipes", true),
  ai_chat: free(() => t("AI chat"), "bot", "40_AI_Memories", true),
  image: free(() => t("Image"), "image", "00_Inbox"),
  voice: free(() => t("Voice memo"), "audio-lines", "00_Inbox"),
  pdf: free(() => t("PDF"), "file-text", "60_Documents"),
  epub: free(() => t("E-book"), "book-open", "60_Documents"),
  social: free(() => t("Social post"), "share-2", "30_Clippings"),
  // Mail an Kortex: the Message-ID identifies a mail (dedup stage external_id).
  email: free(() => t("Email"), "mail", "00_Inbox", false, ["message_id"]),
  bookmark: free(() => t("Bookmark"), "bookmark", "30_Clippings"),
  digest: free(() => t("Digest"), "newspaper", "90_Digests", true),

  person: labelled(() => t("Person"), { icon: "user", folder: "70_Objects/People", inferFromFolder: true, metadata: objectSchemas.person }),
  project: labelled(() => t("Project"), { icon: "folder-kanban", folder: "70_Objects/Projects", inferFromFolder: true, metadata: objectSchemas.project }),
  organization: labelled(() => t("Organization"), { icon: "building-2", folder: "70_Objects/Organizations", inferFromFolder: true, metadata: objectSchemas.organization }),
  concept: labelled(() => t("Concept"), { icon: "lightbulb", folder: "70_Objects/Concepts", inferFromFolder: true, metadata: objectSchemas.concept }),
  tool: labelled(() => t("Tool"), { icon: "wrench", folder: "70_Objects/Tools", inferFromFolder: true, metadata: objectSchemas.tool }),
  asset: labelled(() => t("Asset"), { icon: "gem", folder: "70_Objects/Assets", inferFromFolder: true, metadata: objectSchemas.asset }),
  goal: labelled(() => t("Goal"), { icon: "target", folder: "70_Objects/Goals", inferFromFolder: true, metadata: objectSchemas.goal }),

  movie: labelled(() => t("Movie/series"), { icon: "clapperboard", folder: "30_Clippings/Movies", inferFromFolder: true, metadata: typedSchemas.movie, statuses: MOVIE_STATUSES, idKeys: ["imdb_id"] }),
  book: labelled(() => t("Book"), { icon: "book-marked", folder: "60_Documents/Books", inferFromFolder: true, metadata: typedSchemas.book, statuses: BOOK_STATUSES, idKeys: ["isbn"] }),
  product: labelled(() => t("Product"), { icon: "shopping-bag", folder: "30_Clippings/Products", inferFromFolder: true, metadata: typedSchemas.product, statuses: PRODUCT_STATUSES }),
  place: labelled(() => t("Place"), { icon: "map-pin", folder: "30_Clippings/Places", inferFromFolder: true, metadata: typedSchemas.place }),
  snippet: labelled(() => t("Snippet"), { icon: "code", folder: "40_AI_Memories/Snippets", inferFromFolder: true, metadata: typedSchemas.snippet }),
  inspiration: labelled(() => t("Inspiration"), { icon: "sparkles", folder: "30_Clippings/Inspiration", inferFromFolder: true, metadata: typedSchemas.inspiration }),
  receipt: labelled(() => t("Receipt"), { icon: "receipt", folder: "60_Documents/Receipts", inferFromFolder: true, metadata: typedSchemas.receipt }),
  prompt: labelled(() => t("Prompt"), { icon: "message-square-code", folder: "40_AI_Memories/Prompts", inferFromFolder: true, metadata: typedSchemas.prompt }),
  session: labelled(() => t("Tab session"), { icon: "layout-list", folder: "30_Clippings/Sessions", inferFromFolder: true, metadata: typedSchemas.session }),
} satisfies Record<string, TypeDefinition>;

export type RegisteredType = keyof typeof TYPE_REGISTRY;

/** Reihenfolge = Reihenfolge der Registry (Altbestand zuerst, damit sie dem DB-CHECK entspricht). */
export const REGISTERED_TYPES = Object.keys(TYPE_REGISTRY) as RegisteredType[];

export const NEW_TYPED_TYPES = [
  "movie",
  "book",
  "product",
  "place",
  "snippet",
  "inspiration",
  "receipt",
  "prompt",
  "session",
] as const satisfies readonly RegisteredType[];
export type NewTypedType = (typeof NEW_TYPED_TYPES)[number];

export const typeDefinition = (type: string): TypeDefinition | undefined =>
  Object.hasOwn(TYPE_REGISTRY, type) ? (TYPE_REGISTRY[type as RegisteredType] as TypeDefinition) : undefined;

export const typeLabel = (type: string): string => typeDefinition(type)?.label ?? type;
export const typeIcon = (type: string): string => typeDefinition(type)?.icon ?? "file-text";

/** Metadata-Feldnamen eines Typs (Frontmatter `metadata:`), leer bei freien Typen. */
export const metadataFields = (type: string): string[] =>
  Object.keys(typeDefinition(type)?.metadata?.shape ?? {});

/** Erlaubte `metadata.status`-Werte eines Typs (leer = kein Lifecycle). */
export const typeStatuses = (type: string): readonly string[] => typeDefinition(type)?.statuses ?? [];

/** Metadata-Schlüssel mit externen IDs (isbn, imdb_id, ...): ein Treffer darauf ist ein Duplikat. */
export const typeIdKeys = (type: string): readonly string[] => typeDefinition(type)?.idKeys ?? [];

/** Ordner -> Typ für Dateien ohne `type:`; tiefste Pfade zuerst (spezifisch vor allgemein). */
export const FOLDER_TYPE_INFERENCE: ReadonlyArray<readonly [folder: string, type: RegisteredType]> =
  REGISTERED_TYPES.filter((t) => TYPE_REGISTRY[t].inferFromFolder)
    .map((t) => [TYPE_REGISTRY[t].folder, t] as const)
    .sort((a, b) => b[0].split("/").length - a[0].split("/").length);

export type ValidatedMetadata =
  | { ok: true; metadata: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Validiert Metadaten gegen das Typ-Schema; Typen ohne Schema akzeptieren alles.
 * Strikt (Standard, für MCP/Agenten: Tippfehler fallen auf). `lenient` lässt unbekannte Felder
 * durch, für Pipeline/Adapter, die zusätzliche Quellfelder mitschreiben; bekannte Felder werden
 * trotzdem geprüft.
 */
export function validateTypeMetadata(
  type: string,
  metadata: Record<string, unknown>,
  opts: { lenient?: boolean } = {},
): ValidatedMetadata {
  const def = typeDefinition(type)?.metadata;
  if (!def) return { ok: true, metadata };
  const schema = opts.lenient ? def.loose() : def;
  const result = schema.safeParse(metadata);
  if (result.success) return { ok: true, metadata: result.data as Record<string, unknown> };
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return {
    ok: false,
    error: `Invalid metadata for ${type}: ${issues}. Allowed fields: ${metadataFields(type).join(", ")}`,
  };
}

// --- Anzeige (Web, Mobile, Desktop) --------------------------------------------------------------

/** Labels der `metadata.status`-Werte aller Typen, in der aktuellen Sprache (Getter). */
export const STATUS_LABELS: Readonly<Record<string, string>> = lazyLabels({
  to_watch: () => t("Watchlist"),
  watched: () => t("Watched"),
  want_to_read: () => t("Want to read"),
  reading: () => t("Reading"),
  read: () => tx("status", "Read"),
  wishlist: () => t("Wishlist"),
  owned: () => t("Owned"),
});
export const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status;

/** Labels der typisierten Metadata-Felder (Eigenschaften-Panel), in der aktuellen Sprache (Getter). */
export const FIELD_LABELS: Readonly<Record<string, string>> = lazyLabels({
  email: () => t("Email"),
  kind: () => t("Kind"),
  status: () => t("Status"),
  year: () => t("Year"),
  genres: () => t("Genres"),
  director: () => t("Director"),
  cast: () => t("Cast"),
  imdb_id: () => t("IMDb"),
  runtime_min: () => t("Runtime (min)"),
  plot: () => t("Plot"),
  imdb_rating: () => t("IMDb rating"),
  enrichment: () => t("Enrichment"),
  warnings: () => t("Notices"),
  publisher: () => t("Publisher"),
  pages: () => t("Pages"),
  pitch: () => t("Pitch"),
  author: () => t("Author"),
  isbn: () => t("ISBN"),
  themes: () => t("Themes"),
  price: () => t("Price"),
  currency: () => t("Currency"),
  shop: () => t("Shop"),
  specs: () => t("Specs"),
  url: () => t("Link"),
  category: () => t("Category"),
  location: () => t("Location"),
  note: () => t("Note"),
  language: () => t("Language"),
  source: () => t("Source"),
  amount: () => t("Amount"),
  date: () => t("Date"),
  issuer: () => t("Issuer"),
  tax: () => t("Tax"),
  variables: () => t("Variables"),
  use_case: () => t("Use case"),
  tabs: () => t("Tabs"),
  saved_at: () => t("Saved"),
  feedback: () => t("Feedback"),
  rating: () => t("Rating"),
  role: () => t("Role"),
  organization: () => t("Organization"),
  relationship: () => t("Relationship"),
  project_status: () => t("Project status"),
  priority: () => t("Priority"),
  target_date: () => t("Target date"),
  tech_stack: () => t("Tech stack"),
  repo_or_url: () => t("Repo/link"),
  industry: () => t("Industry"),
  org_type: () => t("Type"),
  website: () => t("Website"),
  key_contacts: () => t("Contacts"),
  maturity: () => t("Maturity"),
  related_tools: () => t("Tools"),
  tool_category: () => t("Category"),
  usage_status: () => t("Usage"),
  pricing: () => t("Pricing"),
  asset_type: () => t("Type"),
  monthly_value: () => t("Value/month"),
  goal_timeframe: () => t("Timeframe"),
  target_metric: () => t("Target metric"),
  progress_pct: () => t("Progress %"),
});
export const fieldLabel = (key: string): string => FIELD_LABELS[key] ?? key.replace(/_/g, " ");

// --- Typ-Erkennung: URL-Regeln, Tag-Hinweise, Prompt-Beschreibung -----------------------------------
// Einzige Quelle für "welche Seite / welcher Tag ist welcher Typ". Der Organizer-Prompt, die
// Ingest-Pipeline und das Backfill-Skript lesen alles von hier.

export interface UrlTypeMatch {
  type: RegisteredType;
  /** 0..1: how sure the rule is (a bare shop link is less clear than an ISBN link). */
  confidence: number;
  rule: string;
}

const ISBN10 = /^\d{9}[\dXx]$/;
/** Host (lowercase, without www/m prefix) and path of an http(s) URL; no DOM `URL` here (db has no DOM lib). */
function splitUrl(url: string): { host: string; path: string } | null {
  const m = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:]+)(?::\d+)?([^?#]*)/i.exec(url.trim());
  if (!m) return null;
  return { host: m[1]!.toLowerCase().replace(/^(www\.|m\.|music\.|mobile\.)/, ""), path: m[2] || "/" };
}
const hostIs = (host: string, ...names: string[]) =>
  names.some((n) => host === n || host.endsWith(`.${n}`));

interface UrlRule {
  rule: string;
  type: RegisteredType;
  confidence: number;
  test: (host: string, path: string) => boolean;
}

/** Order matters: the first matching rule wins (specific before general). */
const URL_RULES: readonly UrlRule[] = [
  // Books
  {
    rule: "amazon-isbn",
    type: "book",
    confidence: 0.92,
    // Books' ASIN is their ISBN-10; other ASINs start with a letter (B0…).
    test: (h, p) => /(^|\.)amazon\.[a-z.]+$/.test(h) && ISBN10.test(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(p)?.[1] ?? ""),
  },
  { rule: "goodreads", type: "book", confidence: 0.92, test: (h, p) => hostIs(h, "goodreads.com") && /^\/(book|work)\//.test(p) },
  { rule: "openlibrary", type: "book", confidence: 0.92, test: (h, p) => hostIs(h, "openlibrary.org") && /^\/(works|books)\//.test(p) },
  { rule: "google-books", type: "book", confidence: 0.85, test: (h, p) => h.startsWith("books.google.") || (hostIs(h, "google.com") && p.startsWith("/books")) },
  { rule: "thalia-hugendubel", type: "book", confidence: 0.7, test: (h, p) => hostIs(h, "thalia.de", "hugendubel.de", "buecher.de") && /\/(shop|artikel|buch|produkt)/.test(p) },
  // Films and series
  { rule: "imdb", type: "movie", confidence: 0.95, test: (h, p) => hostIs(h, "imdb.com") && p.startsWith("/title/") },
  { rule: "tmdb", type: "movie", confidence: 0.93, test: (h, p) => hostIs(h, "themoviedb.org") && /^\/(movie|tv)\//.test(p) },
  { rule: "letterboxd", type: "movie", confidence: 0.93, test: (h, p) => hostIs(h, "letterboxd.com") && p.startsWith("/film/") },
  { rule: "justwatch", type: "movie", confidence: 0.85, test: (h, p) => hostIs(h, "justwatch.com") && /\/(movie|tv-show|film|serie)\//.test(p) },
  // Video
  {
    rule: "youtube",
    type: "video",
    confidence: 0.95,
    test: (h, p) =>
      hostIs(h, "youtu.be") ||
      (hostIs(h, "youtube.com", "youtube-nocookie.com") && /^\/(watch|clip|shorts|embed|live|v)(\/|$)/.test(p)),
  },
  { rule: "vimeo", type: "video", confidence: 0.9, test: (h, p) => hostIs(h, "vimeo.com") && /^\/(\d+|channels|groups)/.test(p) },
  { rule: "twitch-vod", type: "video", confidence: 0.9, test: (h, p) => hostIs(h, "twitch.tv") && /^\/(videos|[^/]+\/clip)\//.test(p) },
  // Podcasts
  { rule: "spotify-podcast", type: "podcast", confidence: 0.95, test: (h, p) => hostIs(h, "spotify.com") && /^\/(episode|show)\//.test(p) },
  { rule: "apple-podcasts", type: "podcast", confidence: 0.95, test: (h) => hostIs(h, "podcasts.apple.com") },
  // Social
  { rule: "instagram", type: "social", confidence: 0.9, test: (h, p) => hostIs(h, "instagram.com") && /^\/(reel|reels|p|tv)\//.test(p) },
  { rule: "tiktok", type: "social", confidence: 0.9, test: (h) => hostIs(h, "tiktok.com") },
  { rule: "x-post", type: "social", confidence: 0.9, test: (h, p) => hostIs(h, "x.com", "twitter.com") && /^\/[^/]+\/status\//.test(p) },
  // Places
  { rule: "google-maps", type: "place", confidence: 0.85, test: (h, p) => (hostIs(h, "google.com") && p.startsWith("/maps")) || h === "maps.app.goo.gl" || h === "goo.gl" && p.startsWith("/maps") },
  { rule: "tripadvisor", type: "place", confidence: 0.85, test: (h) => hostIs(h, "tripadvisor.com", "tripadvisor.de") },
  // Products: a shop product page (after the ISBN rule)
  { rule: "amazon-product", type: "product", confidence: 0.75, test: (h, p) => /(^|\.)amazon\.[a-z.]+$/.test(h) && /\/(dp|gp\/product)\/[A-Z0-9]{10}/i.test(p) },
];

/** Type a URL clearly stands for (youtube/clip → video, amazon /dp with ISBN → book, imdb → movie, …), or null. */
export function typeFromUrl(url: string | null | undefined): UrlTypeMatch | null {
  if (!url) return null;
  const u = splitUrl(url);
  if (!u) return null;
  const { host, path } = u;
  for (const r of URL_RULES) {
    if (r.test(host, path)) return { type: r.type, confidence: r.confidence, rule: r.rule };
  }
  return null;
}

/** All rule names, for tests: every rule must have an example. */
export const URL_RULE_NAMES: readonly string[] = URL_RULES.map((r) => r.rule);

/** Tag segments (lowercase, exact) that say "this item is a <type>". */
export const TYPE_TAG_HINTS: Readonly<Partial<Record<RegisteredType, readonly string[]>>> = {
  book: ["buch", "bücher", "buecher", "book", "books", "buchempfehlung", "sachbuch", "roman", "ebook", "e-book"],
  movie: ["film", "filme", "movie", "movies", "serie", "serien", "series", "kino", "netflix"],
  product: ["wunschliste", "wishlist"],
  place: ["restaurant", "restaurants", "reise", "reisen", "travel", "sehenswürdigkeit"],
  receipt: ["beleg", "belege", "rechnung", "quittung", "receipt", "invoice"],
  snippet: ["snippet", "code-snippet", "codeschnipsel"],
};

/**
 * Type the tags of an item agree on (hierarchical tags match by segment: "medien/buch" → book).
 * Null when no tag points to a type or the tags point to several.
 */
export function typeFromTags(tags: readonly string[]): RegisteredType | null {
  const found = new Set<RegisteredType>();
  for (const tag of tags) {
    for (const seg of tag.toLowerCase().split("/").map((s) => s.trim())) {
      for (const [type, hints] of Object.entries(TYPE_TAG_HINTS) as [RegisteredType, readonly string[]][]) {
        if (hints.includes(seg)) found.add(type);
      }
    }
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** What each type is, in the words of the organizer prompt (only types the organizer may suggest). */
export const TYPE_PROMPT_HINTS: Readonly<Partial<Record<RegisteredType, string>>> = {
  movie: "a film or series tip, a film/series page (IMDb, TMDB, Letterboxd)",
  book: "a book, a book recommendation or a book page (Amazon /dp with an ISBN, Goodreads, Open Library); tags like \"buch\" mean book",
  product: "something to buy, with price or shop",
  place: "a restaurant, trip or place to visit",
  receipt: "an invoice or receipt",
  snippet: "a code snippet or command",
  inspiration: "a design, quote or idea to keep",
};

/** Item 10 of the organizer prompt: the registry's retypable types with their meaning. */
export function typeSuggestionGuide(): string {
  return (Object.entries(TYPE_PROMPT_HINTS) as [RegisteredType, string][])
    .map(([t, d]) => `"${t}" (${d})`)
    .join(", ");
}
