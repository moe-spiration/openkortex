# Website and live demo

The public website of OpenKortex (English at `/`, German at `/de/`) and a live demo that runs only
in the browser: the web app in mock mode (`KORTEX_DATA_SOURCE=mock`) with sample data, no backend,
no sign-in, no AI. Everything is one folder of static files that any static host can serve.

```bash
pnpm site:build        # builds the web app in mock mode, saves the demo, renders the website → site/dist
pnpm site:serve        # preview on http://localhost:4000
```

`node site/scripts/build.mjs --skip-build` reuses an existing mock build of `apps/web`, `--keep-demo`
reuses the demo already in the output folder (no app build, no crawl; only screenshots and pages are
redone), `--no-demo` renders only the website pages, `--out <dir>` writes elsewhere. Playwright (from `apps/web`) drives
the crawl and the screenshots; set `KORTEX_CHROMIUM=<path to chrome>` if its own browser download
is not installed.

## How the demo works

`scripts/build-demo.mjs` starts the mock build with `next start`, visits every page (static routes,
the paths from each dynamic route's `generateStaticParams`, and every link found on the way) and
saves:

- each page as `<path>.html` and `<path>/index.html` (hosts differ in which one they serve);
- each page's React Server Component payload in `_demo/rsc/<hash>.txt`, so moving between pages
  keeps the in-memory demo state instead of reloading;
- `.next/static` and `apps/web/public`.

`demo-shim.js` is inlined at the top of every demo page. It serves those payloads to the app's
router, answers every `/api/` call with a 503 "not available in the live demo" (in mock mode the
app shows its own empty state for these), removes a trailing slash some hosts add, and shows a
small "Live demo" badge that links back to the website. The app itself is not changed for the demo.

Changes made in the demo live only in that browser tab and are gone after a reload.

## Website

`src/index.html` is the one page template; `src/i18n/en.json` and `de.json` hold its texts (same keys,
a test checks it). `{{icon:name}}` inlines a Lucide icon from the web app's `lucide-react`.
`{{repoUrl}}` comes from `--repo <owner>/<name>`, else `repo` in `oss/export.json` (private
repository), else the GitHub remote `origin` of the clone. No external fonts, scripts, cookies,
tracking or requests to other sites: the typeface is Geist from the demo build.

Look: the app's calm "Ruhe" look (`packages/ui/src/styles/ruhe.css`): the same warm grey OKLCH tokens,
hairlines instead of borders, one indigo accent for the primary action, the current step and the
thing in motion, monochrome Lucide icons and the app's large line pictograms. Light and dark are
both complete; the header switch keeps a choice per browser, otherwise the system decides.

Screens: the build takes every demo screen in dark and light (`img/<name>.jpg`, `img/<name>-light.jpg`:
Today, library with an open entry, journal, graph, agent, tasks, command palette); they are not in
git. The page shows the one that matches the theme. The "whole system" section shows each app in
the frame it lives in: `{{shot:windows}}`, `{{shot:android}}` and `{{shot:clipper}}` take a reviewed
screenshot from `src/img/<name>.webp` (and `<name>-light.webp`) when there is one, else the small
HTML drawing in `src/shots/<name>.html`. Pictures in `src/img/` are binaries of the export and need
approval (`node scripts/oss-export.mjs --check --approve-binaries site/src/img/`).

Motion (`src/site.css`, `src/site.js`): the hero diagram (every app sends captures to the server,
which files Markdown and answers agents) plays once on load, then dots and labelled chips for the
kinds of content (website, e-book, recipe, photo, ...) travel from their app to the center. Below
it, the demo screens stand as stacked windows and cross-fade. Blocks rise in once when they scroll
into view; the pictograms loop slowly once they are on screen. The four steps and the screenshot deck
advance only while on screen and pause on hover or focus. The three scenes (clipping in the browser,
capturing on the phone, agents reading and writing) are short CSS choreographies that `site.js`
replays while they are on screen. With "reduce motion" nothing moves by itself; everything stays
reachable by click and keyboard.

Pictures for the repository README (`site/readme/`, referenced by the repository `README.md`):
`node site/scripts/readme-media.mjs` after `pnpm site:build` records the hero diagram and the three
scenes as GIFs, saves the platform overview (`screen-platforms.jpg`) and copies the demo screens, each
in dark and light (`-light`), for `<picture>` in the README. It needs ffmpeg on PATH. New or changed pictures have to
be approved for the export (`node scripts/oss-export.mjs --check --approve-binaries site/readme/`).

## Hosting (Cloudflare Pages)

The site is uploaded to Cloudflare Pages (free plan) by Direct Upload: the build needs Playwright
and a Chromium, which Cloudflare's own build image does not offer reliably, so it runs where the
repository is checked out.

```bash
pnpm site:build
pnpm site:deploy      # wrangler pages deploy site/dist --project-name <cloudflareProject>
```

`pnpm site:deploy` needs `CLOUDFLARE_API_TOKEN` (permission "Cloudflare Pages: Edit") and
`CLOUDFLARE_ACCOUNT_ID`, or a one-time `npx wrangler login`. Wrangler is pinned in
`scripts/deploy.mjs` and fetched on demand.

`site.json` is the one place that names the address and the Pages project. All links inside the
site and the demo are root-relative, so the same build works on `*.pages.dev`, on a custom domain
and on any other static host that serves it at the domain root. `_headers` (security and cache
headers) is read by Cloudflare Pages and Netlify.

Small pages around the website (template `src/page.html`):

- `/soon` and `/de/soon`: "not public yet". While `repoPublic` in `site.json` is `false`, every link
  to the repository (code, self-hosting guide, contribution rules, license) leads here instead of
  to a GitHub 404. Set it to `true` on the day the repository goes public.
- `/404.html`: the page a static host shows for an unknown address.
- `/imprint` and `/de/imprint`: the legal notice of whoever hosts the site. Its lines come from
  `siteImprint.lines` in the private `kortex.instance.json` at the repository root; without that
  file (as in the open-source edition) no imprint page and no footer link are written.

Moving to a custom domain later:

1. Cloudflare dashboard → the Pages project → Custom domains → add the domain (Cloudflare shows
   the DNS record to set, or sets it when the domain is on Cloudflare).
2. Set `url` in `site.json` to the new address, then `pnpm site:build && pnpm site:deploy`
   (canonical links, sitemap and social previews follow).
3. Optional: a redirect from `<project>.pages.dev` to the domain (Cloudflare Bulk Redirects).
