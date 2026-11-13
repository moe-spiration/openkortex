"use server";

import type { AiProvider } from "@kortex/db/routing";
import { dataSource } from "@/lib/supabase/config";
import { getSession } from "@/lib/supabase/server";
import { readServerEnv } from "@/server/env";

export type KeyStatus = Record<AiProvider, boolean>;

/**
 * Whether the server has a key for each ADR-06 provider (ANTHROPIC_API_KEY or the legacy alias
 * CLAUDE_API_KEY, OPENROUTER_API_KEY, EDENAI_API_KEY). Returns booleans only, never key values.
 * Live mode answers signed-in users only.
 */
export async function getAiKeyStatus(): Promise<KeyStatus | null> {
  if (dataSource() !== "mock" && !(await getSession())) return null;
  const env = readServerEnv();
  return { anthropic: !!env.anthropicApiKey, openrouter: !!env.openrouterApiKey, edenai: !!env.edenaiApiKey };
}
