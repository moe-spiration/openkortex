# OpenKortex

An AI-native second brain you host yourself. Drop anything into one inbox (thoughts, links,
articles, PDFs, books, videos, podcasts, voice memos, meetings, chats with AI assistants) and
background pipelines transcribe, summarize, tag and connect it. Everything stays portable Markdown.

- **Web app** (Next.js): home dashboard, block editor with wiki links and backlinks, graph, search by meaning, copilot
- **Windows app** (Tauri): quick capture with a global shortcut, live meeting notes without a bot
- **Android app** (Expo): share sheet, voice memos, editor, chat
- **Browser extension**: web clipper, highlighter, tab manager, export of AI chats
- **MCP server**: lets Claude and other agents read and write your knowledge
- **Markdown sync**: two-way sync with a local folder of plain `.md` files

English and German. No telemetry, no built-in server: every app asks for your own server on first start.

## Quick start

You need Docker and one AI key.

```bash
git clone https://github.com/moe-spiration/openkortex.git
cd openkortex
node selfhost/init.mjs --url http://localhost:8000 --email you@example.com
# add an AI key to selfhost/.env, then:
cd selfhost && docker compose up -d --build
```

Open http://localhost:8000 and sign in. The full guide (domains and https, more users, backup,
updates) is in [selfhost/README.md](selfhost/README.md).

## Repository layout

| Path | What |
| --- | --- |
| `apps/web` | web app and API |
| `apps/desktop` | Windows app |
| `apps/mobile` | Android app (iOS ready) |
| `apps/extension` | browser extension |
| `packages/db` | database schema, migrations, typed client |
| `packages/ai-core` | AI gateway, model routing, ingestion adapters |
| `packages/md-sync` | Markdown sync daemon |
| `packages/mcp-server` | MCP server |
| `packages/ui`, `packages/theme-packs`, `packages/i18n` | shared UI, cover art, translations |
| `selfhost` | Docker Compose installation |

## Development

```bash
pnpm install
pnpm dev          # all apps in watch mode
pnpm check        # typecheck, lint, tests: the gate every change has to pass
```

Node 22 and pnpm (via `corepack enable`). See [CONTRIBUTING.md](CONTRIBUTING.md).

## AI providers

At most three keys, any one is enough to start: Anthropic (text intelligence), OpenRouter (vision,
embeddings, other models; requests carry `data_collection: deny`) and Eden AI (speech-to-text,
document parsing). Models are chosen per task in the settings, nothing is hardcoded.

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a service for
others, you have to offer them its source. Contributions need a signed
[contributor agreement](CLA.md).

Third-party packages keep their own licenses. Every release carries their texts in
`THIRD-PARTY-NOTICES.md` (the Windows installer has it too); `node scripts/third-party-notices.mjs
--out THIRD-PARTY-NOTICES.md` writes it from your checkout after `pnpm install`. The fonts (Geist,
JetBrains Mono, Instrument Serif) come from npm under the SIL Open Font License; the cover and
background images were generated for this project and ship under the project license.

## Security

Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).
