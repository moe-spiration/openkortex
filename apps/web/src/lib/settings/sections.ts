import type { IconId } from "@/components/shell/icons";
import { msg } from "@/i18n";

/*
 * Chapters of the settings (Ruhe round 2, device test 0.6.8: "ein paar Kapitelanordnungen in den Einstellungen").
 * Ordered like the mockup and Linear: who you are and the general basics first, then how Kortex looks and how you
 * capture, then AI and agents, then the connections to other apps and the vault, data and access last; sign-out and
 * the version close the list ("Über").
 *
 * Deep links stay valid: every id of 0.6.8 (profile, look, ai, connectors, cap, vault, mcp, notif, priv) still opens
 * its rows. "notif" now lands in "general" (language, time zone, setup, notifications), which took those rows out
 * of "profile"; any unknown id opens Appearance as before.
 */

export interface SettingsSection {
  id: string;
  label: string;
  icon: IconId;
}

export interface SettingsGroup {
  label: string;
  sections: SettingsSection[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: msg("Personal"),
    sections: [
      { id: "profile", label: msg("Account"), icon: "user" },
      { id: "general", label: msg("General"), icon: "globe" },
    ],
  },
  {
    label: msg("Workspace"),
    sections: [
      { id: "look", label: msg("Appearance"), icon: "palette" },
      { id: "cap", label: msg("Capture and hotkeys"), icon: "key" },
    ],
  },
  {
    label: msg("AI and agents"),
    sections: [
      { id: "ai", label: msg("AI models & routing"), icon: "sparkles" },
      { id: "mcp", label: msg("MCP server"), icon: "monitor" },
    ],
  },
  {
    label: msg("Connections"),
    sections: [
      { id: "connectors", label: msg("Connectors"), icon: "link" },
      { id: "vault", label: msg("Vault and sync"), icon: "vault" },
    ],
  },
  {
    label: msg("Data and access"),
    sections: [{ id: "priv", label: msg("Privacy and access"), icon: "lock" }],
  },
];

/** All chapters in list order. */
export const SETTINGS_SECTIONS: SettingsSection[] = SETTINGS_GROUPS.flatMap((g) => g.sections);

/** Old section ids that moved into another chapter. */
export const SECTION_ALIASES: Record<string, string> = { notif: "general" };

/** Fallback when the link names no known chapter (unchanged since 0.6.x). */
export const DEFAULT_SECTION = "look";

/** The chapter a `?section=` value opens: its own, the one it moved into, else Appearance. */
export function resolveSection(id: string | undefined | null): SettingsSection {
  const key = id ? (SECTION_ALIASES[id] ?? id) : DEFAULT_SECTION;
  return SETTINGS_SECTIONS.find((s) => s.id === key) ?? SETTINGS_SECTIONS.find((s) => s.id === DEFAULT_SECTION)!;
}
