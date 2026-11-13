// No network in tests: anything that reaches the real fetch is a bug (or a paid API call).
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`Network disabled in tests (attempted fetch: ${String(input)})`);
}) as typeof fetch;

// The suite was written against the German interface: it runs in German, which also proves the
// second language stays complete. Tests of English output switch with `withLocale("en", …)`.
import { setLocale } from "@kortex/i18n";
import "@/i18n";
setLocale("de");
