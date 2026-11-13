"use client";

import { useCallback } from "react";
import { t } from "@/i18n";
import { completeOnboarding } from "@/lib/api/onboarding-actions";
import { useShell } from "@/lib/shell/store";
import { isLiveData } from "@/lib/workspace-data";

/*
 * First-run setup ("Erststart"): the choices of the onboarding and the client hook that finishes it.
 *
 * The record (seen / completed, choices) is always kept in localStorage. Live mode additionally
 * calls the completeOnboarding server action (lib/api/onboarding-actions.ts): `bootstrapUser()`
 * (idempotent: user_settings + the 17 system folders) and the life areas merged into
 * user_settings.custom_taxonomy as `{ kind: "life_area", label }`. Theme and accent stay local.
 * Vault creation / Obsidian or Notion import is not wired yet (the choice is only recorded).
 */

export const ONBOARDING_KEY = "kortex.onboarding.v1";

export type VaultChoice = "new" | "obs" | "notion";

export const VAULT_CHOICES: { id: VaultChoice; title: string; help: string; icon: "plus" | "vault" | "cards" }[] = [
  {
    id: "new",
    get title() {
      return t("Create a new vault");
    },
    get help() {
      return t("~/KortexVault, empty and ready right away");
    },
    icon: "plus",
  },
  {
    id: "obs",
    get title() {
      return t("Connect an Obsidian vault");
    },
    get help() {
      return t("Markdown stays where it is, Kortex reads and writes along");
    },
    icon: "vault",
  },
  {
    id: "notion",
    get title() {
      return t("Import from Notion");
    },
    get help() {
      return t("Pages and databases become Markdown");
    },
    icon: "cards",
  },
];

/**
 * Stored as `{ kind: "life_area", label }` and matched by label against the life areas on the server
 * (server/life), so these stay the stored German names for now.
 */
export const ONBOARDING_AREAS = [
  "Health & Fitness",
  "Karriere & Leadership",
  "Finanzen & Investments",
  "Ventures",
  "Beziehungen & Familie",
  "Persönliches Wachstum",
  "Freizeit & Abenteuer",
  "Zuhause & Umfeld",
];

export interface OnboardingChoices {
  vault: VaultChoice;
  areas: string[];
  theme: "dark" | "light";
  accent: string;
}

export interface OnboardingRecord extends Partial<OnboardingChoices> {
  /** Finished the flow (vs. skipped it). */
  completed: boolean;
  at: string;
  /** Live mode: the server step failed (the choices are only stored locally). */
  syncError?: string;
}

export function readOnboarding(): OnboardingRecord | null {
  try {
    const raw = window.localStorage.getItem(ONBOARDING_KEY);
    return raw ? (JSON.parse(raw) as OnboardingRecord) : null;
  } catch {
    // Storage unavailable: treat as seen, so the flow doesn't reopen on every page.
    return { completed: false, at: "" };
  }
}

function write(rec: OnboardingRecord) {
  try {
    window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify(rec));
  } catch {
    /* private mode: nothing to remember */
  }
}

/** Marks the flow as seen without bootstrapping (Überspringen / Esc). */
export function skipOnboarding() {
  write({ ...readOnboarding(), completed: false, at: new Date().toISOString() });
}

/**
 * Finishes the setup. Never rejects: in live mode a failed server step is reported with a toast
 * and `syncError` on the returned record; the local record is written either way.
 */
export function useBootstrapWorkspace() {
  const live = isLiveData();
  const { showToast } = useShell();
  return useCallback(
    async (choices: OnboardingChoices): Promise<OnboardingRecord> => {
      const rec: OnboardingRecord = { ...choices, completed: true, at: new Date().toISOString() };
      if (live) {
        const res = await completeOnboarding({ areas: choices.areas }).catch((err: unknown) => ({
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        }));
        if (!res.ok) {
          rec.syncError = res.error;
          showToast(t("Setup not saved: {error}", { error: res.error }));
        }
      }
      write(rec);
      return rec;
    },
    [live, showToast],
  );
}
