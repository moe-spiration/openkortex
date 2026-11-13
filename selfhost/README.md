# Self-hosting OpenKortex

One `docker compose` stack with everything OpenKortex needs on your own machine or server:

| Service | What it is |
| --- | --- |
| `web` | the OpenKortex web app (also the API for the Windows app, the Android app and the browser extension) |
| `mcp` | the MCP server, so Claude and other agents can read and write your knowledge |
| `db`, `auth`, `rest`, `realtime`, `storage` | Supabase: Postgres with pgvector, sign-in, the REST API, live updates, file storage |
| `gateway` | Caddy: puts all of the above behind **one address** and gets the https certificate |
| `migrate`, `setup` | run once per start: create or update the database schema, create your account |
| `cron` | hourly jobs: weekly digests, standing orders of the agent, watched pages |

Nothing leaves your machine except the calls to the AI providers you configure.

## What you need

- Docker with Compose v2 (`docker compose version`). On Windows and macOS: Docker Desktop.
- About 4 GB of free memory for the first build, 2 GB afterwards, and 5 GB of disk.
- Node 22 for the setup script, or run the script through Docker (shown below).
- At least one AI key (see [AI providers](#ai-providers)).
- For use from other devices: a domain that points to the server, with ports 80 and 443 open.

## Install

```bash
git clone <repository url> kortex
cd kortex

# 1. Write selfhost/.env: your address, your account, generated secrets.
node selfhost/init.mjs --url http://localhost:8000 --email you@example.com
#    without Node on the machine:
#    docker run --rm -v "$PWD:/w" -w /w node:22-slim node selfhost/init.mjs --url http://localhost:8000 --email you@example.com

# 2. Add at least one AI key to selfhost/.env (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, EDENAI_API_KEY).

# 3. Build and start. The first build takes several minutes.
cd selfhost
docker compose up -d --build
```

The script prints the password of your account once (or pass your own with `--password`).
Open the address, sign in with your email and that password, and you are in.

Check that everything is up:

```bash
docker compose ps                                   # every service "running" or "healthy"; migrate and setup "exited (0)"
curl -fsS http://localhost:8000/api/readyz          # {"ok":true,…}
```

Without an AI key the answer is still `"ok":true`, with `"ai":"none"` and a warning: entries are
saved as you wrote them, without summary, tags and search by meaning. The Inbox and the AI
settings say so as well. To turn AI on later, add a key to `.env` and run `docker compose up -d`.

The `PORTS` column of `docker compose ps` also lists ports that are only declared by an image and
not published, such as `2019/tcp` (Caddy's admin API) on `gateway` or `3000/tcp` on `setup` and
`cron`. Only the entries with an arrow (`0.0.0.0:8000->8000/tcp`) can be reached from outside.

## Which address?

The address is the one thing to decide before the first start. It is built into the web app, so
changing it later means editing `KORTEX_URL` (or running `init.mjs` again on a fresh installation)
and `docker compose up -d --build`.

| You want | `--url` | Notes |
| --- | --- | --- |
| Try it on this computer | `http://localhost:8000` | Works for the browser, the Windows app and the extension on the same computer. |
| Use it from phone and other computers | `https://kortex.example.com` | Point the domain to the server and open ports 80 and 443. Caddy gets the certificate by itself. |
| You already run a reverse proxy (Traefik, nginx, Coolify, a tunnel) | `https://kortex.example.com --behind-proxy` | OpenKortex then listens on `127.0.0.1:8000` (`--port` changes it). Forward the whole domain to it, including WebSockets. |
| Home network without a domain | `http://192.168.1.20:8000` | Works, with limits: browsers allow microphone, clipboard and installing the web app only on https or localhost, and the MCP server stays off. |

The Windows app, the Android app and the browser extension ask for the server on first start:
enter the same address.

## AI providers

OpenKortex talks to at most three providers. One key is enough to start; each covers different tasks:

| Key | Used for |
| --- | --- |
| `ANTHROPIC_API_KEY` | text intelligence: summaries, tags, action items, copilot, digests, meeting coach |
| `OPENROUTER_API_KEY` | vision and OCR, embeddings (search by meaning), alternative models. Requests carry `data_collection: deny`. |
| `EDENAI_API_KEY` | speech-to-text, document parsing, OCR |

Which model does what is chosen per task under **Settings → AI routing** ("Auto" picks one by cost
and quality). Without any key, capturing and writing work; summaries, search by meaning and the
copilot do not. Every account has a daily AI budget (default 2 EUR) under Settings.

Optional direct provider keys and other web-app settings (inbound mail, Unsplash covers, …) go
into `selfhost/.env.web`, one `NAME=value` per line; the names are in the root `.env.example`.

## More than one user

OpenKortex is invite-only: an account can only use it when an owner or admin has put its email on the
list under **Settings → Access**. The invited person then creates an account on the sign-in page
with that email.

Without a mail server, Supabase cannot send confirmation mails, so new accounts are confirmed at
once. On a public address that means: whoever signs up first with an invited email gets the
invitation. Before you invite people, set up SMTP in `selfhost/.env` (`SMTP_*`), set
`ENABLE_EMAIL_AUTOCONFIRM=false` and run `docker compose up -d`.

## Connect Claude (MCP)

With an https address the MCP server runs at the same address. In Claude: Settings → Connectors →
Add custom connector → `https://kortex.example.com/mcp`, then sign in with your OpenKortex email and
password. Only the owner account may sign in there.

## Update

```bash
git pull
cd selfhost
docker compose up -d --build
```

`migrate` applies new database migrations before the app starts. Your data lives in Docker
volumes and is not touched by a rebuild.

## Backup and restore

Everything worth keeping is in two volumes (`kortex_db-data`, `kortex_storage-data`) and in
`selfhost/.env` (keep a copy of it: without its secrets a restored database cannot be read by the
services).

```bash
cd selfhost
# database
docker compose exec -T db pg_dumpall -U postgres | gzip > kortex-db-$(date +%F).sql.gz
# uploaded files
docker run --rm -v kortex_storage-data:/data:ro -v "$PWD:/backup" alpine tar czf /backup/kortex-files-$(date +%F).tar.gz -C /data .
```

To restore on a fresh installation: copy `.env` back, start only the database
(`docker compose up -d db`), load the dump (`gunzip -c kortex-db-….sql.gz | docker compose exec -T db psql -U postgres`),
unpack the files into the storage volume, then `docker compose up -d`.

## Stop, logs, remove

```bash
docker compose logs -f web          # or auth, rest, migrate, setup, gateway, …
docker compose down                 # stop, keep data
docker compose down -v              # stop and DELETE all data of this installation
```

## Troubleshooting

- **`setup` exited with an error:** `docker compose logs setup` says why (usually the password in
  `.env` is shorter than 8 characters).
- **Sign-in works, then "No access":** the account is not on the allowlist. The owner account from
  `.env` always is; others need an invitation (see above).
- **`/api/readyz` answers 503:** the answer lists what is missing, by name, or says that the
  database does not answer.
- **Building behind a company proxy fails with `SELF_SIGNED_CERT_IN_CHAIN`:** the proxy replaces
  certificates. Add its CA certificate to the two Dockerfiles (`COPY` it in and set
  `NODE_EXTRA_CA_CERTS` to its path) before `docker compose up -d --build`.
- **`toomanyrequests` or `429` while pulling images:** Docker Hub limits anonymous pulls per IP
  address. Sign in with `docker login` (a free account has a higher limit), wait a few hours, or
  set a registry mirror in `/etc/docker/daemon.json` (for example
  `{"registry-mirrors":["https://mirror.gcr.io"]}`) and restart Docker.
- **Certificate errors on a domain:** the domain must resolve to this server and ports 80 and 443
  must reach it; `docker compose logs gateway` shows the certificate attempts.
- **Port already in use:** another program uses the port; pick another one in the address
  (`--url http://localhost:8080`) on a fresh installation, or change `KORTEX_URL`,
  `KORTEX_SITE_ADDRESS` and `KORTEX_HTTP_PORT` in `.env` and rebuild.

## How it fits together

```
browser / apps ──► gateway (Caddy) ──► /auth/v1      → auth (Supabase Auth)
                                   ├─► /rest/v1      → rest (PostgREST, schema "kortex")
                                   ├─► /realtime/v1  → realtime
                                   ├─► /storage/v1   → storage (files on a volume)
                                   ├─► /mcp, /oauth  → mcp
                                   └─► everything else → web
```

Only the gateway publishes a port. The web server and the MCP server reach the Supabase API over
the container network (`http://gateway:8001`, not published), so they do not depend on what the
public address means from inside a container, and any service can be restarted on its own.
On an https domain `init.mjs` adds `docker-compose.https.yml` (ports 80 and 443) through
`COMPOSE_FILE` in `.env`.
The database is not published to the host; use `docker compose exec db psql -U postgres` to look inside.
