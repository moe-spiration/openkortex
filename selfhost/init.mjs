#!/usr/bin/env node
// Writes selfhost/.env for a new Kortex installation: the address, the owner account and every
// secret the stack needs (database password, JWT secret and the two API keys signed with it).
//
//   node selfhost/init.mjs --url http://localhost:8000 --email you@example.com
//   node selfhost/init.mjs --url https://kortex.example.com --email you@example.com
//   node selfhost/init.mjs --url https://kortex.example.com --email you@example.com --behind-proxy
//
// Options: --password <owner password> (generated when missing), --port <n> (with --behind-proxy,
// default 8000), --timezone <IANA zone>, --force (replace an existing .env: new secrets do not
// fit an existing database, so only for a fresh start).
// No dependencies: Node 22 or `docker run --rm -v "$PWD:/w" -w /w node:22-slim node selfhost/init.mjs …`.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const b64url = (input) => Buffer.from(input).toString("base64url");
const secret = (bytes) => randomBytes(bytes).toString("base64url");

/** A Supabase API key: an HS256 JWT with the role, valid for ten years. */
export function signApiKey(role, jwtSecret, now = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ role, iss: "supabase", iat: now, exp: now + 10 * 365 * 24 * 3600 }),
  );
  const sig = createHmac("sha256", jwtSecret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`Unexpected argument "${a}"`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

const isIp = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
const isLoopback = (host) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/** How the gateway is published for this address. Throws with a plain reason on a bad address. */
export function plan({ url: rawUrl, behindProxy = false, port }) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      `--url must be a full address like http://localhost:8000 or https://kortex.example.com (got "${rawUrl}")`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("--url must start with http:// or https://");
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error("--url must be an address without a path");
  const host = url.hostname;
  const origin = url.origin;
  const https = url.protocol === "https:";
  const mcp = https || isLoopback(host);

  if (behindProxy) {
    const p = Number(port ?? 8000);
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error("--port must be a port number");
    // Another reverse proxy terminates TLS and forwards to this port on the loopback interface.
    return {
      origin,
      siteAddress: `:${p}`,
      httpPort: p,
      bind: "127.0.0.1",
      composeFiles: ["docker-compose.yml"],
      mcp,
    };
  }
  if (https) {
    if (isIp(host) || isLoopback(host))
      throw new Error(
        "An https address needs a domain name (certificates are not issued for IP addresses or localhost)",
      );
    if (url.port && url.port !== "443")
      throw new Error(
        "An https address must use the default port (443); put another proxy in front and use --behind-proxy for anything else",
      );
    return {
      origin,
      siteAddress: host,
      httpPort: 80,
      bind: "0.0.0.0",
      composeFiles: ["docker-compose.yml", "docker-compose.https.yml"],
      mcp,
    };
  }
  const p = Number(url.port || 80);
  return {
    origin,
    siteAddress: `:${p}`,
    httpPort: p,
    bind: "0.0.0.0",
    // A name (not an IP, not localhost) resolves to the gateway inside the web container.
    composeFiles: ["docker-compose.yml"],
    mcp,
  };
}

export function buildEnv(opts, random = { secret, uuid: randomUUID }) {
  const email = String(opts.email ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email))
    throw new Error("--email must be the email address of the owner account");
  const p = plan({ url: opts.url, behindProxy: Boolean(opts["behind-proxy"]), port: opts.port });
  const password = typeof opts.password === "string" ? opts.password : random.secret(15);
  if (password.length < 8) throw new Error("--password needs at least 8 characters");
  const jwtSecret = random.secret(48);
  const lines = [
    "# Kortex self-hosting, written by selfhost/init.mjs. Keep this file private: it holds every",
    "# secret of the installation. Explanations: selfhost/.env.example and selfhost/README.md.",
    "",
    "# Address",
    `KORTEX_URL=${p.origin}`,
    `KORTEX_SITE_ADDRESS=${p.siteAddress}`,
    `KORTEX_HTTP_PORT=${p.httpPort}`,
    `KORTEX_BIND=${p.bind}`,
    "COMPOSE_PATH_SEPARATOR=:",
    `COMPOSE_FILE=${p.composeFiles.join(":")}`,
    `COMPOSE_PROFILES=${p.mcp ? "mcp" : ""}`,
    `KORTEX_TIMEZONE=${typeof opts.timezone === "string" ? opts.timezone : "UTC"}`,
    "",
    "# Owner account (created on the first start; the password line can be removed afterwards)",
    `KORTEX_OWNER_EMAIL=${email}`,
    `KORTEX_OWNER_PASSWORD=${password}`,
    `KORTEX_USER_ID=${random.uuid()}`,
    "",
    '# AI keys: at least one, see README ("AI providers"). Without any, capture and notes work,',
    "# summaries, search by meaning and the copilot do not.",
    "ANTHROPIC_API_KEY=",
    "OPENROUTER_API_KEY=",
    "EDENAI_API_KEY=",
    "",
    "# Mail (optional): with an SMTP server, set ENABLE_EMAIL_AUTOCONFIRM=false",
    "ENABLE_EMAIL_AUTOCONFIRM=true",
    "DISABLE_SIGNUP=false",
    "SMTP_HOST=",
    "SMTP_PORT=587",
    "SMTP_USER=",
    "SMTP_PASS=",
    "SMTP_ADMIN_EMAIL=",
    "SMTP_SENDER_NAME=Kortex",
    "",
    "# Secrets (generated; changing them later breaks the existing database and sessions)",
    `POSTGRES_PASSWORD=${random.secret(24)}`,
    `JWT_SECRET=${jwtSecret}`,
    `ANON_KEY=${signApiKey("anon", jwtSecret)}`,
    `SERVICE_ROLE_KEY=${signApiKey("service_role", jwtSecret)}`,
    `SECRET_KEY_BASE=${random.secret(48)}`,
    `REALTIME_DB_ENC_KEY=${random.secret(12)}`,
    `KORTEX_CRON_SECRET=${random.secret(32)}`,
    `MCP_OAUTH_SECRET=${random.secret(48)}`,
    "",
  ];
  return {
    text: lines.join("\n"),
    plan: p,
    email,
    password,
    generatedPassword: typeof opts.password !== "string",
  };
}

function main() {
  const dir = dirname(fileURLToPath(import.meta.url));
  const target = join(dir, ".env");
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (!opts.url || !opts.email)
      throw new Error(
        "Usage: node selfhost/init.mjs --url <address> --email <owner email> [--password <pw>] [--behind-proxy [--port <n>]] [--timezone <zone>] [--force]",
      );
    if (existsSync(target) && !opts.force) {
      throw new Error(
        "selfhost/.env exists already. Edit it by hand, or pass --force for a fresh start (new secrets do not fit an existing database).",
      );
    }
    const env = buildEnv(opts);
    writeFileSync(target, env.text, { mode: 0o600 });
    console.log(`Wrote ${target}`);
    console.log(`  Address:  ${env.plan.origin}`);
    console.log(`  Owner:    ${env.email}`);
    if (env.generatedPassword)
      console.log(
        `  Password: ${env.password}   (generated, shown once here and stored in .env;\n            after the first start you can delete the KORTEX_OWNER_PASSWORD line there)`,
      );
    if (!env.plan.mcp) console.log("  MCP server: off (it needs an https address)");
    console.log("\nNext: add at least one AI key to selfhost/.env, then");
    console.log("  cd selfhost && docker compose up -d --build");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
