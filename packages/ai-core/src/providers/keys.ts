import type { AiProvider } from "@kortex/db";

/** API keys of the three ADR-06 providers. Direct keys (Deepgram, Groq …) are optional overrides elsewhere. */
export type ProviderKeys = Partial<Record<AiProvider, string>>;

const clean = (v: string | undefined): string | undefined => {
  const s = v?.trim();
  // `.env.example` placeholders like "<DEIN_KEY>" count as unset.
  return s && !/^<.*>$/.test(s) ? s : undefined;
};

/** Reads ANTHROPIC_API_KEY (legacy alias CLAUDE_API_KEY), OPENROUTER_API_KEY and EDENAI_API_KEY. */
export function providerKeys(env: Record<string, string | undefined> = {}): ProviderKeys {
  const keys: ProviderKeys = {};
  const anthropic = clean(env.ANTHROPIC_API_KEY) ?? clean(env.CLAUDE_API_KEY);
  const openrouter = clean(env.OPENROUTER_API_KEY);
  const edenai = clean(env.EDENAI_API_KEY);
  if (anthropic) keys.anthropic = anthropic;
  if (openrouter) keys.openrouter = openrouter;
  if (edenai) keys.edenai = edenai;
  return keys;
}
