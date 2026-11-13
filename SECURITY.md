# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Use GitHub's private reporting: **Security → Report a vulnerability** on
https://github.com/moe-spiration/openkortex/security/advisories/new.

Tell us what you found, how to reproduce it and which version or commit you tested. You get an
answer within seven days. Please give us reasonable time to fix the problem before you publish
details; we credit you in the advisory unless you prefer otherwise.

## Scope

In scope: the code in this repository (web app and API, MCP server, Windows app, Android app,
browser extension, sync daemon, the self-hosting stack).

Out of scope: installations run by other people, findings that need an already compromised
device or account, missing hardening without a concrete attack, and the third-party services an
installation talks to.

## Supported versions

Fixes go into the latest release and the `main` branch.

## For people who host OpenKortex

- Keep `selfhost/.env` private: it holds every secret of your installation.
- Use https for anything reachable from the internet, and set up mail before inviting other
  people (see `selfhost/README.md`, "More than one user").
- Update regularly (`git pull`, `docker compose up -d --build`).
