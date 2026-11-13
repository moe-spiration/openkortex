# Contributing to OpenKortex

Thanks for helping. A few rules keep the project healthy.

## Before you start

- For anything larger than a small fix, open an issue first and say what you plan. It saves both
  sides from work that cannot be merged.
- Security problems do not go into issues: see [SECURITY.md](SECURITY.md).

## Contributor agreement

Every contributor signs the [contributor license agreement](CLA.md) once: the CLA check on your
first pull request asks you to post one sentence as a comment, and records it. A pull request
without it cannot be merged. The agreement lets the project
keep one clear owner of the rights, which is what makes a hosted offering and future license
decisions possible. You keep the copyright in your contribution.

## Working on the code

```bash
corepack enable
pnpm install
pnpm dev
pnpm check        # typecheck + lint + tests + i18n check; must be green
```

- **Language:** every visible text is English in code and goes through `@kortex/i18n`
  (`t("English source")`); the German translation lives in `<workspace>/src/i18n/de/*.json`.
  `pnpm i18n:check` fails on a missing or unused German entry. Rules: `packages/i18n/README.md`.
- **No fixed servers, accounts or model ids** in code, defaults or docs. Addresses come from the
  environment, models from the user's routing.
- **Database:** changes are new migration files in `packages/db/supabase/migrations`. Every table
  has row level security scoped to `user_id`. A migration has to work on an empty database
  (the self-hosting stack applies all of them in order).
- **Markdown stays portable:** what a user writes is stored as clean Markdown with YAML frontmatter.
- **All platforms:** a change that affects more than one app (web, Windows, Android, extension) is
  done on every affected one before it counts as finished.
- Do not skip or disable a failing test to get green.

## Pull requests

- One topic per pull request, with a description of what changed and how you tested it.
- Workflows on pull requests from forks start only after a maintainer approves them and never see
  secrets.
- Be kind. The [code of conduct](CODE_OF_CONDUCT.md) applies everywhere in this project.
