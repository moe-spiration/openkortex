import { msg, t, tFor } from "@/i18n";
import type { CoverKey } from "@/lib/mock/views";
import type { SourceItem } from "./source";

/*
 * How life areas map to data (WP-I). The six areas are fixed (the sidebar's LIFE_AREAS keys);
 * the onboarding choice in user_settings.custom_taxonomy (`{kind:"life_area", label}`) decides which
 * of them are active. An item belongs to an area by, in this order:
 *   1. an explicit tag `life/<key>` (also `area/<key>`) or `metadata.life_area` = key or label,
 *   2. keywords in its tags, cluster and folder (e.g. #fitness → health, #mba → career).
 * Items without a match belong to no area. Goals/projects follow the same rule.
 */

export type LifeTone = "health" | "strategy" | "finance" | "ai" | "food";

export interface LifeAreaDef {
  key: string;
  /** Full name, identical to the onboarding label. */
  name: string;
  /** Short name (review focus chips). */
  short: string;
  img: CoverKey;
  tone: LifeTone;
  keywords: string[];
}

/* English source names; `LIFE_AREA_DEFS` shows them in the current language, matching accepts both. */
const AREA_SOURCES: LifeAreaDef[] = [
  {
    key: "health",
    name: msg("Health & Fitness"),
    short: msg("Health"),
    img: "runner",
    tone: "health",
    keywords: [
      "health",
      "fitness",
      "gesundheit",
      "sport",
      "training",
      "workout",
      "gym",
      "hyrox",
      "lauf",
      "laufen",
      "running",
      "mobility",
      "yoga",
      "ernaehrung",
      "ernährung",
      "nutrition",
      "lowcarb",
      "low-carb",
      "keto",
      "schlaf",
      "sleep",
      "energie",
    ],
  },
  {
    key: "career",
    name: msg("Career & Leadership"),
    short: msg("Career"),
    img: "skyline",
    tone: "strategy",
    keywords: [
      "karriere",
      "career",
      "leadership",
      "fuehrung",
      "führung",
      "mba",
      "job",
      "management",
      "team",
      "bewerbung",
      "strategie",
      "strategy",
    ],
  },
  {
    key: "finance",
    name: msg("Finance & Investments"),
    short: msg("Finance"),
    img: "stones",
    tone: "finance",
    keywords: [
      "finanz",
      "finance",
      "invest",
      "immobil",
      "realestate",
      "geld",
      "money",
      "budget",
      "steuer",
      "tax",
      "aktie",
      "etf",
      "mfh",
      "depot",
    ],
  },
  {
    key: "ventures",
    name: msg("Ventures"),
    short: msg("Ventures"),
    img: "loft",
    tone: "ai",
    keywords: [
      "venture",
      "startup",
      "kortex",
      "gruendung",
      "gründung",
      "business",
      "saas",
      "mvp",
      "produkt",
      "product",
    ],
  },
  {
    key: "relations",
    name: msg("Relationships & Family"),
    short: msg("Relationships"),
    img: "dinner",
    tone: "food",
    keywords: [
      "familie",
      "family",
      "beziehung",
      "relationship",
      "freunde",
      "freund",
      "friends",
      "partner",
      "kinder",
      "kids",
      "hochzeit",
    ],
  },
  {
    key: "growth",
    name: msg("Personal Growth"),
    short: msg("Growth"),
    img: "journal",
    tone: "strategy",
    keywords: [
      "wachstum",
      "growth",
      "journal",
      "lesen",
      "reading",
      "buch",
      "book",
      "lernen",
      "learning",
      "persoenlich",
      "persönlich",
      "personal",
      "reflexion",
      "habit",
      "meditation",
    ],
  },
];

/** The areas with `name` and `short` in the current language (read at access time). */
export const LIFE_AREA_DEFS: LifeAreaDef[] = AREA_SOURCES.map((a) => ({
  ...a,
  get name() {
    return t(a.name);
  },
  get short() {
    return t(a.short);
  },
}));

export const AREA_KEYS = LIFE_AREA_DEFS.map((a) => a.key);
export const areaDef = (key: string) => LIFE_AREA_DEFS.find((a) => a.key === key);

const norm = (s: string) => s.toLocaleLowerCase("de").trim();
const tokens = (s: string) =>
  norm(s)
    .split(/[\s/_.#:,]+|(?<=\D)-(?=\D)/)
    .filter(Boolean);

/** Area key for a label like "Health & Fitness" or "health" (onboarding / metadata), else null. */
export function areaKeyForLabel(label: string): string | null {
  const l = norm(label);
  // Stored labels (onboarding choice, metadata.life_area) may be in either language.
  const exact = AREA_SOURCES.find(
    (a) => a.key === l || [a.name, a.short].some((s) => norm(s) === l || norm(tFor("de", s)) === l),
  );
  if (exact) return exact.key;
  return keywordArea(tokens(label));
}

function keywordArea(words: string[]): string | null {
  let best: string | null = null;
  let hits = 0;
  for (const a of LIFE_AREA_DEFS) {
    const n = words.filter((w) =>
      a.keywords.some((k) => w === k || (k.length >= 4 && w.startsWith(k))),
    ).length;
    if (n > hits) {
      best = a.key;
      hits = n;
    }
  }
  return best;
}

/** Explicit area of an item (tag life/<key>, area/<key>, metadata.life_area), or null. */
export function explicitArea(item: Pick<SourceItem, "tags" | "metadata">): string | null {
  for (const tag of item.tags) {
    const m = /^(?:life|area|life-area)\/(.+)$/i.exec(tag.trim());
    if (m) {
      const key = areaKeyForLabel(m[1]!);
      if (key) return key;
    }
  }
  const meta = item.metadata.life_area;
  return typeof meta === "string" && meta.trim() ? areaKeyForLabel(meta) : null;
}

/** The area an item belongs to, or null. */
export function areaOf(
  item: Pick<SourceItem, "tags" | "metadata" | "cluster" | "folder" | "title">,
): string | null {
  const explicit = explicitArea(item);
  if (explicit) return explicit;
  const words = [
    ...item.tags.flatMap(tokens),
    ...(item.cluster ? tokens(item.cluster) : []),
    ...tokens(item.folder.replace(/^\d+_/, "")),
  ];
  return keywordArea(words);
}

/** Area of a check-in habit by its label ("Morning Mobility" → health), or null. */
export const habitArea = (label: string) => keywordArea(tokens(label));

/**
 * Active area keys: the onboarding choice when present (unknown labels ignored), else all six.
 * Order follows LIFE_AREA_DEFS.
 */
export function activeAreaKeys(labels: readonly string[]): string[] {
  const chosen = new Set(labels.map(areaKeyForLabel).filter((k): k is string => k !== null));
  return chosen.size ? AREA_KEYS.filter((k) => chosen.has(k)) : [...AREA_KEYS];
}
