import { t } from "@/i18n";
import { z } from "zod";
import { PACK_IDS } from "@kortex/theme-packs";
import { ACCENTS } from "@/lib/shell/accent";
import { HabitsSchema } from "./habits";

/*
 * What the settings UI may write to kortex.user_settings, and how custom_taxonomy is shaped.
 * Pure (no I/O): shared by the server actions (lib/api/settings-actions.ts, onboarding-actions.ts),
 * the client store and the tests.
 *
 * Never writable from here: user_id, subscription_tier, ai_routing_config (own actions in
 * server/routing/actions.ts), embedding_lock (set by the first embedding / the re-embed),
 * mcp_token_* (rotate / revoke actions), the deprecated *_model columns and updated_at (trigger).
 */

export const USER_SETTINGS_WRITABLE = [
  "auto_tag_enabled",
  "auto_cluster_enabled",
  "weekly_digest_day",
  "custom_taxonomy",
  "enabled_connectors",
  "locale",
  "habits",
  "daily_ai_budget_eur",
  "auto_place_threshold",
  "theme_pack",
  "accent",
] as const;
export type WritableSettingsKey = (typeof USER_SETTINGS_WRITABLE)[number];

/** One custom_taxonomy entry. Onboarding writes `{ kind: "life_area", label }`. */
export const TaxonomyEntrySchema = z.object({
  kind: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(120),
});
export type TaxonomyEntry = z.infer<typeof TaxonomyEntrySchema>;

export const LIFE_AREA_KIND = "life_area";

export const UserSettingsPatchSchema = z
  .strictObject({
    auto_tag_enabled: z.boolean(),
    auto_cluster_enabled: z.boolean(),
    // 0 = Sonntag … 6 = Samstag (column check: 0..6)
    weekly_digest_day: z.number().int().min(0).max(6),
    custom_taxonomy: z.array(TaxonomyEntrySchema).max(500),
    enabled_connectors: z
      .array(z.string().trim().min(1).max(40))
      .max(50)
      .transform((ids) => [...new Set(ids)]),
    locale: z.enum(["de", "en"]),
    habits: HabitsSchema,
    // S2a daily AI budget in EUR (column check: 0..100), cents precision
    daily_ai_budget_eur: z
      .number()
      .min(0)
      .max(100)
      .transform((v) => Math.round(v * 100) / 100),
    // Auto-placement threshold 0..1 (1 = review every capture)
    auto_place_threshold: z
      .number()
      .min(0)
      .max(1)
      .transform((v) => Math.round(v * 100) / 100),
    // Theme pack id (packages/theme-packs) and accent: a preset id or a custom #rrggbb
    theme_pack: z.enum(PACK_IDS),
    accent: z.union([
      z.enum(ACCENTS.map((a) => a.id) as [string, ...string[]]),
      z.string().regex(/^#[0-9a-fA-F]{6}$/),
    ]),
  })
  .partial();
export type UserSettingsPatch = z.infer<typeof UserSettingsPatchSchema>;

export type PatchCheck = { ok: true; patch: UserSettingsPatch } | { ok: false; error: string };

/**
 * Validates a settings patch from the client. Unknown or protected keys are an error (not silently
 * dropped), so a wrong call shows up instead of looking saved. An empty patch is valid.
 */
export function checkUserSettingsPatch(raw: unknown): PatchCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, error: t("Invalid settings") };
  const allowed = new Set<string>(USER_SETTINGS_WRITABLE);
  const blocked = Object.keys(raw).filter((k) => !allowed.has(k));
  if (blocked.length) return { ok: false, error: t("Cannot be changed: {keys}", { keys: blocked.join(", ") }) };
  const r = UserSettingsPatchSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    return {
      ok: false,
      error: issue?.path.length ? t("Invalid value for {field}", { field: issue.path.join(".") }) : t("Invalid value"),
    };
  }
  return { ok: true, patch: r.data };
}

/** Entries of a stored custom_taxonomy that have the known shape (others are kept, but not read). */
export function taxonomyEntries(raw: unknown): TaxonomyEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => {
    const r = TaxonomyEntrySchema.safeParse(e);
    return r.success ? [r.data] : [];
  });
}

/** Life area labels stored in custom_taxonomy. */
export function lifeAreas(raw: unknown): string[] {
  return taxonomyEntries(raw)
    .filter((e) => e.kind === LIFE_AREA_KIND)
    .map((e) => e.label);
}

/**
 * Adds life areas to a stored custom_taxonomy. Existing entries stay as they are (any shape, any
 * order); a label already present as life area (case-insensitive) is not added twice.
 */
export function mergeLifeAreas(existing: unknown, labels: string[]): unknown[] {
  const base: unknown[] = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(lifeAreas(base).map((l) => l.toLocaleLowerCase("de")));
  for (const raw of labels) {
    const label = raw.trim();
    if (!label || label.length > 120) continue;
    const key = label.toLocaleLowerCase("de");
    if (seen.has(key)) continue;
    seen.add(key);
    base.push({ kind: LIFE_AREA_KIND, label } satisfies TaxonomyEntry);
  }
  return base;
}
