import { PRODUCT_NAME, intlLocale, t } from "@/i18n";
import { z } from "zod";

/*
 * Account card (Settings > Profil) in live mode: auth user + user_settings + vault counts.
 * Pure (no I/O): shared by server/settings/account.ts, the settings page and the tests.
 * Name, timezone and avatar live in the auth user's user_metadata (no extra table, no migration).
 */

export interface AccountInfo {
  displayName: string;
  initial: string;
  /** Full address (the user's own); the UI shows `emailMasked` until revealed. */
  email: string | null;
  emailMasked: string;
  avatarUrl: string | null;
  timezone: string;
  /** auth.users.created_at (ISO). */
  memberSince: string | null;
  /** Sign-in method ("email", "google", …). */
  provider: string | null;
  entries: number;
  /** Sum of knowledge_items.file_size_bytes (uploads), null when unknown. */
  storageBytes: number | null;
  tier: string;
}

export const DEFAULT_TIMEZONE = "Europe/Berlin";

/** Timezones offered in the account card (the browser's own is added when missing). */
export const TIMEZONES = [
  "Europe/Berlin",
  "Europe/Vienna",
  "Europe/Zurich",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Istanbul",
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

/** Plans shown on the tier card (subscription_tier; no billing in the MVP). */
export const PLAN_TIERS: { id: string; label: string; help: string }[] = [
  {
    id: "free",
    label: `${PRODUCT_NAME} Free`,
    get help() {
      return t("Vault, Inbox and Copilot with your own keys");
    },
  },
  {
    id: "pro",
    label: `${PRODUCT_NAME} Pro`,
    get help() {
      return t("All connectors, meetings and weekly digests");
    },
  },
  {
    id: "team",
    label: `${PRODUCT_NAME} Team`,
    get help() {
      return t("Shared spaces for teams (planned)");
    },
  },
];

/** founder is Pro with a founder badge. */
export function planOf(tier: string | null | undefined): { id: string; label: string; founder: boolean } {
  const id = (tier ?? "free").toLowerCase();
  if (id === "founder") return { id: "pro", label: `${PRODUCT_NAME} Pro`, founder: true };
  const p = PLAN_TIERS.find((x) => x.id === id);
  return p ? { id: p.id, label: p.label, founder: false } : { id, label: `${PRODUCT_NAME} ${id.charAt(0).toUpperCase()}${id.slice(1)}`, founder: false };
}

/** "max@gmail.com" → "ma•••@gm•••.com". */
export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes("@")) return "–";
  const [local, domain] = email.split("@") as [string, string];
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  const keep = (s: string, n: number) => (s.length <= n ? s.slice(0, 1) : s.slice(0, n)) + "•••";
  return `${keep(local, 2)}@${keep(host, 2)}${tld}`;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Display name like the sidebar profile (lib/supabase/mapping.ts toProfile). */
export function displayNameOf(meta: Record<string, unknown>, email: string | null | undefined): string {
  const fromMeta = str(meta.full_name) ?? str(meta.name) ?? str(meta.display_name);
  if (fromMeta) return fromMeta;
  const local = (email ?? "").split("@")[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "Du";
}

export function accountFrom(
  user: { email?: string | null; created_at?: string | null; user_metadata?: Record<string, unknown> | null; app_metadata?: Record<string, unknown> | null },
  extra: { entries: number; storageBytes: number | null; tier: string | null | undefined },
): AccountInfo {
  const meta = user.user_metadata ?? {};
  const displayName = displayNameOf(meta, user.email);
  const avatar = str(meta.avatar_url) ?? str(meta.picture);
  return {
    displayName,
    initial: displayName.charAt(0).toUpperCase(),
    email: user.email ?? null,
    emailMasked: maskEmail(user.email),
    avatarUrl: avatar && /^https:\/\//.test(avatar) ? avatar : null,
    timezone: str(meta.timezone) ?? DEFAULT_TIMEZONE,
    memberSince: user.created_at ?? null,
    provider: str(user.app_metadata?.provider),
    entries: extra.entries,
    storageBytes: extra.storageBytes,
    tier: extra.tier ?? "free",
  };
}

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** What the account card may change (written to user_metadata). */
export const AccountPatchSchema = z
  .strictObject({
    displayName: z.string().trim().min(1, { error: () => t("Name must not be empty") }).max(80, { error: () => t("Name is too long") }),
    timezone: z.string().trim().max(64).refine(isTimeZone, { error: () => t("Unknown time zone") }),
    avatarUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || /^https:\/\/\S+$/.test(v), { error: () => t("Image URL must start with https://") }),
  })
  .partial();
export type AccountPatch = z.infer<typeof AccountPatchSchema>;

/** user_metadata fields for a patch (full_name drives the sidebar greeting too). */
export function metadataFor(patch: AccountPatch): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (patch.displayName !== undefined) {
    out.full_name = patch.displayName;
    out.display_name = patch.displayName;
  }
  if (patch.timezone !== undefined) out.timezone = patch.timezone;
  if (patch.avatarUrl !== undefined) out.avatar_url = patch.avatarUrl || null;
  return out;
}

/** "2,1 GB" / "640 MB" / "12 KB". */
export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString(intlLocale(), { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}

/** "März 2026". */
export function monthYear(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "–" : d.toLocaleDateString(intlLocale(), { month: "long", year: "numeric" });
}
