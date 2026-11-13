import { REGISTERED_TYPES, TYPE_REGISTRY, isDomainObjectType, type RegisteredType } from "@kortex/db";
import { t } from "@/i18n";
import type { AutoSpace } from "@/lib/mock/types";

/*
 * Sidebar "Spaces", derived from the type registry (packages/db/src/type-registry.ts). The curated spaces of the
 * prototype group format variants of one kind (Notizen = note + daily_note, Bücher = book + pdf + epub, ...) and keep
 * their glyphs and keys (URLs, theme topics, long labels). Every other content type of the registry gets its own space
 * with the registry's label and Lucide icon, so a new type shows up without touching this file. Domain objects are
 * no spaces (they have the "Objects und Hubs" group).
 */

export type SpaceDef = Omit<AutoSpace, "count">;

export const CURATED_SPACES: readonly SpaceDef[] = [
  { key: "all", get label() { return t("All entries"); }, icon: "zap", types: null },
  { key: "notes", get label() { return t("Notes"); }, icon: "i-note", types: ["note", "daily_note"], hint: "note" },
  { key: "meetings", get label() { return t("Meetings"); }, icon: "i-meeting", types: ["meeting"] },
  { key: "articles", get label() { return t("Articles"); }, icon: "i-article", types: ["article", "bookmark"], hint: "article" },
  { key: "books", get label() { return t("Books"); }, icon: "i-book", types: ["book", "pdf", "epub"], hint: "book" },
  { key: "videos", get label() { return t("Videos & Podcasts"); }, icon: "i-video", types: ["video", "podcast"] },
  { key: "ai", get label() { return t("AI Memories"); }, icon: "i-ai", types: ["ai_chat"] },
  { key: "recipes", get label() { return t("Recipes"); }, icon: "i-recipe", types: ["recipe"] },
  // Tab-Sessions of the web clipper: always listed, so the empty space can explain where they come from.
  { key: "session", get label() { return t("Sessions"); }, icon: "i-note", lucide: "layout-list", types: ["session"] },
];

/** Content types of the registry: everything except the 7 domain objects. */
export const CONTENT_TYPES: readonly RegisteredType[] = REGISTERED_TYPES.filter((t) => !isDomainObjectType(t));

/** One space per registry content type that no curated space collects; key = the type. */
export const TYPE_SPACES: readonly SpaceDef[] = CONTENT_TYPES.filter((t) => !CURATED_SPACES.some((s) => s.types?.includes(t))).map(
  (type): SpaceDef => ({
    key: type,
    // Read when shown: the registry label follows the language.
    get label() {
      return TYPE_REGISTRY[type].label;
    },
    icon: "i-note",
    lucide: TYPE_REGISTRY[type].icon,
    types: [type],
  }),
);

const countIn = (space: SpaceDef, content: readonly string[]): number =>
  space.types ? content.filter((t) => space.types!.includes(t)).length : content.length;

/**
 * Spaces with counts from the user's item types (knowledge_items.type, one entry per item). Curated spaces always
 * show; a registry type space only when it holds items, so the sidebar lists exactly the types the vault uses.
 */
export function buildSpaces(types: readonly string[]): AutoSpace[] {
  const content = types.filter((t) => !isDomainObjectType(t));
  const curated = CURATED_SPACES.map((s) => ({ ...s, count: countIn(s, content) }));
  const typed = TYPE_SPACES.map((s) => ({ ...s, count: countIn(s, content) })).filter((s) => s.count > 0);
  return [...curated, ...typed];
}

/** Registry type of a shell type without a stored one (mock items, objects): the names match except "ai". */
export const registryTypeOfShell = (shellType: string): string => (shellType === "ai" ? "ai_chat" : shellType);

/** Registry type of a shell item (knowledge_items.type when known). */
export const registryTypeOf = (item: { type: string; dbType?: string }): string => item.dbType ?? registryTypeOfShell(item.type);

/** Registry types that have no curated group: they show with their registry label and icon. */
export const isUngroupedType = (type: string): boolean => TYPE_SPACES.some((s) => s.key === type);

/** Items a space collects. */
export function spaceItems<T extends { type: string; dbType?: string }>(space: Pick<AutoSpace, "types">, items: readonly T[]): T[] {
  return space.types ? items.filter((i) => space.types!.includes(registryTypeOf(i))) : [...items];
}

/** Space of a URL key: the listed ones first, then any registry type space (an empty one still opens). */
export function findSpace(spaces: readonly AutoSpace[], key: string | undefined): AutoSpace | undefined {
  const listed = spaces.find((s) => s.key === key);
  if (listed) return listed;
  const def = TYPE_SPACES.find((s) => s.key === key);
  return def && { ...def, count: 0 };
}
