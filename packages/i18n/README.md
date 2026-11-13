# @kortex/i18n

Translation layer for every Kortex app and package. English is the source language, German is the
second language. No dependencies, works in the browser, in React Native and in Node.

## Writing text

```ts
import { t, tn, tx, msg, byLocale, intlLocale } from "@kortex/i18n";

t("Save");                                   // "Save" / "Speichern"
t("Moved to {folder}", { folder });          // placeholders in braces
tn(count, "{n} entry", "{n} entries");       // plural by count, {n} is the count
tx("verb", "Open");                          // same English text, other meaning: key "verb::Open"
new Date().toLocaleDateString(intlLocale()); // "en-US" / "de-DE" for Intl and toLocale*String
```

Rules:

1. The English text is the key. The first argument is always a plain double-quoted string
   literal, never a variable, a concatenation or a template string. The check reads the code.
2. Text is resolved when the function runs. Never call `t` at module level: a constant filled at
   import time keeps the language of that moment. Either build the table in a function, or keep the
   English source in the table, mark it with `msg("…")` and call `t(row.label)` where it is shown.
3. One sentence, one call. Do not glue translated fragments together; use placeholders.
4. Long texts written per language (AI prompts, mail bodies) are no catalog entries:
   `byLocale({ en: "…", de: "…" })`.
5. Whoever starts work for a user sets the language: the web server per request
   (`apps/web/src/i18n/server.ts`), an app at start-up (`setLocale`). Library code only reads it
   (`getLocale()` or simply `t`).

## Catalogs

Each workspace keeps its German catalog as JSON in `src/i18n/de/*.json` and registers it once in
`src/i18n/index.ts`:

```json
{ "Save": "Speichern", "{n} entry": "{n} Eintrag", "{n} entries": "{n} Einträge", "verb::Open": "Öffnen" }
```

A missing entry falls back to English at runtime, but `pnpm i18n:check` (part of `pnpm check`)
fails on a source text without a German entry, on an entry no code uses and on one source text with
two different translations in the same workspace.

```
node scripts/i18n-check.mjs                         # every workspace
node scripts/i18n-check.mjs apps/web                # one workspace
node scripts/i18n-check.mjs apps/web --leftovers components/shell   # lines that still look German
```

## Where the language comes from

`kortex.user_settings.locale` (`en` or `de`) is the account's language and wins. Before sign-in and
in the demo mode the device or browser language decides (`pickLocale`), with English as the
fallback. Tests run in German (`setLocale("de")` in the test setup) unless they switch with
`withLocale("en", …)`.

## Product name

The name the apps show comes from `packages/i18n/product.json` (`PRODUCT_NAME`). Write the
literal word `Kortex` in English source text and in German catalogs as usual: `t`, `tx`, `tn`
and `byLocale` swap the standalone word for `PRODUCT_NAME` (`brand()`), and leave technical ids
such as `KortexVault`, `X-Kortex-Locale`, `kortex://` or `@kortex/*` alone. Text outside a
catalog (a title template, an aria label) uses `PRODUCT_NAME` directly. The Windows core reads
the same file at build time (`KORTEX_PRODUCT_NAME`, `src-tauri/src/i18n.rs`). Tests always run with
"Kortex" (`VITEST` set), so one set of expectations holds in both editions. The private build
says "Kortex"; the open-source export (`pnpm oss:export`) writes its own name into `product.json`
and into the static files listed under `productNameFiles` in `oss/export.json`.

## Feature switches

`product.json` `features` lists surfaces only the private build shows; read them with
`feature("griply")`. The export overwrites them with `features` from `oss/export.json`
(`griply: false`: no Griply hand-over on the task board, in settings, on life areas, and 404 on
`/api/connections/griply/*` and `/api/mobile/griply`). Tests must pass with a switch on and off:
set `FEATURES.<name>` in the test and restore it afterwards.
