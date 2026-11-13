import type { KeyStatus } from "./keyStatus";

/** True only when the status is known and the server has no key for any provider. */
export const noAiKey = (keys: KeyStatus | null | undefined): boolean => !!keys && !keys.anthropic && !keys.openrouter && !keys.edenai;
