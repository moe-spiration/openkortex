import { setLocale } from "@kortex/i18n";
// Tests must never touch the network: every adapter gets an injected fetch.
// If something falls back to the global fetch, fail loudly instead of calling a paid API.
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`Network disabled in tests (attempted fetch: ${String(input)})`);
}) as typeof fetch;

// linkedom (Readability DOM) takes several seconds to load cold on Windows under turbo load. Load
// it once per test file here, outside the 5 s per-test timeout, so the first HTML test does not
// time out (direct-reader.ts imports it lazily on first use).
await import("linkedom");

// The suite asserts the German output (prompts, headings, messages): it runs in German, which also
// proves that German behaviour is unchanged. English cases switch with `withLocale("en", …)`.
import "../src/i18n";
setLocale("de");

export {};
