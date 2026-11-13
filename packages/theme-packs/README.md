# @kortex/theme-packs

Selectable covers (tiles) and backgrounds (fullscreens) for the fixed surfaces of Kortex: 7 packs, 17 topics, dark and light.

| Path | What |
|---|---|
| `media/` | The images and `manifest.json`, 1:1 from the delivery package. Never edited by hand (marked `-text` in `.gitattributes` so hashes stay valid). |
| `src/manifest.gen.ts` | Generated from `media/manifest.json` (`pnpm --filter @kortex/theme-packs gen`): pack, topic and mode ids, asset paths, focus points. |
| `src/index.ts` | Pure helpers: `tileSources`, `fullSources`, `lumSources`, `focusX`, `coverTopicForType`, `resolveCover` (own > extracted > type tile), `parsePack`. |
| `scripts/sync-web.mjs` | Copies the media to `apps/web/public/theme-packs` (runs before `dev` and `build`; the target is gitignored). |
| `scripts/gen-android.mjs` | Generates `apps/mobile/src/theme/packAssets.gen.ts` (static `require` of the WebP files, all packs bundled). |
| `scripts/verify-media.mjs` | Checks every file against the SHA-256 prefix and size of the manifest. |

## Replacing a pack (e.g. new foto images)

1. Regenerate the images with the tools of the delivery package and replace `media/<pack>/` and `media/manifest.json`.
2. `pnpm --filter @kortex/theme-packs gen && pnpm --filter @kortex/theme-packs gen:android && pnpm --filter @kortex/theme-packs verify`.
3. `pnpm --filter @kortex/theme-packs test` (completeness, SHA, size budgets, generated files up to date).
4. Re-measure the contrast of titles, eyebrows and subtitles on the pack (target >= 4.5:1, also with every accent preset); the app places header text at the bottom of the scrimmed background for this reason.

No file names, sizes or paths are hard-coded anywhere else.
