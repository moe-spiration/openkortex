# @kortex/extension

Kortex browser extension (WXT, Manifest V3, React 19, Tailwind v4 on `@kortex/ui`): web clipper, inline highlighter and ChatGPT/Claude saver. UI texts go through `@kortex/i18n` (English source, German translation).

| Touchpoint | Where | What |
| --- | --- | --- |
| **Clipper** | popup, `Alt+K` | Tab URL, title, OpenGraph preview, auto-routing (zero-setup) or folder choice, suggested hashtags, own note. "In Kortex Inbox werfen" is optimistic: the UI flips to *In Kortex Inbox gespeichert* as soon as the background worker has the request; transient failures are queued and retried (1 min alarm, exponential backoff). |
| **Highlighter** | content script on every http(s) page | Selecting text shows a floating mini menu "Highlight in Kortex sichern"; the context menu entry "Highlight in Kortex speichern" does the same. The text is marked immediately (rolled back if the request is refused), and sent with a locator (`quote` + `prefix/suffix`, text offsets, DOM range as XPath) for `item_highlights.locator`. Highlights are re-applied when you revisit the page. |
| **Chat saver** | chatgpt.com, chat.openai.com, claude.ai | "Save Chat to Kortex" for the whole conversation and "Save to Kortex" under each assistant answer. Output is clean Markdown (`### User` / `### Assistant`, code fences kept, tables, KaTeX source), type `ai_chat`, folder `40_AI_Memories`. |
| **Sessions & Prompts** | side panel (popup footer) | Toby-style tab manager (`src/ui/TabBoard.tsx`, shared with the full page). *Offene Tabs* (a tray of cards): *… speichern & schließen* or *Nur speichern* for the window or a pick (*Auswählen*); closed only after the server confirmed, pinned tabs stay open, a toast offers *Wiederherstellen*. Drag any card (dnd-kit, mouse/touch) onto a session, onto a tab position, or onto *Neue Session*; a hint on the dragged card says what releasing does. An open tab moved into a session is closed after it is saved (toast with *Wiederherstellen*; option *Tabs schließen, die in eine Session wandern*, on by default). Sessions without a name are named after what their tabs share (`src/lib/session-name.ts`: common topic and sites, else the main sites). `x` closes the browser tab. Sessions are collections with tab cards (favicon tile, two-line title, host): sort cards and sessions by drag, *Öffnen* restores all tabs in a new window, the `…` menu has *Alle hier öffnen*, rename, copy as Markdown, open in Kortex, delete (undo toast). Keyboard: `/` search, F2 rename, Alt+↑/↓ reorder sessions and tabs, *Verschieben nach …* / *Zu Session hinzufügen* menus. Feedback is Sonner toasts. |
| **Tab-Manager** | `tabs.html` (side panel ⤢, popup footer, right-click on the icon) | Full-page version like Toby's new-tab board: session index left, collections with a wide card grid in the middle, open tabs of **all** windows right (per window *speichern & schließen*). |

UI preview without loading the extension: `pnpm --filter @kortex/extension preview`, then `/page-sidepanel.html`, `/page-tabs.html`, `/page-popup.html`, `/page-options.html` (the real pages on an in-memory `chrome.*`, `preview/fake-chrome.ts`; `?theme=light`, `?empty=1`, `?queue=1`).

## Load the unpacked build

```bash
pnpm --filter @kortex/extension build        # -> apps/extension/.output/chrome-mv3
```

Chrome/Edge: `chrome://extensions` → Developer mode → **Load unpacked** → select `apps/extension/.output/chrome-mv3`. Then open the extension's options (puzzle icon → Kortex → Options, or `chrome://extensions` → Details → Extension options). Firefox: `pnpm --filter @kortex/extension build:firefox` (`.output/firefox-mv3`). Hot-reload dev build: `pnpm --filter @kortex/extension dev` (opens a managed Chrome profile, not your own).

## Capture into your Kortex (e.g. https://kortex.example.com)

1. **Create a personal token** in Kortex: sign in at https://kortex.example.com → *Einstellungen* → *Connectors* → *Persönliche API-Tokens* → name it (e.g. "Chrome Laptop") → *Token erzeugen* → *Kopieren*. The token (`kx_…`) is shown once; Kortex stores only a hash. Revoke it there any time; it only works for `/api/ingest` and only for your account (which must be on the allowlist).
2. **Load the extension**: build (command above), then `chrome://extensions` → *Developer mode* on → *Load unpacked* → `apps/extension/.output/chrome-mv3`. Pin the Kortex icon (puzzle piece).
3. **Connect**: Kortex icon → right-click → *Options* (or *Details* → *Extension options*). Enter the URL of your Kortex server (the options page opens by itself after installing; the browser asks for access to that address). A build made with `WXT_KORTEX_DEFAULT_URL` or a private `kortex.instance.json` has it preset. Paste the token and click **Verbindung testen**. On success the connection is saved and the mock mode switches off by itself; the options page shows *Live*.
4. **Capture**: `Alt+K` or the toolbar icon on any page clips it; selecting text offers the highlighter; chatgpt.com/claude.ai get the *Save to Kortex* buttons. The clipper shows what the server answered (accepted, auto-placed folder, then *Verarbeitet* with the final folder once the AI pipeline is done). The options page keeps a *Verlauf* of the last captures and a *Warteschlange* with *Jetzt senden*/*Verwerfen* for anything that could not be delivered yet.

5. **Summary detail and Autosave** (feedback round 3, C1/C2), on the options page (*Clipper*) and at the bottom of the popup:
   - *Detailgrad der Zusammenfassung*: *Knapp* (default) or *Ausführlich*. Sent as `summary_level: "concise" | "detailed"` with every `web_clip` and `ai_chat`; servers that do not know the field ignore it (zod strips unknown keys).
   - *Autosave* (off by default): the toolbar click (or `Alt+K`) saves the page at once with what the untouched form would send (default route, pre-selected hashtags, first cover, summary level). While Autosave is on the action has **no popup** (`chrome.action.setPopup({ popup: "" })`, synced from the settings by the background worker), so the click reaches `action.onClicked`, which grants `activeTab` just like the popup did. The worker reads the page (full extractor registry, given up after 8 s for the plain metadata), stores or queues the capture and shows a small toast on the page (injected with `chrome.scripting`, closed shadow root: *Wird gespeichert …* → *In Kortex gespeichert* / *Offline gespeichert* / error) plus the badge `✓` / `…` / `!` for 4 s. A second click on the same page within 5 s does not save twice. The click is always answered within 28 s (the plain metadata reader has its own 2.5 s budget, so a hanging page cannot keep the toast on *Wird gespeichert …*). A capture that was only queued (Kortex too slow) is retried after 8 s and the page then shows *Jetzt in Kortex gespeichert*. Right-click on the toolbar icon: *Mit Formular einwerfen …* (opens the form popup once, `popup.html?form=1`), *Sessions & Prompts öffnen*, *Tab-Manager öffnen (Vollbild)*, *Autosave ausschalten*. If the form popup cannot be opened, Autosave is back after one minute (alarm). Browsers without `setPopup`/`openPopup` keep the old popup confirmation.
   - **Write-ahead outbox:** every capture is stored in the outbox *before* its first request (attempts 0, left alone by the regular flush for 60 s) and removed on success. A service worker stopped mid-request loses nothing; the next flush delivers it with the same `idempotency_key`.

**Mock mode** is automatic: as long as no token is set, nothing leaves the browser and captures end up in the *Lokal gespeichert (nicht verbunden)* section of the options page. Switching the *Mock-Modus* toggle is an explicit choice that wins over the token (e.g. to demo without sending).

## `POST /api/ingest` contract

Defined in [`src/lib/api.ts`](src/lib/api.ts) (types are aligned with `@kortex/db`: `KnowledgeItemType`, `ItemStatus`, `item_highlights.locator`). The server side is `apps/web/src/server/ingest/` (`contract.ts` zod schemas, `service.ts`); a web test loads this client and runs it against the route. Everything below is backward compatible: older clients without `idempotency_key` keep working unchanged.

```
POST {baseUrl}/api/ingest
Authorization: Bearer <token>          Content-Type: application/json
GET  {baseUrl}/api/ingest              -> 200 with the same bearer (used by "Verbindung testen")
```

Request = `IngestRequest`, discriminated on `kind`; every request carries `client: { name: "kortex-extension", version }`, `captured_at` (ISO) and an `idempotency_key` (UUID, one per capture, reused by every retry):

| `kind` | Fields | Server behaviour (expected) |
| --- | --- | --- |
| `web_clip` | `url`, `title`, `description?`, `image_url?`, `site_name?`, `note?`, `summary_level?` (`concise`|`detailed`, C1), `folder_path?` (`null`/absent = auto-routing, set = `is_manual_placement = true`), `tags?` (no `#`), `type_hint?`, `transcript?`, `media?` (see *Page extractors*) | Create/merge a `knowledge_items` row for the URL (dedupe by URL), status `inbox`, run the ingestion pipeline; `note` goes above the clipped content. |
| `highlight` | `url`, `page_title`, `quote_text`, `note_text?`, `color?`, `locator: HighlightLocator` | Upsert a bookmark item for `url`, insert `item_highlights` (`quote_text`, `note_text`, `color`, `locator`). |
| `ai_chat` | `platform` (`chatgpt`\|`claude`), `scope` (`chat`\|`answer`), `url`, `title`, `content_md`, `message_count`, `folder_path: "40_AI_Memories"`, `tags?`, `summary_level?` | Create an `ai_chat` item; file name `YYYY-MM-DD_topic-slug.md` (same convention as the MCP `brain_log_agent_memory`). |

### Page extractors (cover, transcript, media)

The popup injects `extract.js` (an unlisted WXT script) into the active tab; it runs the registry in `src/lib/extract/` and returns one `PageMeta`: `image_url` plus ranked `image_candidates` (the clipper shows them as a cover choice, "Ohne Cover" included), `media`, `transcript` and short `capture_notes`. A site is one `Extractor { id, matches(url), extract(ctx) }` in `EXTRACTORS`; the generic reader (JSON-LD `Article`/`Product`/`VideoObject`/`Recipe` images, `og:image`, `twitter:image`, `image_src`, then the largest content image of at least 300 px) always runs and fills what the site extractor leaves open. Covers are absolute http(s) URLs only (never `data:`), raster before SVG.

| Site | Cover | Media | Transcript |
| --- | --- | --- | --- |
| YouTube (`watch`, `shorts`, `live`, `embed`, `youtu.be`) | `i.ytimg.com/vi/<id>/maxresdefault.jpg`, then `sddefault`, `hqdefault` (the clipper skips a missing/placeholder image) | `kind: video`, `provider: youtube`, duration, channel, publish date from the player response | `transcript.source: youtube-captions`; segments with `start`/`dur` in seconds |
| Amazon product pages | `#landingImage` `data-old-hires`, else the largest `data-a-dynamic-image` | none; price goes into `description` | none |
| Spotify episode/show/track, Apple Podcasts | artwork (`og:image`) | `kind: podcast` (`audio` for tracks), `provider`, duration, show, date | none |
| any page with a JSON-LD `VideoObject` | its image | `kind: video`, `provider: other` | none |

`transcript: { text, lang?, source: "youtube-captions" | "page" | "user", segments?: { start, dur?, text }[] }` and `media: { kind: "video" | "podcast" | "audio", provider?: "youtube" | "spotify" | "apple" | "other", duration_sec?, channel?, published_at? }` are optional additions to `web_clip` (the server ignores what it does not know). `transcript.text` is capped at 400,000 characters: longer ones are cut at a word with a `[Transkript gekürzt]` note and the user is told.

**YouTube captions.** The caption URLs in `ytInitialPlayerResponse` (`captionTracks`, manual German, then English, then automatic) are fetched as `json3` from the page origin. Since 2025 YouTube answers those with `200` and an empty body unless the player attached its proof-of-origin token, so the extractor falls back to the page's own transcript panel ("Transkript anzeigen": it opens the panel, reads the lines, closes it again). That fallback needs a normal watch page; Shorts and videos without a transcript panel end up with `capture_notes: ["Untertitel konnten nicht geladen werden"]` and are clipped without transcript.

Response = `IngestResponse`:

```ts
// HTTP 200
{ ok: true, kind, item_id, highlight_id?, type: KnowledgeItemType, status: ItemStatus,
  folder_path, auto_routed: boolean, duplicate: boolean, queued: boolean, replayed?: boolean,
  file?: string, suggested_tags?: string[] }
// HTTP 4xx/5xx
{ ok: false, error: { code: "unauthorized" | "invalid_request" | "not_configured" | "rate_limited" |
                        "server_error" | "not_found", message, details? } }
```

### Idempotency

`idempotency_key` (8-128 characters of `[A-Za-z0-9_.:-]`, honoured for `web_clip`, `highlight`, `ai_chat`) makes retries safe. The extension creates the key when it builds the request and the outbox re-sends the stored request, so a retry after a timeout or an offline period carries the same key. A key the server has seen for that URL is answered with the original item, `duplicate: true`, `queued: false`, `replayed: true`, and nothing is written again (no second highlight, no second clip note, no second answer item; for a highlight the original `highlight_id` comes back). Keys live in existing data (`knowledge_items.metadata.idempotency_keys`, newest 20; `item_highlights.locator.idempotency_key`), so no migration is needed. Known limits: two requests with the same key in flight at the same instant can both pass the lookup (a retry only follows a finished attempt, so this does not occur in practice), and a merge that lands while the pipeline job of the same item is running can lose its key (the job writes the metadata it read at its start); both only mean one more duplicate on a later retry. `note` captures and file uploads ignore the key.

### Field limits

The server's limits (`INGEST_LIMITS` in `contract.ts`, mirrored by `src/lib/limits.ts`; a web test asserts both tables are equal):

| Field | Limit | Field | Limit |
| --- | --- | --- | --- |
| `url` | 4096 | `note` (clip) | 20 000 |
| `image_url` (http/https only) | 4096 | `note_text` (highlight) | 20 000 |
| `title`, `page_title` | 500 | `quote_text` | 20 000 |
| `description` | 5000 | `content_md` | 2 000 000 |
| `site_name` | 200 | `folder_path` | 300 |
| `tags` | 30 entries, 100 chars each | | |

The extension fits a capture before it is sent (`applyLimits`, in the background outbox) instead of letting the server answer 400, and tells the user what it did: titles, descriptions and notes are cut with "…" ("Hinweis: Titel auf 500 Zeichen gekürzt" in the done state, or in the toast for highlights and chats), a chat is cut at a message boundary with a closing "Export gekürzt" note, an over-long page URL loses its query/fragment, tags are capped. A non-http(s) `og:image` (`data:`, `blob:`) or an over-long one is dropped silently. What cannot be fitted (a URL that is still too long, a folder path or a selection over the limit) is refused locally with a message. The note field of the clipper is limited to 20 000 characters while typing. Exceeding a limit anyway yields `400 invalid_request` with the zod issues in `details` (`[{ path: ["title"], … }]`); the popup names the field ("Der Titel wird vom Server abgelehnt").

### Errors and retries

| `error.code` | HTTP | Extension behaviour |
| --- | --- | --- |
| `unauthorized` | 401/403 | final; "Anmeldung abgelehnt" with an "Optionen öffnen" button |
| `invalid_request` | 400/413 | final; field-specific message, back to the form |
| `not_configured` | 503 | retried from the outbox (up to about a day, 30 min backoff cap); the clipper shows "gespeichert", plus "wird automatisch nachgeliefert" |
| `network`, `server_error`, `rate_limited` | none/5xx/429 | retried (8 attempts, 15 s doubling up to 30 min); the done state says it is queued |
| `not_found` | 404 | final |
| `setup_required` | - (client only) | URL/token not set: nothing is queued, "Noch nicht verbunden" with "Optionen öffnen" |

Queued captures are also delivered right after the settings change (outbox flush on `storage.onChanged`) and when the browser starts. The client sends `credentials: "omit"` (token only), a 15 s timeout, and never logs the token. The server answers extension origins (`chrome-extension://`, `moz-extension://`) with CORS headers, so saving the options does not depend on the optional host permission: the options page requests it with a port-less pattern (`http://localhost/*`, `https://host/*`) and carries on if the user declines.

## Structure

```
src/entrypoints/
  background.ts            outbox delivery, context menu, 1-min flush alarm, message hub
  popup/                   Alt+K clipper (ClipperPanel)
  options/                 URL/token + connection test, mock mode, theme, folders/tags, queue, activity log, mock inbox
  highlighter.content.tsx  -> content/highlighter.tsx   selection toolbar, marks, restore
  chat-export.content.tsx  -> content/chat.tsx          chat + per-answer buttons
src/lib/
  api.ts                   IngestRequest/Response, validation, client, mock server
  outbox.ts                optimistic queue + retry          settings.ts  settings + KeyValueStore
  chat/selectors.ts        ALL ChatGPT/Claude DOM selectors  chat/extract.ts  DOM -> transcript
  markdown.ts              HTML -> Markdown (turndown + rules for fences, tables, math, headings)
  highlight/locator.ts     text-quote + XPath anchoring, marks
  page-meta.ts, suggest.ts, requests.ts, messages.ts, mock-inbox.ts, activity.ts (server results log), result.ts (server answers as UI text)
  extract/                 page extractors: registry (index), generic, youtube, amazon, podcasts
src/ui/                    ClipperPanel, SelectionToolbar, ChatControls, Toast, ThemeRoot
src/styles/ext.css         Tailwind + @kortex/ui + prototype recipes the UI package lacks
preview/                   dev-only: stage.html-style preview and compare.html (not in the build)
test/                      Vitest (jsdom): markdown, chat fixtures, locator, api, outbox, UI
```

Content-script UIs live in shadow roots (page CSS cannot reach them); marks are plain `<mark class="kortex-hl">` in the page, styled via an adopted stylesheet (immune to page CSP).

### When ChatGPT or Claude change their markup

Only `src/lib/chat/selectors.ts` knows the sites' DOM (message, role, body, action host, streaming indicator, title). Update the selectors and the matching fixture in `test/fixtures/` (`chatgpt.html`, `claude.html`), run `pnpm --filter @kortex/extension test`. The fixtures are hand-written approximations of the markup (no network access during development), so the **first real-world check on both sites is still open**.

## Design v2 (board 11, V2-11H)

The UI follows DESIGN.md section 5 and the rules of `design/feedback/v2` board 11; `test/design-rules.test.ts` and `test/contrast.test.ts` keep them from drifting:

- **Type scale:** Geist everywhere, body 14/21, popup title H3 17/24, meta 12.5/18 (the `--type-*` tokens, copied into `.kx-root` because shadow roots do not inherit `:root`); chrome text (buttons, tabs) stays 13/500 from `@kortex/ui`.
- **Mono only for URLs:** the page domain line and the Kortex URL field. Folder names, vault paths and file names are Geist (the board is stricter than DESIGN.md, which also allows paths).
- **Colour only with meaning:** accent for actions (primary button, switches, radios, focus); green/amber/red only for status, shown as an icon in a neutral chip (`StatusChip`, also the toast icon); hashtag colours only as the dot, hashtag choices are neutral chips (dashed = suggestion, filled = selected).
- **One surface:** the page preview sits flat on the clipper card instead of being a card inside a card.
- **Radii:** 8 px controls (inputs, buttons), 12 px rows and small floating bars, 16 px cards; pills only for chips.
- **Light contrast:** text 4.5:1 and status icons 3:1 against every surface, computed from `packages/ui/src/styles/tokens.css` (status icons mix 60 % status colour with the text colour to reach 3:1 on warm paper).

`/gallery.html` on the preview server shows every state (clipper form, manual folders, saved, failed, status chips, highlighter bar, chat buttons, toasts) in dark and light (`?only=dark|light`). The comparison with the pre-v2 prototype below is historical: v2 intentionally diverges from `Extension.dc.html` in type, colour and surfaces.

## Visual verification (prototype, pre-v2)

`pnpm --filter @kortex/extension preview` serves `http://localhost:5199/`. `/` stages the real components like the prototype (`?theme=light`, `?mode=clip|hl|chat`, `?bot=chatgpt`, `?stage=done`), `/compare.html` loads `design/reference/Extension.dc.html` and the build side by side (same origin), drives both into the same state and diffs geometry and computed styles of every text-bearing element, in dark and light.

Result (clipper form/done, highlighter, chat with Claude and ChatGPT; dark and light): every box has identical position and size; computed colours, fonts, radii and shadows match. Remaining, intentional or invisible differences:

- Sentence-level widths differ by 1-3 px: the build uses the bundled `@fontsource` Geist/JetBrains Mono, the prototype Google's static files.
- `line-height` of text inside fixed-height controls (tabs, small buttons) is 16 px in `@kortex/ui` vs 20 px in the prototype; no visible effect.
- The prototype's note input renders in the browser default font (its `.kx-control` rule never applies to the input itself); the build uses Geist 14 px as the design system intends.
- `@kortex/ui` `SegmentedTabs` draws a 1 px ring on the selected tab; `kortex-refine.css` makes it flat. `ext.css` flattens it for the extension (worth fixing in `@kortex/ui`).
- File names in the saved pills use `YYYY-MM-DD_topic-slug.md` (playbook 5.3 / MCP) instead of the prototype's hyphenated `2026-10-22-…`.

## Known limits

- Content-script UIs cannot load the bundled fonts (shadow-DOM `@font-face` is ignored) and use the system sans/mono fallback on third-party pages; popup, options and preview use Geist/JetBrains Mono.
- "KI fragen" (prototype) is not rendered in the real highlighter until Kortex has a copilot deep link (`SelectionToolbar` takes an optional `onAskAi`).
- Nothing was loaded into a real Chrome yet (see the guardrail of the overnight task); background, popup, options and content scripts are covered by unit tests and a production build only.
- No icons for Firefox/Safari store listings, no auto-update channel.
