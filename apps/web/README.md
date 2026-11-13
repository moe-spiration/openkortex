# @kortex/web

Next.js 15 workspace (Home, Journal, Inbox, Spaces, Objects, Vault, Notes, Reader, Settings) and
the API routes (`/api/ingest`, `/api/chat`, `/api/chat/action`, `/api/digest`, see
`src/server/README.md`).

## Run locally against the live database

1. Put the secrets into `apps/web/.env.local` (gitignored; copying the repo root `.env.local`
   works). Needed:

   | Variable | For |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | login and all workspace data (RLS as you) |
   | `OPENROUTER_API_KEY` | ingest pipeline, chat, digests |
   | `SUPABASE_SERVICE_ROLE_KEY` | only the personal API token path (`KORTEX_API_TOKEN`, extension) |
   | `KORTEX_TIMEZONE` (optional) | "today" and item dates, default `Europe/Berlin` |

2. Start it:

   ```bash
   pnpm --filter @kortex/web dev
   ```

3. Open http://localhost:3000. Every workspace page redirects to `/login` until you sign in.

The app only touches schema `kortex` (and the `kortex-*` storage buckets) of the shared Supabase
instance.

## Create your own account (first sign-in)

On `/login` choose **Neues Konto erstellen**, enter e-mail and a password (8+ characters).

- If e-mail confirmation is off on the Supabase instance, you are signed in right away.
- Otherwise confirm the e-mail; the link lands on `/auth/callback` and signs you in. For that,
  add `http://localhost:3000/auth/callback` (and your deployed URL) to the Auth redirect URLs of
  the Supabase instance.
- Admin alternative: create the user in Supabase Studio (Authentication → Add user, "auto confirm")
  and sign in with password.

On the first authenticated load the app runs `kortex.bootstrap_user()` (idempotent): your
`user_settings` row and the 17 system folders (`00_Inbox` … `90_Digests`, `70_Objects/<Type>`).
Your workspace is empty until you capture something (footbar, extension, `/api/ingest`).

Sign-in options: password, **Magic Link** (needs a working mailer on the instance; existing
accounts only). Sign out: `GET` or `POST /auth/logout`.

## Switch to mock data

```bash
KORTEX_DATA_SOURCE=mock pnpm --filter @kortex/web dev
```

or set `KORTEX_DATA_SOURCE="mock"` in `.env.local`. Mock mode shows the prototype data, needs no
keys and no login, and saves nothing. Without the two `NEXT_PUBLIC_SUPABASE_*` keys the app falls
back to mock automatically. The mode is resolved when the dev server / build starts
(`next.config.ts`), so restart after changing it.

## How the live data gets to the components

- `src/lib/workspace-data.ts` is the only data seam. Its exports (`NOTES`, `ALL_ITEMS`,
  `AUTO_SPACES`, `VAULT_TREE`, `PROFILE`, `noteById`, `initialKnowledgeItems` …) keep the
  mock-era names and shapes; in live mode they read a `WorkspaceSnapshot` of the signed-in user.
- Server: `await loadWorkspace()` (`src/lib/supabase/workspace.ts`) loads the snapshot once per
  request (React `cache`) and must run at the top of any server page / `generateMetadata` that
  reads workspace data. The workspace layout calls it too and hands the snapshot to
  `<LiveData>`.
- Browser: `<LiveData>` installs the snapshot before the shell renders. In live mode the workspace
  renders on the client only (module-level data on the server is shared across requests, so it is
  never server-rendered into HTML).
- Snapshot content (`src/lib/supabase/snapshot.ts`): the 500 most recently updated items with
  body, action items, backlinks (`related_item_ids` + `[[Wiki-Links]]`), folder tree, top tags,
  counts per space/hub over the whole vault, inbox jobs (status `inbox`/`processing`), today's
  daily note, profile. Row mapping lives in `src/lib/supabase/mapping.ts` (unit-tested).
- Writes: server actions in `src/lib/api/actions.ts`, called by the optimistic stores
  (`src/lib/notes/store.tsx`), which roll back on failure.

## Checks

```bash
pnpm turbo run typecheck lint test --filter @kortex/web
pnpm --filter @kortex/web build
```
